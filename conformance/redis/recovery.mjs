import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RedisBackend } from '../../packages/redis/dist/backend.js';
import { server } from './harness.mjs';
import { PoolDrainingError } from '../../packages/core/dist/src/maintenance-state.js';
import { CircuitOpenError } from '../../packages/core/dist/src/control-state.js';
import { suite } from '../typescript/fixtures/cases.mjs';
const { test, run } = suite();
const redis = await server();
const openBackend = async (pool, config) => {
  const backend = new RedisBackend({ url: redis.url, pool, config });
  await backend.open();
  return backend;
};
const pair = async (config) => {
  const pool = randomUUID();
  return Promise.all([openBackend(pool, config), openBackend(pool, config)]);
};
const close = (backends) => Promise.all(backends.map((backend) => backend.detach()));
const acquire = (backend, options = {}, signal) =>
  backend.call('acquire', { weight: 1, expirationMs: null, ...options }, signal);
const release = (backend, lease, outcome = { kind: 'neutral' }) =>
  backend.call('release', { lease: lease.leaseId, outcome });
const control = (backend, command = { action: 'status' }) => backend.call('control', { command });
const accept = (backend) => backend.call('accept', { operationId: randomUUID() });
const breaker = { failureThreshold: 1, initialPauseMs: 5, maxPauseMs: 10, probeTimeoutMs: 5000 };

test('peer cooldown releases capacity but preserves shared retry floor and budget debit', async () => {
  const backends = await pair({
    maxConcurrent: 1,
    reservoir: 3,
    recovery: { retry: { baseDelayMs: 5, maxDelayMs: 10, jitter: 0 } },
  });
  const [a, b] = backends;
  try {
    const held = await acquire(a);
    const next = acquire(b);
    await release(a, held, { kind: 'throttle', retryAfterMs: 100 });
    const floor = (await control(a)).recovery.cooldownUntil;
    assert.ok(!(await a.call('inspect', {})).leases.some((lease) => lease.id === held.leaseId));
    const admitted = await next;
    assert.ok(admitted.leaseGrantedAt >= floor);
    assert.equal(await b.call('reservoir', {}), 1);
    await release(b, admitted);
  } finally {
    await close(backends);
  }
});

test('Redis breaker allows one probe and fail-fast ignores a blocked local queue', async () => {
  const backends = await pair({ maxConcurrent: 2, recovery: { breaker } });
  const [a, b] = backends;
  const controller = new AbortController();
  let queued;
  try {
    const failed = await acquire(a);
    await release(a, failed, { kind: 'service-failure' });
    const probe = await acquire(a);
    queued = acquire(b, {}, controller.signal).catch((error) => error);
    await assert.rejects(acquire(b, { circuit: 'fail-fast' }), CircuitOpenError);
    assert.equal((await control(a)).recovery.circuit, 'half-open');
    controller.abort();
    assert.equal((await queued).name, 'AbortError');
    await release(a, probe, { kind: 'success' });
    const next = await acquire(b);
    await release(b, next);
    assert.equal((await control(b)).recovery.circuit, 'closed');
  } finally {
    controller.abort();
    await queued;
    await close(backends);
  }
});

test('another owner cannot retire a valid probe or report success for it', async () => {
  const backends = await pair({ maxConcurrent: 1, recovery: { breaker } });
  const [a, b] = backends;
  try {
    const failed = await acquire(a);
    await release(a, failed, { kind: 'service-failure' });
    const probe = await acquire(a);
    await release(b, probe, { kind: 'success' });
    assert.equal((await control(b)).recovery.circuit, 'half-open');
    assert.equal((await control(b)).maintenance.pending, 1);
    await release(a, probe, { kind: 'success' });
    assert.equal((await control(b)).recovery.circuit, 'closed');
    assert.equal((await control(b)).maintenance.pending, 0);
  } finally {
    await close(backends);
  }
});

test('drain tracks expired implicit work until its actual completion', async () => {
  const backends = await pair({ maxConcurrent: 1 });
  const [a, b] = backends;
  try {
    const old = await acquire(a, { expirationMs: 10 });
    const replacement = await acquire(b);
    const state = await control(a, { action: 'drain' });
    assert.equal(state.maintenance.pending, 2);
    await assert.rejects(acquire(a), PoolDrainingError);
    await release(a, old);
    assert.equal((await control(b)).maintenance.pending, 1);
    assert.equal((await b.call('inspect', {})).active, 1);
    await release(b, replacement);
    assert.equal(
      (await b.call('waitDrain', { generation: state.maintenance.generation })).maintenance.clean,
      true,
    );
  } finally {
    await close(backends);
  }
});

test('accepted operations can retry during drain; stale input leaves later work usable', async () => {
  const backends = await pair({ maxConcurrent: 1 });
  const [a, b] = backends;
  try {
    const operation = await accept(a);
    const drain = await control(b, { action: 'drain' });
    for (let i = 0; i < 2; i++) {
      const lease = await acquire(a, { operation });
      await release(a, lease);
    }
    await a.call('finish', { operation });
    await assert.rejects(acquire(a, { operation }), /stale/);
    await control(b, { action: 'resume', generation: drain.maintenance.generation });
    const next = await acquire(a);
    await release(a, next);
  } finally {
    await close(backends);
  }
});

