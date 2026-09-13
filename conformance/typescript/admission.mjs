import { deferred } from './fixtures/cases.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openLimiter, LeaseExpiredError } from '../../packages/core/dist/src/index.js';

assert.notEqual(process.getuid?.(), 0);
await mkdir('.tmp/admission', { recursive: true });
const root = await mkdtemp('.tmp/admission/run-');
const clients = new Set();
const open = async (path, config) => {
  const limiter = await openLimiter({ path, config });
  clients.add(limiter);
  return limiter;
};
let passed = 0;
const test = async (name, body) => {
  await body(join(root, String(passed)));
  console.log('PASS ' + name);
  passed++;
};
const watchdog = setTimeout(() => {
  console.error('admission conformance deadline exceeded');
  process.exit(1);
}, 15_000);
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform} store=${root}`,
);
try {
  await test('callback receives immutable metadata from the actual admission transaction', async (path) => {
    const limiter = await open(path, { maxConcurrent: 3, expirationMs: 5000 });
    const value = await limiter.schedule(
      async (admission) => {
        const state = await limiter.inspect(),
          lease = state.leases.find((row) => row.id === admission.leaseId);
        const trace = state.trace.find(
          (row) => row.lease === admission.leaseId && row.kind === 'admitted',
        );
        assert.equal(admission.leaseGrantedAt, trace.at);
        assert.equal(admission.expiresAt, lease.expires);
        assert.equal(admission.weight, lease.weight);
        assert.equal(admission.weight, 2);
        assert.equal(admission.expiresAt - admission.leaseGrantedAt, 5000);
        assert.equal(Object.isFrozen(admission), true);
        assert.equal(Reflect.set(admission, 'leaseId', 'wrong-lease'), false);
        return 42;
      },
      { weight: 2 },
    );
    assert.equal(value, 42);
    assert.equal((await limiter.inspect()).active, 0);
    await limiter.close();
  });
  await test('per-request expiration overrides the pool without ending a running callback', async (path) => {
    const limiter = await open(path, { maxConcurrent: 1, expirationMs: 5000 });
    const started = deferred(),
      finish = deferred();
    let firstCompleted = false;
    const first = limiter.schedule(
      async (admission) => {
        started.resolve(admission);
        await finish.promise;
        firstCompleted = true;
      },
      { expirationMs: 60 },
    );
    try {
      const original = await started.promise;
      assert.equal(original.expiresAt - original.leaseGrantedAt, 60);
      const next = await limiter.schedule((admission) => admission, { expirationMs: null });
      assert.equal(next.expiresAt, null);
      assert.ok(next.leaseGrantedAt >= original.expiresAt);
      assert.equal(firstCompleted, false);
      assert.ok(
        (await limiter.inspect()).trace.some(
          (row) => row.kind === 'expired' && row.lease === original.leaseId,
        ),
      );
    } finally {
      finish.resolve();
      await first;
      await limiter.close();
    }
  });
  await test('explicit null disables pool expiry for that request only', async (path) => {
    const limiter = await open(path, { maxConcurrent: 1, expirationMs: 40 });
    const started = deferred(),
      finish = deferred(),
      controller = new AbortController();
    const first = limiter.schedule(
      async (admission) => {
        started.resolve(admission);
        await finish.promise;
      },
      { expirationMs: null },
    );
    let second;
    try {
      assert.equal((await started.promise).expiresAt, null);
      second = limiter.schedule(() => assert.fail('occupied slot admitted a second request'), {
        signal: controller.signal,
      });
      const rejected = assert.rejects(second, { name: 'AbortError' });
      await delay(90);
      assert.equal((await limiter.inspect()).active, 1);
      controller.abort();
      await rejected;
    } finally {
      controller.abort();
      finish.resolve();
      await first;
      await second?.catch(() => {});
    }
    const next = await limiter.schedule((admission) => admission);
    assert.equal(next.expiresAt - next.leaseGrantedAt, 40);
    await limiter.close();
  });
  await test('expired worker delivery rejects before dispatch and preserves future usability', async (path) => {
    const limiter = await open(path, { maxConcurrent: 1 });
    let ran = false;
    let observed;
    // Test-only access to this client's internal transport: precede its
    // normal message listener, after a real committed grant is confirmed.
    const worker = limiter.backend.worker;
    const holdDelivery = (message) => {
      if (!message.value?.leaseId || observed) {
        return;
      }
      observed = message.value;
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        Math.max(0, observed.expiresAt - Date.now()) + 10,
      );
    };
    worker.prependListener('message', holdDelivery);
    try {
      await assert.rejects(
        limiter.schedule(
          () => {
            ran = true;
          },
          { expirationMs: 50 },
        ),
        (error) => {
          assert.ok(observed, 'fixture must observe actual admission before delaying delivery');
          assert.ok(error instanceof LeaseExpiredError);
          assert.equal(error.admission.leaseId, observed.leaseId);
          assert.ok(error.admission.expiresAt <= Date.now());
          assert.equal(error.admission.expiresAt - error.admission.leaseGrantedAt, 50);
          return true;
        },
      );
    } finally {
      worker.off('message', holdDelivery);
    }
    assert.equal(ran, false);
    assert.equal((await limiter.inspect()).active, 0);
    assert.equal(await limiter.schedule(() => 'healthy'), 'healthy');
    await limiter.close();
  });
  await test('invalid per-call expiration never reaches admission or poisons the pool', async (path) => {
    const limiter = await open(path, { maxConcurrent: 1 });
    for (const expirationMs of [0, -1, 1.5, NaN, Infinity, '5', 2_147_483_648]) {
      await assert.rejects(
        limiter.schedule(() => assert.fail('invalid request ran'), { expirationMs }),
        /expirationMs/,
      );
    }
    assert.equal(
      (await limiter.inspect()).trace.filter((row) => row.kind === 'admitted').length,
      0,
    );
    assert.equal(await limiter.schedule(() => 7), 7);
    await limiter.close();
  });
  await test('same-pool clients choose different per-call leases without config drift', async (path) => {
    const config = { maxConcurrent: 2, expirationMs: 5000 };
    const a = await open(path, config),
      b = await open(path, config);
    const [first, second] = await Promise.all([
      a.schedule((admission) => admission, { expirationMs: 1000 }),
      b.schedule((admission) => admission, { expirationMs: 2000 }),
    ]);
    assert.notEqual(first.leaseId, second.leaseId);
    assert.equal(first.expiresAt - first.leaseGrantedAt, 1000);
    assert.equal(second.expiresAt - second.leaseGrantedAt, 2000);
    await a.close();
    await b.close();
  });
  console.log(`RESULT ${passed}/6 passed`);
} finally {
  await Promise.allSettled([...clients].map((client) => client.close()));
  clearTimeout(watchdog);
}
