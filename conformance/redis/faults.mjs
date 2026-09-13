import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ScheduledLimiter } from '../../packages/core/dist/src/client.js';
import { RedisBackend } from '../../packages/redis/dist/backend.js';
import { openLimiter } from '../../packages/redis/dist/index.js';
import { server, key, connect } from './harness.mjs';
import { proxy } from './proxy.mjs';
const redis = await server(),
  control = await connect(redis.url);
let passed = 0;
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS ' + name);
}
async function faulted(config = { maxConcurrent: 1, reservoir: 10 }) {
  const middle = await proxy(redis.url),
    pool = key();
  const options = { url: middle.url, pool, config, ownerTimeoutMs: 600 };
  const backend = new RedisBackend(options);
  await backend.open();
  const limiter = new ScheduledLimiter(backend);
  return {
    middle,
    backend,
    limiter,
    peer: () => openLimiter({ ...options, url: redis.url }),
    async close() {
      await limiter.close().catch(() => {});
      await middle.close();
    },
  };
}
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform}`,
);
try {
  for (const stage of ['handshake', 'SUBSCRIBE', 'EVAL']) {
    await test(`startup ${stage} response loss rejects and closes both sockets`, async () => {
      const middle = await proxy(redis.url);
      const backend = new RedisBackend({
        url: middle.url,
        pool: key(),
        config: { maxConcurrent: 1 },
        ownerTimeoutMs: 1500,
      });
      if (stage === 'handshake') {
        middle.blackholeResponses();
      } else {
        middle.blackholeAt(stage);
      }
      try {
        const started = performance.now();
        await assert.rejects(backend.open(), /Redis startup timed out/);
        assert.ok(performance.now() - started < 1200, 'startup response deadline was not enforced');
        assert.equal(backend.wire.command.isOpen, false);
        assert.equal(backend.wire.subscriber.isOpen, false);
      } finally {
        await middle.close();
      }
    });
  }
  await test('subscription-only response loss fails a waiter while command traffic remains healthy', async () => {
    const f = await faulted({ maxConcurrent: 1, reservoir: 0 });
    try {
      const idle = deferred(),
        original = f.backend.wire.wait.bind(f.backend.wire);
      f.backend.wire.wait = async (...args) => {
        await f.backend.wire.subscriber.ping();
        if (args[0] === f.backend.wire.version) {
          idle.resolve();
        }
        return original(...args);
      };
      const waiting = f.limiter
        .schedule(() => assert.fail('deaf subscriber dispatched'))
        .then(
          () => null,
          (error) => error,
        );
      await idle.promise;
      f.middle.blackholeSubscriber();
      const peer = await f.peer();
      try {
        await peer.incrementReservoir(1);
      } finally {
        await peer.close();
      }
      const error = await waiting;
      assert.match(error.message, /subscription health check timed out/);
      assert.ok(f.backend.wire.stats.renewals > 0);
      assert.equal(f.backend.wire.command.isOpen, false);
    } finally {
      await f.close();
    }
  });
  await test('lost increment reply reports uncertainty without replaying or refunding', async () => {
    const f = await faulted();
    try {
      f.middle.blackholeResponses();
      await assert.rejects(f.limiter.incrementReservoir(3), /Redis command timed out/);
      assert.equal(JSON.parse(await control.get(f.backend.wire.key)).remaining, '13');
      await assert.rejects(f.limiter.incrementReservoir(3));
      assert.equal(JSON.parse(await control.get(f.backend.wire.key)).remaining, '13');
      const peer = await f.peer();
      try {
        assert.equal(await peer.currentReservoir(), 13);
      } finally {
        await peer.close();
      }
    } finally {
      await f.close();
    }
  });
  await test('lost admission reply never dispatches and owner expiry recovers committed capacity', async () => {
    const f = await faulted();
    try {
      const invoke = f.backend.wire.invoke.bind(f.backend.wire);
      f.backend.wire.invoke = (action, input) => {
        // Acceptance is a separate mutation; lose the actual admission reply.
        if (action === 'acquire') {
          f.middle.blackholeResponses();
        }
        return invoke(action, input);
      };
      await assert.rejects(
        f.limiter.schedule(() => assert.fail('uncertain callback ran')),
        /Redis command timed out/,
      );
      const state = JSON.parse(await control.get(f.backend.wire.key));
      assert.equal(state.remaining, '9');
      assert.equal(Object.keys(state.leases).length, 1);
      const peer = await f.peer();
      try {
        await peer.schedule(() => 'recovered');
        assert.equal(await peer.currentReservoir(), 8);
      } finally {
        await peer.close();
      }
    } finally {
      await f.close();
    }
  });
  await test('partitioned live owner loses capacity while its uncancellable callback still runs', async () => {
    const f = await faulted(),
      started = deferred(),
      finish = deferred();
    let oldRunning = false;
    const running = f.limiter
      .schedule(async () => {
        oldRunning = true;
        started.resolve();
        await finish.promise;
        oldRunning = false;
      })
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
    try {
      await started.promise;
      f.middle.blackholeResponses();
      const peer = await f.peer();
      try {
        await peer.schedule(() => {
          assert.equal(oldRunning, true);
          assert.ok(f.backend.failure);
        });
      } finally {
        await peer.close();
      }
      finish.resolve();
      const result = await running;
      assert.equal(result.ok, false);
    } finally {
      finish.resolve();
      await running;
      await f.close();
    }
  });
  await test('SIGKILL of an independent owner frees a lease without request expiration', async () => {
    const pool = key();
    const child = spawn(process.execPath, ['conformance/redis/worker.mjs'], {
      env: {
        ...process.env,
        REDIS_URL: redis.url,
        POOL: pool,
        CONFIG: JSON.stringify({ maxConcurrent: 1 }),
        OWNER_TIMEOUT: '600',
        MODE: 'hold',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = once(child, 'exit');
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Child did not acquire: ' + output)),
          10000,
        );
        child.stdout.on('data', (data) => {
          output += data;
          if (output.includes('READY')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stderr.on('data', (data) => {
          output += data;
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(output));
        });
      });
      child.kill('SIGKILL');
      await exit;
      const peer = await openLimiter({
        url: redis.url,
        pool,
        config: { maxConcurrent: 1 },
        ownerTimeoutMs: 600,
      });
      try {
        assert.equal(await peer.schedule(() => 'reclaimed'), 'reclaimed');
        assert.equal((await peer.inspect()).active, 0);
      } finally {
        await peer.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exit;
      }
    }
  });
  console.log(`RESULT ${passed}/8 passed`);
} finally {
  control.destroy();
  await redis.close();
}
