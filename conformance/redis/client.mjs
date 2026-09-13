import { deferred } from '../typescript/fixtures/cases.mjs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { openLimiter, LeaseExpiredError } from '../../packages/redis/dist/index.js';
import { RedisBackend } from '../../packages/redis/dist/backend.js';
import { ScheduledLimiter } from '../../packages/core/dist/src/client.js';
import { server, key } from './harness.mjs';

const redis = await server(),
  clients = [];
let passed = 0;
const config = { maxConcurrent: 2 };
async function open(extra = {}) {
  const limiter = await openLimiter({ url: redis.url, pool: key(), config, ...extra });
  clients.push(limiter);
  return limiter;
}
async function raw(extra = {}) {
  const backend = new RedisBackend({ url: redis.url, pool: key(), config, ...extra });
  await backend.open();
  const limiter = new ScheduledLimiter(backend);
  clients.push(limiter);
  return { limiter, backend };
}
async function test(name, fn) {
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out: ' + name)), 15000);
      }),
    ]);
    passed++;
    console.log('PASS ' + name);
  } finally {
    clearTimeout(timer);
  }
}
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform}`,
);
try {
  await test('same-pool clients share capacity and preserve callback values', async () => {
    const pool = key(),
      a = await open({ pool }),
      b = await open({ pool });
    let running = 0,
      peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? a : b).schedule(async (admission) => {
          assert.ok(Object.isFrozen(admission));
          running++;
          peak = Math.max(peak, running);
          await delay(15);
          running--;
          return i;
        }),
      ),
    );
    assert.equal(peak, 2);
    assert.deepEqual(
      results,
      Array.from({ length: 20 }, (_, i) => i),
    );
    assert.equal((await a.inspect()).active, 0);
  });
  await test('weighted admission debits budgets and overflow preserves a usable client', async () => {
    const limiter = await open({
      config: { maxConcurrent: 3, reservoir: Number.MAX_SAFE_INTEGER },
    });
    await assert.rejects(limiter.incrementReservoir(1), /overflow/);
    assert.equal(await limiter.currentReservoir(), Number.MAX_SAFE_INTEGER);
    await limiter.schedule((admission) => assert.equal(admission.weight, 3), { weight: 3 });
    assert.equal(await limiter.currentReservoir(), Number.MAX_SAFE_INTEGER - 3);
    await limiter.incrementReservoir(-Number.MAX_SAFE_INTEGER + 3);
    assert.equal(await limiter.currentReservoir(), 0);
    const abort = new AbortController();
    const job = limiter.schedule(() => assert.fail('empty budget'), { signal: abort.signal });
    abort.abort();
    await assert.rejects(job, { name: 'AbortError' });
    await limiter.incrementReservoir(1);
    assert.equal(await limiter.schedule(() => 42), 42);
  });
  await test('falsy callback failures retain identity and release capacity', async () => {
    const limiter = await open({ config: { maxConcurrent: 1 } });
    for (const error of [undefined, null, false, 0, '']) {
      const result = await limiter
        .schedule(() => Promise.reject(error))
        .then(
          () => ({ ok: true }),
          (reason) => ({ ok: false, reason }),
        );
      assert.deepEqual(result, { ok: false, reason: error });
      assert.equal((await limiter.inspect()).active, 0);
    }
  });
  await test('default close cancels queued jobs, awaits running work and first close wins', async () => {
    const limiter = await open({ config: { maxConcurrent: 1 } }),
      started = deferred(),
      finish = deferred();
    const running = limiter.schedule(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    const queued = limiter.schedule(() => assert.fail('queued callback started'));
    const rejected = assert.rejects(queued, /closing/);
    const closing = limiter.close();
    assert.equal(limiter.close({ drain: true }), closing);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await rejected;
    await delay(20);
    assert.equal(closed, false);
    finish.resolve();
    await Promise.all([running, closing]);
  });
  await test('drain finishes accepted jobs and closing one client preserves its peer', async () => {
    const pool = key(),
      a = await open({ pool, config: { maxConcurrent: 1 } }),
      b = await open({ pool, config: { maxConcurrent: 1 } });
    const jobs = Array.from({ length: 5 }, (_, i) => a.schedule(() => i));
    const close = a.close({ drain: true });
    assert.equal(a.close(), close);
    assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
    await close;
    assert.equal(await b.schedule(() => 'peer'), 'peer');
  });
  await test('queued abort cannot dispatch and running abort cannot release early', async () => {
    const limiter = await open({ config: { maxConcurrent: 1 } }),
      start = deferred(),
      finish = deferred(),
      signal = new AbortController();
    const running = limiter.schedule(
      async () => {
        start.resolve();
        await finish.promise;
      },
      { signal: signal.signal },
    );
    await start.promise;
    signal.abort();
    const queuedAbort = new AbortController();
    const queued = limiter.schedule(() => assert.fail('cancelled job ran'), {
      signal: queuedAbort.signal,
    });
    queuedAbort.abort();
    await assert.rejects(queued, { name: 'AbortError' });
    assert.equal((await limiter.inspect()).active, 1);
    finish.resolve();
    await running;
    assert.equal((await limiter.inspect()).active, 0);
  });
  await test('late cancelled grant is released before close and its token is not refunded', async () => {
    const { limiter, backend } = await raw({ config: { maxConcurrent: 1, reservoir: 2 } });
    const grant = deferred(),
      delivery = deferred(),
      invoke = backend.wire.invoke.bind(backend.wire);
    backend.wire.invoke = async (action, input) => {
      const result = await invoke(action, input);
      if (action === 'acquire' && result.reply.admission) {
        grant.resolve();
        await delivery.promise;
      }
      return result;
    };
    const controller = new AbortController(),
      job = limiter.schedule(() => assert.fail('late cancelled callback'), {
        signal: controller.signal,
      });
    const rejected = assert.rejects(job, { name: 'AbortError' });
    await grant.promise;
    controller.abort();
    await rejected;
    let closed = false;
    const close = limiter.close().then(() => {
      closed = true;
    });
    await delay(10);
    assert.equal(closed, false);
    delivery.resolve();
    await close;
    // Inspect the persisted state without retaining a closed application client.
    const inspector = await import('./harness.mjs').then((module) => module.connect(redis.url));
    try {
      const state = JSON.parse(await inspector.get(backend.wire.key));
      assert.equal(state.remaining, '1');
      assert.deepEqual(state.leases, {});
    } finally {
      inspector.destroy();
    }
  });
  await test('renewal keeps a long callback valid beyond the ownership timeout', async () => {
    const limiter = await open({ config: { maxConcurrent: 1 }, ownerTimeoutMs: 600 });
    await limiter.schedule(async () => {
      await delay(1400);
      assert.equal((await limiter.inspect()).active, 1);
    });
    assert.equal((await limiter.inspect()).active, 0);
  });
  await test('request expiration remains independent of renewable ownership', async () => {
    const pool = key(),
      a = await open({ pool, config: { maxConcurrent: 1 }, ownerTimeoutMs: 600 }),
      b = await open({ pool, config: { maxConcurrent: 1 }, ownerTimeoutMs: 600 });
    const start = deferred(),
      finish = deferred();
    const running = a.schedule(
      async () => {
        start.resolve();
        await finish.promise;
      },
      { expirationMs: 80 },
    );
    await start.promise;
    let oldStillRunning = true;
    await b.schedule(() => assert.equal(oldStillRunning, true));
    finish.resolve();
    await running;
    oldStillRunning = false;
  });
  await test('server admission and local dispatch tolerate a skewed client wall clock', async () => {
    const limiter = await open({ config: { maxConcurrent: 1 } }),
      original = Date.now;
    try {
      Date.now = () => original() + 86400000;
      await limiter.schedule(
        (admission) => assert.ok(Math.abs(admission.leaseGrantedAt - original()) < 1000),
        { expirationMs: 500 },
      );
    } finally {
      Date.now = original;
    }
  });
  await test('delayed expired delivery never starts the callback and permits later work', async () => {
    const { limiter, backend } = await raw({ config: { maxConcurrent: 1 } }),
      invoke = backend.wire.invoke.bind(backend.wire);
    let delayed = false;
    backend.wire.invoke = async (action, input) => {
      const result = await invoke(action, input);
      if (action === 'acquire' && result.reply.admission && !delayed) {
        delayed = true;
        await delay(80);
      }
      return result;
    };
    await assert.rejects(
      limiter.schedule(() => assert.fail('expired callback'), { expirationMs: 30 }),
      LeaseExpiredError,
    );
    assert.equal(await limiter.schedule(() => 'healthy'), 'healthy');
  });
  await test('idle exhausted budget has no admission polling and queued cancellation wakes shutdown', async () => {
    const { limiter, backend } = await raw({
      config: { maxConcurrent: 1, reservoir: 0 },
      ownerTimeoutMs: 3000,
    });
    const controller = new AbortController();
    const wait = deferred(),
      original = backend.wire.wait.bind(backend.wire);
    backend.wire.wait = async (...args) => {
      // Flush the acceptance publication on the subscriber connection before
      // measuring an idle wait; a genuine initial state change may wake once.
      await backend.wire.subscriber.ping();
      if (args[0] === backend.wire.version) {
        wait.resolve();
      }
      return original(...args);
    };
    const job = limiter.schedule(() => assert.fail('empty budget'), { signal: controller.signal });
    const rejected = assert.rejects(job, { name: 'AbortError' });
    try {
      await wait.promise;
      const { commands, wakes } = backend.wire.stats;
      await delay(150);
      assert.equal(backend.wire.stats.commands, commands);
      assert.equal(backend.wire.stats.wakes, wakes);
    } finally {
      controller.abort();
      await rejected;
      await limiter.close();
    }
  });
  await test('subscription loss rejects queued work and a fresh owner can reopen', async () => {
    const pool = key(),
      { limiter, backend } = await raw({ pool, config: { maxConcurrent: 1, reservoir: 0 } });
    const job = limiter.schedule(() => assert.fail('disconnected callback'));
    const failed = assert.rejects(job, /connection|closed/i);
    backend.wire.subscriber.destroy();
    await failed;
    await assert.rejects(limiter.close());
    const peer = await open({ pool, config: { maxConcurrent: 1, reservoir: 0 } });
    await peer.incrementReservoir(1);
    assert.equal(await peer.schedule(() => 'fresh'), 'fresh');
  });
  await test('complete config drift includes owner timeout and invalid input does not register', async () => {
    const pool = key();
    await open({ pool });
    for (const changed of [
      { ownerTimeoutMs: 40000 },
      { config: { maxConcurrent: 2, minTime: 1 } },
      { config: { maxConcurrent: 2, expirationMs: 10 } },
    ]) {
      await assert.rejects(open({ pool, ...changed }), /CONFIG/);
    }
    for (const ownerTimeoutMs of [null, 0, 299, Infinity]) {
      await assert.rejects(open({ ownerTimeoutMs }), /ownerTimeoutMs/);
    }
  });
  await test('configured spacing and reservoir refresh wake queued public callbacks', async () => {
    const limiter = await open({
      config: {
        maxConcurrent: 2,
        minTime: 70,
        reservoir: 1,
        reservoirRefreshAmount: 1,
        reservoirRefreshInterval: 100,
      },
    });
    const times = await Promise.all(
      Array.from({ length: 3 }, () => limiter.schedule((admission) => admission.leaseGrantedAt)),
    );
    assert.ok(times[1] - times[0] >= 70);
    assert.ok(times[2] - times[1] >= 70);
    assert.equal(await limiter.currentReservoir(), 0);
  });
  await test('unlimited concurrency overflow rejects one job and preserves the held lease', async () => {
    const limiter = await open({ config: { maxConcurrent: null } }),
      started = deferred(),
      finish = deferred();
    const running = limiter.schedule(
      async () => {
        started.resolve();
        await finish.promise;
      },
      { weight: Number.MAX_SAFE_INTEGER },
    );
    await started.promise;
    try {
      await assert.rejects(
        limiter.schedule(() => assert.fail('overflow admitted')),
        /overflow/,
      );
      assert.equal((await limiter.inspect()).active, Number.MAX_SAFE_INTEGER);
    } finally {
      finish.resolve();
      await running;
    }
    assert.equal(await limiter.schedule(() => 1), 1);
  });
  await test('explicit null disables the pool request deadline for just that call', async () => {
    const limiter = await open({ config: { maxConcurrent: 1, expirationMs: 30 } });
    await limiter.schedule(
      async (admission) => {
        assert.equal(admission.expiresAt, null);
        await delay(80);
        assert.equal((await limiter.inspect()).active, 1);
      },
      { expirationMs: null },
    );
    await limiter.schedule((admission) =>
      assert.equal(admission.expiresAt - admission.leaseGrantedAt, 30),
    );
  });
  await test('due renewal takes priority over a healthy mutation backlog', async () => {
    const { limiter, backend } = await raw({
      config: { maxConcurrent: 1, reservoir: 1000 },
      ownerTimeoutMs: 600,
    });
    const started = deferred(),
      finish = deferred();
    const running = limiter.schedule(async () => {
      started.resolve();
      await finish.promise;
    });
    // Attach a handler before deliberately loading the transport; failure of
    // this regression must not become an unrelated unhandled rejection.
    const completed = running.then(
      () => null,
      (error) => error,
    );
    await started.promise;
    const send = backend.wire.command.sendCommand.bind(backend.wire.command);
    backend.wire.command.sendCommand = async (...args) => {
      const reply = await send(...args);
      await delay(20);
      return reply;
    };
    try {
      const balances = await Promise.all(
        Array.from({ length: 60 }, () => limiter.incrementReservoir(1)),
      );
      assert.deepEqual(
        balances,
        Array.from({ length: 60 }, (_, i) => 1000 + i),
      );
      assert.ok(backend.wire.stats.renewals >= 2);
      assert.equal((await limiter.inspect()).active, 1);
      assert.equal(backend.failure, undefined);
    } finally {
      finish.resolve();
      assert.equal(await completed, null);
    }
  });
  console.log(`RESULT ${passed}/18 passed`);
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  await redis.close();
}
