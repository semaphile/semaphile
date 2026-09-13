import { deferred } from './fixtures/cases.mjs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ScheduledLimiter, QueueTimeoutError } from '../../packages/core/dist/src/client.js';
import { suite } from './fixtures/cases.mjs';

const { test, run } = suite();

// Controllable transport: a backend may report a committed lease after cancellation.
function fixture() {
  const grant = deferred(),
    release = deferred(),
    released = deferred();
  const state = { acquisitions: 0, signal: undefined, detached: false, leases: [] };
  class Limiter extends ScheduledLimiter {
    constructor() {
      super({
        maxConcurrent: 1,
        expirationMs: null,
        failure: undefined,
        call(action, input, signal) {
          if (action === 'acquire') {
            state.acquisitions++;
            state.signal = signal;
            return grant.promise;
          }
          if (action === 'release') {
            state.leases.push(input.lease);
            released.resolve();
            return release.promise;
          }
          throw new Error(`Unexpected action ${action}`);
        },
        async detach() {
          state.detached = true;
        },
      });
    }
  }
  return {
    limiter: new Limiter(),
    state,
    release,
    released,
    grant(expiresAt = null) {
      grant.resolve({ leaseId: 'lease', leaseGrantedAt: Date.now(), expiresAt, weight: 1 });
    },
  };
}

test('queue timeout rejects promptly; close waits for late grant and lease cleanup', async () => {
  const f = fixture();
  let started = false;
  const job = f.limiter.schedule(
    () => {
      started = true;
    },
    { queueTimeoutMs: 20 },
  );
  await assert.rejects(
    job,
    (error) => error instanceof QueueTimeoutError && error.queueTimeoutMs === 20,
  );
  assert.equal(f.state.signal.aborted, true);
  const closing = f.limiter.close({ drain: true });
  f.grant();
  await f.released.promise;
  assert.equal(started, false);
  assert.equal(f.state.detached, false);
  assert.deepEqual(f.state.leases, ['lease']);
  f.release.resolve(null);
  await closing;
  assert.equal(f.state.detached, true);
});

test('overdue admission cannot outrun a delayed queue timer', async () => {
  const f = fixture();
  const job = f.limiter.schedule(() => assert.fail('expired queued work started'), {
    queueTimeoutMs: 10,
  });
  const rejected = assert.rejects(job, QueueTimeoutError);
  // Block this thread so promise delivery precedes the runtime's overdue timer.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  f.grant();
  await rejected;
  await f.released.promise;
  f.release.resolve(null);
  await f.limiter.close();
});

test('queue deadline ends at callback start and does not cancel running work', async () => {
  const f = fixture();
  const started = deferred(),
    finish = deferred();
  const job = f.limiter.schedule(
    async () => {
      started.resolve();
      await finish.promise;
      return 42;
    },
    { queueTimeoutMs: 30 },
  );
  f.grant();
  await started.promise;
  await delay(50);
  assert.equal(f.state.signal.aborted, false);
  const closing = f.limiter.close();
  assert.equal(f.state.detached, false);
  finish.resolve();
  await f.released.promise;
  f.release.resolve(null);
  assert.equal(await job, 42);
  await closing;
});

test('queued abort wins over the later deadline and still releases a late lease', async () => {
  const f = fixture(),
    controller = new AbortController();
  const job = f.limiter.schedule(() => assert.fail('aborted callback started'), {
    signal: controller.signal,
    queueTimeoutMs: 20,
  });
  controller.abort();
  await assert.rejects(job, { name: 'AbortError' });
  await delay(30);
  f.grant();
  await f.released.promise;
  f.release.resolve(null);
  await f.limiter.close();
});

test('invalid queue deadlines reject before reaching the backend', async () => {
  const f = fixture();
  for (const queueTimeoutMs of [0, -1, 1.5, NaN, Infinity, 2_147_483_648, null, '10']) {
    await assert.rejects(
      f.limiter.schedule(() => 1, { queueTimeoutMs }),
      RangeError,
    );
  }
  assert.equal(f.state.acquisitions, 0);
  await f.limiter.close();
});

test('expired admission cleanup does not disable a deadline before callback start', async () => {
  const f = fixture();
  const job = f.limiter.schedule(() => assert.fail('expired lease started'), {
    queueTimeoutMs: 20,
  });
  f.grant(Date.now() - 1);
  await assert.rejects(job, QueueTimeoutError);
  assert.equal(f.state.signal.aborted, true);
  const closing = f.limiter.close();
  assert.equal(f.state.detached, false);
  f.release.resolve(null);
  await closing;
});

test('omitted queue deadline continues waiting until admission', async () => {
  const f = fixture();
  const job = f.limiter.schedule(() => 'ok');
  await delay(25);
  assert.equal(f.state.signal.aborted, false);
  f.release.resolve(null);
  f.grant();
  assert.equal(await job, 'ok');
  await f.limiter.close();
});

test('SQLite queue deadline preserves a peer lease and unspent reservoir tokens', async () => {
  const { openLimiter } = await import('../../packages/core/dist/src/index.js');
  const { mkdir, mkdtemp } = await import('node:fs/promises');
  await mkdir('.tmp/queue-deadlines', { recursive: true });
  const path = await mkdtemp('.tmp/queue-deadlines/run-');
  const config = { maxConcurrent: 1, reservoir: 2 };
  const a = await openLimiter({ path, config }),
    b = await openLimiter({ path, config });
  const started = deferred(),
    finish = deferred();
  const held = a.schedule(async () => {
    started.resolve();
    await finish.promise;
  });
  try {
    await started.promise;
    await assert.rejects(
      b.schedule(() => assert.fail('blocked callback started'), { queueTimeoutMs: 30 }),
      QueueTimeoutError,
    );
    const state = await a.inspect();
    assert.equal(state.active, 1);
    assert.equal(state.reservoir, 1);
    await b.close({ drain: true });
    finish.resolve();
    await held;
    assert.equal(await a.schedule(() => 'next'), 'next');
    assert.equal(await a.currentReservoir(), 0);
  } finally {
    finish.resolve();
    await held;
    await Promise.all([a.close(), b.close()]);
  }
});

await run();
