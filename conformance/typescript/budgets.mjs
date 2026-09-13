import { nativePath } from '../../packages/core/dist/src/native-path.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { Pool } from '../../packages/core/dist/src/backend.js';

const addon = nativePath();
if (process.argv[2] === 'peer') {
  const [path, encoded, mode] = process.argv.slice(3),
    config = JSON.parse(encoded);
  if (mode.startsWith('crash-')) {
    const pool = new Pool(path, config, addon);
    const operation = pool.acceptOperation('admission-crash-fixture');
    pool.stage = (stage) => {
      if (stage === mode.slice(6)) {
        writeSync(
          1,
          JSON.stringify({
            lease: pool.db.prepare('SELECT * FROM leases').get(),
            budget: pool.db.prepare('SELECT * FROM budget').get(),
          }) + '\n',
        );
        process.kill(process.pid, 'SIGSTOP');
      }
    };
    await pool.acquireDetailed(undefined, 2, undefined, { operation });
    throw new Error('crash fixture resumed');
  }
  const limiter = await openLimiter({ path, config });
  if (mode === 'increment-held') {
    const finished = once(process.stdin, 'end');
    console.log(JSON.stringify({ ready: true }));
    await once(process.stdin, 'data');
    await limiter.incrementReservoir(2);
    await finished;
  } else {
    const weights = mode === 'refill' ? [1, 1, 1, 1] : [1, 2, 1, 2];
    await Promise.all(weights.map((weight) => limiter.schedule(() => delay(40), { weight })));
  }
  console.log(JSON.stringify(await limiter.inspect()));
  await limiter.close();
} else {
  assert.notEqual(process.getuid?.(), 0);
  await mkdir('.tmp/budgets', { recursive: true });
  const root = await mkdtemp('.tmp/budgets/run-');
  const children = new Set(),
    clients = new Set();
  const native = new (createRequire(import.meta.url)(addon).NativeContext)();
  const read = (path) => {
    const gate = native.open(join(path, 'coordination.lock'), 'gate');
    try {
      return gate.withGate(() => {
        const db = new DatabaseSync(join(path, 'state.sqlite'));
        try {
          return Object.fromEntries(
            ['config', 'timing', 'budget', 'leases', 'owners', 'trace'].map((table) => [
              table,
              db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
            ]),
          );
        } finally {
          db.close();
        }
      });
    } finally {
      gate.close();
    }
  };
  const open = async (path, config) => {
    const limiter = await openLimiter({ path, config });
    clients.add(limiter);
    return limiter;
  };
  const child = (path, config, mode = 'jobs') => {
    const peer = spawn(
      process.execPath,
      [new URL(import.meta.url).pathname, 'peer', path, JSON.stringify(config), mode],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    children.add(peer);
    let stdout = '',
      stderr = '';
    peer.stdout.on('data', (value) => {
      stdout += value;
    });
    peer.stderr.on('data', (value) => {
      stderr += value;
    });
    const ended = once(peer, 'close');
    const result = ended.then(([code]) => {
      assert.equal(code, 0, stderr);
      return JSON.parse(stdout.trim().split('\n').at(-1));
    });
    void result.catch(() => {});
    return { peer, ended, result };
  };
  const admissions = (state) => state.trace.filter((row) => row.kind === 'admitted');
  let passed = 0;
  const test = async (name, body) => {
    await body(join(root, String(passed)));
    console.log('PASS ' + name);
    passed++;
  };
  const watchdog = setTimeout(() => {
    for (const child of children) {
      child.kill('SIGKILL');
    }
    console.error('budget conformance deadline exceeded');
    process.exit(1);
  }, 30_000);
  console.log(
    `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform} store=${root}`,
  );
  try {
    await test('two processes atomically share weighted capacity and finite tokens', async (path) => {
      const config = { maxConcurrent: 5, reservoir: 12 };
      const results = await Promise.all([child(path, config).result, child(path, config).result]);
      const state = results.sort((a, b) => admissions(b).length - admissions(a).length)[0];
      assert.equal(admissions(state).length, 8);
      assert.equal(state.reservoir, 0);
      assert.equal(new Set(admissions(state).map((row) => row.owner)).size, 2);
      assert.ok(state.trace.every((row) => row.active >= 0 && row.active <= 5));
      assert.ok(state.trace.some((row) => row.active > 1));
    });
    await test('denied and cancelled weighted jobs leave tokens and timing unchanged', async (path) => {
      const limiter = await open(path, { maxConcurrent: 3, reservoir: 1, minTime: 20 });
      const before = read(path),
        controller = new AbortController();
      const pending = limiter.schedule(() => assert.fail('cancelled job ran'), {
        weight: 2,
        signal: controller.signal,
      });
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await delay(40);
      controller.abort();
      await rejected;
      assert.deepEqual(read(path), before);
      assert.equal(await limiter.incrementReservoir(1), 2);
      await limiter.schedule(() => {}, { weight: 2 });
      assert.equal(await limiter.currentReservoir(), 0);
      await limiter.close();
    });
    await test('a peer adjustment wakes an exhausted reservoir without polling', async (path) => {
      const config = { maxConcurrent: 2, reservoir: 0 };
      const pool = new Pool(path, config, addon);
      const adjuster = child(path, config, 'increment-held');
      try {
        const [ready] = await once(adjuster.peer.stdout, 'data');
        assert.equal(JSON.parse(String(ready)).ready, true);
        const pending = pool.acquire(undefined, 2);
        void pending.catch(() => {});
        await delay(80);
        assert.deepEqual(pool.stats, { waits: 1, wakes: 0 });
        adjuster.peer.stdin.write('increment');
        const lease = await pending;
        assert.equal(adjuster.peer.exitCode, null, 'adjuster stays alive and open until admission');
        assert.deepEqual(pool.stats, { waits: 1, wakes: 1 });
        assert.equal(pool.currentReservoir(), 0);
        pool.release(lease);
        adjuster.peer.stdin.end();
        await adjuster.result;
      } finally {
        adjuster.peer.stdin.end();
        await pool.close();
      }
    });
    await test('refill resets missed windows and keeps its creation-time phase', async (path) => {
      const config = {
        maxConcurrent: 2,
        reservoir: 0,
        reservoirRefreshAmount: 3,
        reservoirRefreshInterval: 120,
      };
      const limiter = await open(path, config),
        initial = read(path).budget[0].nextRefreshAt;
      await limiter.schedule(() => {}, { weight: 2 });
      assert.equal(await limiter.currentReservoir(), 1);
      await delay(380);
      assert.equal(await limiter.currentReservoir(), 3);
      const refreshed = read(path).budget[0].nextRefreshAt;
      assert.ok(refreshed > initial);
      assert.equal((refreshed - initial) % 120, 0);
      await limiter.close();
    });
    await test('two processes cannot each spend the same refill', async (path) => {
      const config = {
        maxConcurrent: 3,
        reservoir: 0,
        reservoirRefreshAmount: 2,
        reservoirRefreshInterval: 100,
      };
      const seed = await open(path, config);
      const anchor = read(path).budget[0].nextRefreshAt - config.reservoirRefreshInterval;
      await seed.close();
      const results = await Promise.all([
        child(path, config, 'refill').result,
        child(path, config, 'refill').result,
      ]);
      const state = results.sort((a, b) => admissions(b).length - admissions(a).length)[0];
      assert.equal(admissions(state).length, 8);
      const spent = new Map();
      for (const row of admissions(state)) {
        const window = Math.floor((row.at - anchor) / config.reservoirRefreshInterval);
        assert.ok(window >= 1, 'empty initial reservoir cannot admit before the first boundary');
        spent.set(window, (spent.get(window) ?? 0) + 1);
        assert.ok(
          spent.get(window) <= config.reservoirRefreshAmount,
          'one shared allowance per creation-anchored interval',
        );
      }
    });
    await test('a refill too small for the head job does not cause periodic wakeups', async (path) => {
      const pool = new Pool(
        path,
        { maxConcurrent: 2, reservoir: 0, reservoirRefreshAmount: 1, reservoirRefreshInterval: 25 },
        addon,
      );
      const controller = new AbortController();
      try {
        const pending = pool.acquire(controller.signal, 2);
        const rejected = assert.rejects(pending, /aborted/);
        await delay(130);
        // Acceptance adds a transaction. If creation's first refill boundary
        // passes before the initial admission check, its one state change wakes
        // this subscriber once; subsequent identical refills must stay idle.
        assert.ok(pool.stats.waits <= 2 && pool.stats.wakes <= 1, JSON.stringify(pool.stats));
        controller.abort();
        await rejected;
        assert.equal(pool.currentReservoir(), 1);
      } finally {
        controller.abort();
        await pool.close();
      }
    });
    await test('slow checks cannot sustain self-notifications for insufficient refills', async (path) => {
      const pool = new Pool(
        path,
        { maxConcurrent: 2, reservoir: 0, reservoirRefreshAmount: 1, reservoirRefreshInterval: 1 },
        addon,
      );
      try {
        await delay(5);
        const buffer = new Int32Array(new SharedArrayBuffer(4));
        pool.stage = (stage) => {
          if (stage === 'afterMutation') {
            Atomics.wait(buffer, 0, 0, 12);
          }
        };
        const controller = new AbortController(),
          pending = pool.acquire(controller.signal, 2);
        const rejected = assert.rejects(pending, /aborted/);
        await delay(100);
        assert.ok(pool.stats.waits <= 2 && pool.stats.wakes <= 1, JSON.stringify(pool.stats));
        assert.equal(pool.inspect().trace.filter((row) => row.kind === 'refreshed').length, 1);
        controller.abort();
        await rejected;
      } finally {
        pool.stage = undefined;
        await pool.close();
      }
    });
    await test('callback failure spends tokens but releases weighted capacity', async (path) => {
      const limiter = await open(path, { maxConcurrent: 3, reservoir: 3 });
      await assert.rejects(
        limiter.schedule(
          () => {
            throw new Error('request failed');
          },
          { weight: 2 },
        ),
        /request failed/,
      );
      assert.equal(await limiter.currentReservoir(), 1);
      assert.equal((await limiter.inspect()).active, 0);
      await limiter.schedule(() => 1);
      assert.equal(await limiter.currentReservoir(), 0);
      await limiter.close();
    });
    await test('expiration returns weight but no tokens; late release preserves replacement', async (path) => {
      const pool = new Pool(path, { maxConcurrent: 3, reservoir: 6, expirationMs: 40 }, addon);
      try {
        const old = await pool.acquire(undefined, 3),
          replacement = await pool.acquire(undefined, 2);
        pool.release(old);
        const state = pool.inspect();
        assert.equal(state.active, 2);
        assert.equal(state.reservoir, 1);
        assert.equal(state.leases[0].id, replacement);
        assert.equal(state.leases[0].weight, 2);
        pool.release(replacement);
        assert.equal(pool.inspect().active, 0);
      } finally {
        await pool.close();
      }
    });
    await test('invalid input and balance overflow reject without poisoning healthy clients', async (path) => {
      const limiter = await open(path, { maxConcurrent: 2, reservoir: Number.MAX_SAFE_INTEGER });
      for (const weight of [0, -1, 1.5, 3, NaN, Infinity, null]) {
        await assert.rejects(
          limiter.schedule(() => assert.fail('invalid weight'), { weight }),
          /weight/i,
        );
      }
      for (const amount of [0.5, NaN, Infinity]) {
        await assert.rejects(limiter.incrementReservoir(amount), /increment/);
      }
      await assert.rejects(limiter.incrementReservoir(1), /overflow/);
      assert.equal(await limiter.currentReservoir(), Number.MAX_SAFE_INTEGER);
      assert.equal(await limiter.incrementReservoir(-1), Number.MAX_SAFE_INTEGER - 1);
      await limiter.schedule(() => {}, { weight: 2 });
      assert.equal(await limiter.currentReservoir(), Number.MAX_SAFE_INTEGER - 3);
      await limiter.close();
    });
    await test('nullable concurrency allows simultaneous jobs and explicit finite balance activation', async (path) => {
      const limiter = await open(path, { maxConcurrent: null });
      let finish,
        allStarted,
        running = 0;
      const held = new Promise((yes) => {
          finish = yes;
        }),
        started = new Promise((yes) => {
          allStarted = yes;
        });
      const jobs = Array.from({ length: 20 }, () =>
        limiter.schedule(async () => {
          if (++running === 20) {
            allStarted();
          }
          await held;
        }),
      );
      try {
        await started;
        assert.equal((await limiter.inspect()).active, 20);
        assert.equal(await limiter.currentReservoir(), null);
        assert.equal(await limiter.incrementReservoir(4), 4);
      } finally {
        finish();
        await Promise.all(jobs);
        await limiter.close();
      }
    });
    await test('unlimited capacity reports accounting overflow without stranding or poisoning jobs', async (path) => {
      const limiter = await open(path, { maxConcurrent: null });
      let finish, start;
      const held = new Promise((yes) => {
          finish = yes;
        }),
        started = new Promise((yes) => {
          start = yes;
        });
      const running = limiter.schedule(
        async () => {
          start();
          await held;
        },
        { weight: Number.MAX_SAFE_INTEGER },
      );
      try {
        await started;
        await assert.rejects(
          limiter.schedule(() => assert.fail('overflow job ran')),
          /accounting overflow/,
        );
        assert.equal((await limiter.inspect()).active, Number.MAX_SAFE_INTEGER);
      } finally {
        finish();
        await running;
      }
      assert.equal(await limiter.schedule(() => 'healthy'), 'healthy');
      await limiter.close();
    });
    await test('peer config drift preserves balances and all stored state', async (path) => {
      const config = {
        maxConcurrent: 5,
        reservoir: 10,
        reservoirRefreshAmount: 2,
        reservoirRefreshInterval: 1000,
      };
      const limiter = await open(path, config),
        before = read(path);
      await assert.rejects(
        child(path, { ...config, reservoirRefreshAmount: 3 }).result,
        /config or format mismatch/,
      );
      assert.deepEqual(read(path), before);
      await limiter.close();
      for (const extra of [
        { reservoir: -1 },
        { reservoirRefreshAmount: 1 },
        { reservoirRefreshInterval: 1 },
        { reservoirRefreshAmount: 1, reservoirRefreshInterval: 0 },
      ]) {
        await assert.rejects(
          openLimiter({ path: path + '-invalid', config: { maxConcurrent: 1, ...extra } }),
          /reservoir|refresh/i,
        );
      }
    });
    for (const stage of ['beforeCommit', 'afterCommit']) {
      await test(`admission crash at ${stage} commits lease and token debit together`, async (path) => {
        const config = { maxConcurrent: 3, reservoir: 5 };
        const seed = await open(path, config);
        await seed.close();
        const holder = child(path, config, 'crash-' + stage);
        const [output] = await once(holder.peer.stdout, 'data');
        const candidate = JSON.parse(String(output));
        holder.peer.kill('SIGKILL');
        await holder.ended;
        const state = read(path),
          committed = stage === 'afterCommit';
        assert.equal(state.budget[0].remaining, committed ? 3 : 5);
        assert.deepEqual(
          JSON.parse(JSON.stringify(state.leases)),
          committed ? [candidate.lease] : [],
        );
        assert.equal(candidate.lease.weight, 2);
        assert.equal(candidate.budget.remaining, 3);
        const limiter = await open(path, config);
        await limiter.schedule(() => {}, { weight: 2 });
        const recovered = await limiter.inspect();
        assert.equal(recovered.reservoir, committed ? 1 : 3);
        assert.equal(recovered.active, 0);
        assert.equal(
          recovered.trace.filter(
            (row) => row.kind === 'reclaimed' && row.lease === candidate.lease.id,
          ).length,
          committed ? 1 : 0,
        );
        await limiter.close();
      });
    }
    console.log(`RESULT ${passed}/15 passed`);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
    await Promise.allSettled([...clients].map((client) => client.close()));
    clearTimeout(watchdog);
  }
}