test('administrative abort preserves drain; closing one client resolves peer drain', async () => {
  const backends = await pair({ maxConcurrent: 1 });
  const [a, b] = backends;
  const controller = new AbortController();
  try {
    await accept(a);
    const drain = await control(b, { action: 'drain' });
    const aborted = assert.rejects(
      b.call('waitDrain', { generation: drain.maintenance.generation }, controller.signal),
      { name: 'AbortError' },
    );
    controller.abort();
    await aborted;
    assert.equal((await control(b)).maintenance.mode, 'draining');
    const own = assert.rejects(a.call('waitDrain', { generation: drain.maintenance.generation }), {
      name: 'AbortError',
    });
    const peer = b.call('waitDrain', { generation: drain.maintenance.generation });
    await a.detach();
    await own;
    assert.equal((await peer).maintenance.clean, true);
  } finally {
    controller.abort();
    await close(backends);
  }
});

test('unconfirmed Redis work needs acknowledgement and never becomes proven complete', async () => {
  const backends = await pair({ maxConcurrent: 1 });
  const [a, b] = backends;
  try {
    await acquire(a);
    const drain = await control(b, { action: 'drain' });
    await a.detach();
    const lost = await control(b);
    assert.equal(lost.maintenance.unconfirmed, 1);
    const result = await control(b, {
      action: 'acknowledge',
      generation: drain.maintenance.generation,
      ids: Object.keys(lost.unconfirmed),
      reason: 'Operator accepts uncertainty',
    });
    assert.equal(result.maintenance.settled, true);
    assert.equal(result.maintenance.clean, false);
  } finally {
    await close(backends);
  }
});

test('invalid Redis outcomes roll back before release and permit correction', async () => {
  const backends = await pair({ maxConcurrent: 1 });
  const [a] = backends;
  try {
    const held = await acquire(a);
    const before = await control(a);
    await assert.rejects(
      release(a, held, { kind: 'success', retryAfterMs: 4 }),
      /successful outcome/i,
    );
    assert.deepEqual(await control(a), before);
    assert.equal((await a.call('inspect', {})).active, 1);
    await release(a, held, { kind: 'success' });
    assert.equal((await control(a)).maintenance.pending, 0);
  } finally {
    await close(backends);
  }
});

for (const phase of ['queued', 'admitted']) {
  test(`operation token mutation cannot corrupt accounting (${phase})`, async () => {
    const backends = await pair({ maxConcurrent: 1 });
    const [a, b] = backends;
    try {
      const operation = await accept(a),
        saved = { ...operation };
      let held;
      if (phase === 'queued') {
        held = await acquire(b);
      }
      const pending = acquire(a, { operation });
      let admitted;
      if (phase === 'admitted') {
        admitted = await pending;
      }
      operation.id = 'changed';
      operation.generation++;
      if (held) {
        await release(b, held);
      }
      admitted ??= await pending;
      await release(a, admitted);
      await a.call('finish', { operation: saved });
      assert.equal((await control(b, { action: 'drain' })).maintenance.clean, true);
    } finally {
      await close(backends);
    }
  });
}

test('duplicate reports cannot extend a newer cooldown or release a replacement', async () => {
  const backends = await pair({
    maxConcurrent: 2,
    recovery: { retry: { baseDelayMs: 5, maxDelayMs: 10 } },
  });
  const [a, b] = backends;
  try {
    const old = await acquire(a);
    await release(a, old, { kind: 'throttle' });
    const replacement = await acquire(b);
    const before = await control(a);
    await release(a, old, { kind: 'throttle', retryAfterMs: 10000 });
    assert.deepEqual(await control(a), before);
    assert.equal((await a.call('inspect', {})).active, 1);
    await release(b, replacement);
  } finally {
    await close(backends);
  }
});

test('drain and acknowledged uncertainty persist across all clients closing', async () => {
  const key = randomUUID(),
    config = { maxConcurrent: 1 };
  const first = await openBackend(key, config);
  await acquire(first);
  const initial = await control(first, { action: 'drain' });
  await first.detach();
  const second = await openBackend(key, config);
  try {
    const state = await control(second);
    assert.equal(state.fingerprint, initial.fingerprint);
    assert.equal(state.maintenance.mode, 'draining');
    assert.equal(state.maintenance.unconfirmed, 1);
    await control(second, {
      action: 'acknowledge',
      generation: state.maintenance.generation,
      ids: Object.keys(state.unconfirmed),
      reason: 'Reviewed unresolved request',
    });
  } finally {
    await second.detach();
  }
  const third = await openBackend(key, config);
  try {
    const state = await control(third);
    assert.equal(state.maintenance.acknowledged, 1);
    assert.equal(state.maintenance.clean, false);
    await assert.rejects(acquire(third), PoolDrainingError);
  } finally {
    await third.detach();
  }
});

try {
  await run();
} finally {
  await redis.close();
}
