import { nativePath } from '../../packages/core/dist/src/native-path.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, symlink, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { platform, release } from 'node:os';
import { openLimiter } from '../../packages/core/dist/src/index.js';

await mkdir('.tmp/typescript-core', { recursive: true });
const root = await mkdtemp('.tmp/typescript-core/run-');
const addon = nativePath();
const opened = new Set();
const children = new Set();
let serial = 0;
const tests = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
function within(promise, name) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout: ' + name)), 8000);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function open(path, config = { maxConcurrent: 1 }) {
  const limiter = await within(openLimiter({ path, config }), 'open');
  opened.add(limiter);
  return limiter;
}
function test(name, run) {
  tests.push([name, () => run(join(root, 'pool-' + serial++))]);
}
async function holdGate(path) {
  await mkdir(path, { recursive: true });
  const child = spawn(
    process.execPath,
    [new URL('./gate-owner.mjs', import.meta.url).pathname, addon, join(path, 'coordination.lock')],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  children.add(child);
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const exit = once(child, 'close');
  const [line] = await within(once(child.stdout, 'data'), 'gate held');
  assert.match(String(line), /held/, stderr);
  return async () => {
    child.stdin.end('x');
    const [code] = await within(exit, 'gate release');
    assert.equal(code, 0, stderr);
  };
}

test('two-process gate contention leaves application event loop responsive', async (path) => {
  const releaseGate = await holdGate(path);
  let resolved = false;
  const opening = open(path).then((value) => {
    resolved = true;
    return value;
  });
  const started = performance.now();
  await delay(75);
  assert.ok(
    performance.now() - started < 500,
    'gate contention blocked the application event loop',
  );
  assert.equal(resolved, false, 'gate owner should still prevent open');
  await releaseGate();
  const limiter = await opening;
  assert.equal(await limiter.schedule(() => 42), 42);
  await limiter.close();
});

if (process.env.SEMAPHILE_TEST_GATE_ONLY !== '1') {
  test('release and inspect contention stay off the application event loop', async (path) => {
    const limiter = await open(path),
      started = deferred(),
      finish = deferred();
    const job = limiter.schedule(async () => {
      started.resolve();
      await finish.promise;
      return 'finished';
    });
    await started.promise;
    const releaseGate = await holdGate(path);
    let finished = false;
    job.then(() => {
      finished = true;
    });
    const inspect = limiter.inspect();
    finish.resolve();
    const at = performance.now();
    await delay(75);
    assert.ok(performance.now() - at < 500, 'release/inspect blocked application thread');
    assert.equal(finished, false, 'job result waits for lease release');
    await releaseGate();
    await inspect;
    assert.equal(await job, 'finished');
    await limiter.close();
  });
  test('same-pool clients share capacity and return callback values', async (path) => {
    const [a, b] = await Promise.all([
      open(path, { maxConcurrent: 2 }),
      open(path, { maxConcurrent: 2 }),
    ]);
    let active = 0,
      peak = 0;
    const jobs = Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? a : b).schedule(async () => {
        active++;
        peak = Math.max(peak, active);
        assert.ok(active <= 2);
        await delay(10);
        active--;
        return i;
      }),
    );
    assert.deepEqual(
      await Promise.all(jobs),
      Array.from({ length: 20 }, (_, i) => i),
    );
    assert.equal(peak, 2);
    const snapshot = await a.inspect();
    assert.equal(snapshot.active, 0);
    assert.equal(
      new Set(snapshot.trace.filter((row) => row.kind === 'admitted').map((row) => row.owner)).size,
      1,
      'clients share one backend owner',
    );
    await Promise.all([a.close(), b.close()]);
  });
  test('default close rejects queued jobs and awaits running callback', async (path) => {
    const limiter = await open(path),
      started = deferred(),
      finish = deferred();
    const running = limiter.schedule(async () => {
      started.resolve();
      await finish.promise;
      return 'done';
    });
    await started.promise;
    let ran = false;
    const queued = limiter.schedule(() => {
      ran = true;
    });
    const rejected = assert.rejects(queued, /closing/);
    const close = limiter.close();
    assert.equal(
      limiter.close({ drain: true }),
      close,
      'first close determines behavior and promise identity',
    );
    let closed = false;
    close.then(() => {
      closed = true;
    });
    await rejected;
    await delay(25);
    assert.equal(closed, false);
    assert.equal(ran, false);
    await assert.rejects(
      limiter.schedule(() => {}),
      /closing/,
    );
    finish.resolve();
    assert.equal(await running, 'done');
    await close;
  });
  test('drain close finishes queued jobs and first close wins', async (path) => {
    const limiter = await open(path),
      started = deferred(),
      finish = deferred();
    const running = limiter.schedule(async () => {
      started.resolve();
      await finish.promise;
      return 1;
    });
    await started.promise;
    const queued = limiter.schedule(() => 2);
    const close = limiter.close({ drain: true });
    assert.equal(limiter.close(), close);
    await assert.rejects(
      limiter.schedule(() => 3),
      /closing/,
    );
    finish.resolve();
    assert.deepEqual(await Promise.all([running, queued]), [1, 2]);
    await close;
  });
  test('closing one client preserves another client queue and leases', async (path) => {
    const [a, b] = await Promise.all([open(path), open(path)]);
    const started = deferred(),
      finish = deferred();
    const running = a.schedule(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    const queued = b.schedule(() => 'other client');
    const close = a.close();
    finish.resolve();
    await running;
    await close;
    assert.equal(await queued, 'other client');
    assert.equal(await b.schedule(() => 7), 7);
    await b.close();
  });
  test('queued abort does not start callback or leak a lease', async (path) => {
    const [a, b] = await Promise.all([open(path), open(path)]);
    const started = deferred(),
      finish = deferred(),
      controller = new AbortController();
    const running = a.schedule(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    let ran = false;
    const queued = b.schedule(
      () => {
        ran = true;
      },
      { signal: controller.signal },
    );
    const rejected = assert.rejects(queued, { name: 'AbortError' });
    controller.abort();
    await rejected;
    const close = b.close();
    finish.resolve();
    await running;
    await close;
    assert.equal(ran, false);
    assert.equal((await a.inspect()).active, 0);
    await a.close();
  });
  test('cancel during gate wait releases a late admission before close resolves', async (path) => {
    const limiter = await open(path),
      releaseGate = await holdGate(path),
      controller = new AbortController();
    let ran = false;
    const job = limiter.schedule(
      () => {
        ran = true;
      },
      { signal: controller.signal },
    );
    const rejected = assert.rejects(job, { name: 'AbortError' });
    await delay(75);
    controller.abort();
    await rejected;
    const closing = limiter.close();
    await releaseGate();
    await closing;
    assert.equal(ran, false);
    const fresh = await open(path);
    assert.equal((await fresh.inspect()).active, 0);
    await fresh.close();
  });
  test('throwing and rejecting callbacks release leases', async (path) => {
    const limiter = await open(path);
    await assert.rejects(
      limiter.schedule(() => {
        throw new Error('sync failure');
      }),
      /sync failure/,
    );
    await assert.rejects(
      limiter.schedule(async () => {
        throw new Error('async failure');
      }),
      /async failure/,
    );
    assert.equal(await limiter.schedule(() => 9), 9);
    assert.equal((await limiter.inspect()).active, 0);
    await limiter.close();
  });
  test('canonical path aliases share coordinator; complete config mismatch fails', async (path) => {
    const a = await open(path);
    const alias = path + '-alias';
    await symlink(resolve(path), alias);
    const b = await open(alias);
    await assert.rejects(
      openLimiter({ path: alias, config: { maxConcurrent: 1, expirationMs: 100 } }),
      /config mismatch/,
    );
    await a.close();
    assert.equal(await b.schedule(() => true), true);
    await b.close();
  });
  test('falsy callback failures reject with original reason and release capacity', async (path) => {
    const limiter = await open(path);
    for (const reason of [undefined, null, false, 0, '']) {
      const results = await Promise.allSettled([
        limiter.schedule(() => {
          throw reason;
        }),
        limiter.schedule(() => Promise.reject(reason)),
      ]);
      assert.deepEqual(results, [
        { status: 'rejected', reason },
        { status: 'rejected', reason },
      ]);
      assert.equal((await limiter.inspect()).active, 0);
    }
    assert.equal(await limiter.schedule(() => 42), 42);
    await limiter.close();
  });
  test('pre-aborted work never starts, running-work abort does not release early', async (path) => {
    const limiter = await open(path),
      controller = new AbortController();
    controller.abort();
    await assert.rejects(
      limiter.schedule(() => assert.fail('must not run'), { signal: controller.signal }),
      { name: 'AbortError' },
    );
    const activeController = new AbortController(),
      started = deferred(),
      finish = deferred();
    const active = limiter.schedule(
      async () => {
        started.resolve();
        await finish.promise;
      },
      { signal: activeController.signal },
    );
    await started.promise;
    activeController.abort();
    assert.equal((await limiter.inspect()).active, 1);
    finish.resolve();
    await active;
    await limiter.close();
  });
  test('last-client close permits a clean subsequent open', async (path) => {
    for (let i = 0; i < 8; i++) {
      const a = await open(path);
      assert.equal(await a.schedule(() => i), i);
      await a.close();
    }
  });
  test('opening during last-client teardown waits for a fresh coordinator', async (path) => {
    const first = await open(path),
      releaseGate = await holdGate(path);
    const closing = first.close();
    await delay(75);
    let ready = false;
    const opening = open(path).then((value) => {
      ready = true;
      return value;
    });
    await delay(75);
    assert.equal(ready, false);
    await releaseGate();
    await closing;
    const second = await opening;
    assert.equal(await second.schedule(() => 1), 1);
    await second.close();
  });
  test('duplicate module imports share the versioned runtime registry', async (path) => {
    const duplicate =
      await import('../../packages/core/dist/src/index.js?separate-module-instance');
    const a = await open(path);
    const b = await duplicate.openLimiter({ path, config: { maxConcurrent: 1 } });
    opened.add(b);
    await a.schedule(() => {});
    await b.schedule(() => {});
    const owners = new Set(
      (await a.inspect()).trace.filter((row) => row.kind === 'admitted').map((row) => row.owner),
    );
    assert.equal(owners.size, 1);
    await a.close();
    await b.close();
  });
  test('independent Node worker runtimes cooperate through the same pool', async (path) => {
    const workers = [0, 1].map(
      () =>
        new Worker(new URL('./runtime-client.mjs', import.meta.url), {
          workerData: { path: resolve(path) },
        }),
    );
    const results = await Promise.all(
      workers.map(async (worker) => {
        const exit = once(worker, 'exit');
        const [message] = await within(once(worker, 'message'), 'runtime worker result');
        assert.deepEqual(message, { ok: true });
        assert.deepEqual(await within(exit, 'runtime worker exit'), [0]);
      }),
    );
    assert.equal(results.length, 2);
    const observer = await open(path, { maxConcurrent: 2 });
    const snapshot = await observer.inspect();
    assert.equal(snapshot.active, 0);
    const admissions = snapshot.trace.filter((row) => row.kind === 'admitted');
    assert.equal(admissions.length, 8);
    assert.equal(new Set(admissions.map((row) => row.owner)).size, 2);
    assert.ok(snapshot.trace.every((row) => row.active <= 2));
    await observer.close();
  });
  test('inspection failure stops already queued admissions but permits cleanup', async (path) => {
    const [a, b] = await Promise.all([open(path), open(path)]);
    const started = deferred(),
      finish = deferred();
    const running = a.schedule(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    let ran = false;
    const queued = b.schedule(() => {
      ran = true;
    });
    const rejected = assert.rejects(queued, /trace/);
    await delay(50);
    const native = new (createRequire(import.meta.url)(addon).NativeContext)();
    const change = (sql) => {
      const gate = native.open(join(path, 'coordination.lock'), 'gate');
      try {
        gate.withGate(() => {
          const db = new DatabaseSync(join(path, 'state.sqlite'));
          try {
            db.exec(sql);
          } finally {
            db.close();
          }
        });
      } finally {
        gate.close();
      }
    };
    change('ALTER TABLE trace RENAME TO trace_injected_failure');
    await assert.rejects(a.inspect(), /trace/);
    await rejected;
    change('ALTER TABLE trace_injected_failure RENAME TO trace');
    finish.resolve();
    await running;
    assert.equal(ran, false);
    assert.equal((await a.inspect()).active, 0);
    await assert.rejects(
      a.schedule(() => {}),
      /trace/,
    );
    await Promise.all([a.close(), b.close()]);
  });
  test('acquisition failure still releases another client running lease', async (path) => {
    const [a, b] = await Promise.all([open(path), open(path)]);
    const started = deferred(),
      finish = deferred();
    const running = a.schedule(async () => {
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    await rename(join(path, 'notify'), join(path, 'notify-hidden'));
    await assert.rejects(
      b.schedule(() => assert.fail('must not run')),
      /subscribe/,
    );
    await rename(join(path, 'notify-hidden'), join(path, 'notify'));
    finish.resolve();
    await running;
    assert.equal((await b.inspect()).active, 0);
    await Promise.all([a.close(), b.close()]);
  });
  test('failed graceful backend close retires owner under gate and wakes a peer', async (path) => {
    const actors = [0, 1].map(() => {
      const worker = new Worker(new URL('./backend-failure.mjs', import.meta.url), {
        workerData: { path: resolve(path), addon },
      });
      const exit = once(worker, 'exit');
      const messages = [],
        requests = new Map();
      let listener,
        sequence = 0;
      worker.on('message', (message) => {
        if (message.id !== undefined) {
          const request = requests.get(message.id);
          requests.delete(message.id);
          if (message.error) {
            request.reject(new Error(message.error));
          } else {
            request.resolve(message.value);
          }
        } else {
          messages.push(message);
          listener?.();
        }
      });
      return {
        worker,
        exit,
        event: (name) =>
          within(
            new Promise((resolveEvent) => {
              listener = () => {
                const index = messages.findIndex((message) => message.event === name);
                if (index >= 0) {
                  listener = undefined;
                  resolveEvent(messages.splice(index, 1)[0]);
                }
              };
              listener();
            }),
            name,
          ),
        call: (action, extra = {}) =>
          within(
            new Promise((resolveRequest, reject) => {
              const id = sequence++;
              requests.set(id, { resolve: resolveRequest, reject });
              worker.postMessage({ id, action, ...extra });
            }),
            action,
          ),
      };
    });
    const [a, b] = actors;
    try {
      await Promise.all(actors.map((actor) => actor.event('ready')));
      await a.call('acquire');
      const queued = b.call('acquire');
      await b.event('waiting');
      const failure = await a.call('failClose');
      assert.match(failure.error, /injected cleanup transaction failure/);
      assert.equal(failure.gateHeld, true, 'lifetime lock must retire before the gate unlocks');
      assert.equal(failure.pid, process.pid, 'the owner process survives failed close');
      const lease = await queued;
      await b.call('release', { lease });
    } finally {
      await Promise.all(actors.map((actor) => actor.call('close')));
      for (const actor of actors) {
        assert.deepEqual(await within(actor.exit, 'fault actor exit'), [0]);
      }
    }
  });
}
assert.notEqual(process.geteuid(), 0, 'run conformance as an ordinary user');
console.log(
  `platform=${platform()} release=${release()} node=${process.version} uid=${process.geteuid()}`,
);
console.log('store=' + resolve(root));
let passed = 0;
try {
  for (const [name, run] of tests) {
    await within(run(), name);
    passed++;
    console.log('PASS ' + name);
  }
  console.log(`RESULT ${passed}/${tests.length} passed`);
} catch (error) {
  console.error(error);
  console.log(`RESULT ${passed}/${tests.length} passed; remaining cases not completed`);
  process.exitCode = 1;
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  const cleanup = await Promise.allSettled(
    [...opened].map((limiter) => within(limiter.close(), 'cleanup')),
  );
  for (const result of cleanup) {
    if (result.status === 'rejected') {
      console.error(result.reason);
      process.exitCode = 1;
    }
  }
  if (process.exitCode) {
    process.exit(process.exitCode);
  } // Bound failed-fixture cleanup, including hung callbacks.
}
