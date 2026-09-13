import { fileURLToPath } from 'node:url';
import { nativePath } from '../../packages/core/dist/src/native-path.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { Pool } from '../../packages/core/dist/src/backend.js';

if (process.argv[2] === 'peer') {
  if (process.argv[5].startsWith('crash-')) {
    const pool = new Pool(process.argv[3], JSON.parse(process.argv[4]), nativePath());
    const operation = pool.acceptOperation('admission-crash-fixture');
    pool.stage = (stage) => {
      if (stage === process.argv[5].slice(6)) {
        writeSync(
          1,
          JSON.stringify({
            stage,
            nextAllowedAt: pool.db.prepare('SELECT nextAllowedAt FROM timing').get().nextAllowedAt,
            lease: pool.db.prepare('SELECT * FROM leases').get(),
          }) + '\n',
        );
        process.kill(process.pid, 'SIGSTOP');
      }
    };
    await pool.acquireDetailed(undefined, 1, undefined, { operation });
    throw new Error('crash fixture unexpectedly resumed');
  }
  const limiter = await openLimiter({ path: process.argv[3], config: JSON.parse(process.argv[4]) });
  if (process.argv[5] === 'hold') {
    await limiter.schedule(async () => {
      console.log(JSON.stringify({ admitted: true }));
      await new Promise(() => {});
    });
  } else {
    await Promise.all(Array.from({ length: 8 }, () => limiter.schedule(() => delay(50))));
    console.log(JSON.stringify(await limiter.inspect()));
    await limiter.close();
  }
} else {
  assert.notEqual(process.getuid?.(), 0);
  await mkdir('.tmp/min-time', { recursive: true });
  const root = await mkdtemp('.tmp/min-time/run-');
  const clients = new Set(),
    children = new Set();
  const config = { maxConcurrent: 5, minTime: 30 };
  const native = new (createRequire(import.meta.url)(nativePath()).NativeContext)();
  const readState = (path) => {
    const gate = native.open(join(path, 'coordination.lock'), 'gate');
    try {
      return gate.withGate(() => {
        const db = new DatabaseSync(join(path, 'state.sqlite'));
        try {
          return {
            nextAllowedAt: db.prepare('SELECT nextAllowedAt FROM timing WHERE singleton=1').get()
              .nextAllowedAt,
            leases: db.prepare('SELECT * FROM leases ORDER BY id').all(),
            owners: db.prepare('SELECT * FROM owners ORDER BY id').all(),
            config: db.prepare('SELECT * FROM config').all(),
            trace: db.prepare('SELECT * FROM trace ORDER BY seq').all(),
          };
        } finally {
          db.close();
        }
      });
    } finally {
      gate.close();
    }
  };
  const readTiming = (path) => readState(path).nextAllowedAt;
  const admissions = (state) => state.trace.filter((row) => row.kind === 'admitted');
  const open = async (path, config) => {
    const value = await openLimiter({ path, config });
    clients.add(value);
    return value;
  };
  const child = (path, config, mode = 'jobs') => {
    const peer = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), 'peer', path, JSON.stringify(config), mode],
      { stdio: ['ignore', 'pipe', 'pipe'] },
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
      return JSON.parse(stdout);
    });
    void result.catch(() => {});
    return { peer, ended, result };
  };
  let passed = 0;
  const test = async (name, body) => {
    await body(join(root, String(passed)));
    console.log('PASS ' + name);
    passed++;
  };
  const watchdog = setTimeout(() => {
    console.error('conformance deadline exceeded');
    for (const child of children) {
      child.kill('SIGKILL');
    }
    process.exit(1);
  }, 25_000);
  console.log(
    `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform} store=${root}`,
  );
  try {
    await test('two processes share admission spacing and capacity', async (path) => {
      const [a, b] = await Promise.all([child(path, config).result, child(path, config).result]);
      const state = admissions(a).length > admissions(b).length ? a : b;
      const rows = admissions(state);
      assert.equal(rows.length, 16);
      assert.equal(new Set(rows.map((row) => row.owner)).size, 2);
      for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i].at - rows[i - 1].at >= config.minTime);
      }
      assert.ok(state.trace.every((row) => row.active >= 0 && row.active <= config.maxConcurrent));
    });
    await test('queued cancellation consumes no spacing reservation', async (path) => {
      const limiter = await open(path, { maxConcurrent: 2, minTime: 200 });
      await limiter.schedule(() => {});
      const before = readTiming(path);
      const signal = new AbortController();
      const cancelled = limiter.schedule(() => assert.fail('cancelled callback ran'), {
        signal: signal.signal,
      });
      const rejected = assert.rejects(cancelled, { name: 'AbortError' });
      await delay(30);
      signal.abort();
      await rejected;
      assert.equal(admissions(await limiter.inspect()).length, 1);
      assert.equal(
        readTiming(path),
        before,
        'denial/cancellation must not reserve a future interval',
      );
      await limiter.schedule(() => {});
      assert.equal(admissions(await limiter.inspect()).length, 2);
      await limiter.close();
    });
    await test('spacing persists through last-client close and reopen', async (path) => {
      const config = { maxConcurrent: 2, minTime: 300 };
      const a = await open(path, config);
      await a.schedule(() => {});
      await a.close();
      const b = await open(path, config);
      await b.schedule(() => {});
      const rows = admissions(await b.inspect());
      assert.equal(rows.length, 2);
      assert.notEqual(rows[0].owner, rows[1].owner);
      assert.ok(rows[1].at - rows[0].at >= config.minTime);
      await b.close();
    });
    await test('live-owner expiration does not refund spacing', async (path) => {
      // Leave room for worker delivery under conformance load while retaining
      // an expiration well before the next permitted admission.
      const limiter = await open(path, { maxConcurrent: 1, minTime: 500, expirationMs: 150 });
      let finish, start;
      const held = new Promise((yes) => {
          finish = yes;
        }),
        started = new Promise((yes) => {
          start = yes;
        });
      const first = limiter.schedule(async () => {
        start();
        await held;
      });
      try {
        await Promise.race([started, first]);
        await limiter.schedule(() => {});
        const state = await limiter.inspect(),
          rows = admissions(state);
        assert.ok(state.trace.some((row) => row.kind === 'expired'));
        assert.ok(rows[1].at - rows[0].at >= 500);
      } finally {
        finish();
        await first;
        await limiter.close();
      }
    });
    await test('complete normalized spacing config validates across clients', async (path) => {
      const a = await open(path, { maxConcurrent: 1 });
      const b = await open(path, { maxConcurrent: 1, minTime: 0 });
      await assert.rejects(
        openLimiter({ path, config: { maxConcurrent: 1, minTime: 1 } }),
        /config mismatch/i,
      );
      for (const minTime of [-1, 1.5, NaN, Infinity, null, '5', 2_147_483_648]) {
        await assert.rejects(
          openLimiter({ path, config: { maxConcurrent: 1, minTime } }),
          /minTime/,
        );
      }
      await a.close();
      await b.close();
    });
    await test('peer-process spacing mismatch preserves all persisted state', async (path) => {
      const limiter = await open(path, { maxConcurrent: 1, minTime: 200 });
      await limiter.schedule(() => {});
      const before = readState(path);
      await assert.rejects(
        child(path, { maxConcurrent: 1, minTime: 201 }).result,
        /config or format mismatch/,
      );
      assert.deepEqual(readState(path), before);
      await limiter.close();
    });
    await test('old format is rejected without changing its logical state', async (path) => {
      await mkdir(path);
      const db = new DatabaseSync(join(path, 'state.sqlite'));
      db.exec('CREATE TABLE config(singleton INTEGER PRIMARY KEY,format TEXT,value TEXT)');
      db.prepare('INSERT INTO config VALUES(1,?,?)').run(
        'semaphile-sqlite-poc/1.1',
        '{"maxConcurrent":1,"expirationMs":null}',
      );
      const before = db.prepare('SELECT * FROM config').all();
      db.close();
      await assert.rejects(openLimiter({ path, config: { maxConcurrent: 1 } }), /format mismatch/);
      const after = new DatabaseSync(join(path, 'state.sqlite'));
      try {
        assert.deepEqual(after.prepare('SELECT * FROM config').all(), before);
        assert.equal(
          after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n,
          1,
        );
      } finally {
        after.close();
      }
    });
    await test('spacing wait blocks once until its computed deadline or cancellation', async (path) => {
      const pool = new Pool(path, { maxConcurrent: 2, minTime: 1000 }, nativePath());
      try {
        const first = await pool.acquire();
        pool.release(first);
        const signal = new AbortController();
        const pending = pool.acquire(signal.signal);
        const rejected = assert.rejects(pending, /aborted/);
        await delay(80);
        assert.deepEqual(pool.stats, { waits: 1, wakes: 0 });
        signal.abort();
        await rejected;
      } finally {
        await pool.close();
      }
    });
    await test('owner SIGKILL reclaims capacity without refunding spacing', async (path) => {
      const config = { maxConcurrent: 1, minTime: 700 };
      const holder = child(path, config, 'hold');
      await once(holder.peer.stdout, 'data');
      assert.equal(holder.peer.kill('SIGKILL'), true);
      await holder.ended;
      const limiter = await open(path, config);
      await limiter.schedule(() => {});
      const state = await limiter.inspect(),
        rows = admissions(state);
      assert.ok(state.trace.some((row) => row.kind === 'reclaimed'));
      assert.ok(rows[1].at - rows[0].at >= config.minTime);
      await limiter.close();
    });
    for (const stage of ['beforeCommit', 'afterCommit']) {
      await test(`admission SIGKILL at ${stage} preserves atomic timing and lease state`, async (path) => {
        const config = { maxConcurrent: 1, minTime: 500 };
        const seed = await open(path, config);
        await seed.schedule(() => {});
        await seed.close();
        const previous = readTiming(path);
        const holder = child(path, config, 'crash-' + stage);
        const [output] = await once(holder.peer.stdout, 'data');
        const candidate = JSON.parse(String(output));
        assert.ok(candidate.nextAllowedAt > previous);
        holder.peer.kill('SIGKILL');
        await holder.ended;
        const recovered = readState(path);
        assert.equal(
          recovered.nextAllowedAt,
          stage === 'beforeCommit' ? previous : candidate.nextAllowedAt,
        );
        assert.deepEqual(
          JSON.parse(JSON.stringify(recovered.leases)),
          stage === 'beforeCommit' ? [] : [candidate.lease],
        );
        assert.equal(admissions(recovered).length, stage === 'beforeCommit' ? 1 : 2);
        const limiter = await open(path, config);
        await limiter.schedule(() => {});
        const state = await limiter.inspect(),
          rows = admissions(state);
        assert.equal(rows.length, stage === 'beforeCommit' ? 2 : 3);
        if (stage === 'afterCommit') {
          assert.ok(rows[2].at >= candidate.nextAllowedAt);
          assert.equal(
            state.trace.filter(
              (row) => row.kind === 'reclaimed' && row.lease === candidate.lease.id,
            ).length,
            1,
          );
          assert.equal(state.active, 0);
        }
        await limiter.close();
      });
    }
    console.log(`RESULT ${passed}/11 passed`);
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
