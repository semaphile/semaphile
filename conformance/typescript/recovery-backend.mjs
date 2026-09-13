import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { Pool } from '../../packages/core/dist/src/backend.js';
import { nativePath } from '../../packages/core/dist/src/native-path.js';
import { PoolDrainingError } from '../../packages/core/dist/src/maintenance-state.js';
import { CircuitOpenError } from '../../packages/core/dist/src/control-state.js';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
await mkdir('.tmp/recovery-backend', { recursive: true });
const root = await mkdtemp('.tmp/recovery-backend/run-');
console.log(`platform=${process.platform} node=${process.version} store=${root}`);
const pair = (config) => {
  const path = join(root, randomUUID());
  return [new Pool(path, config, nativePath()), new Pool(path, config, nativePath())];
};
const close = (pools) => Promise.all(pools.map((pool) => pool.close()));
const admit = (pool, operation, expirationMs = null, circuit = 'wait') =>
  pool.acquireDetailed(undefined, 1, expirationMs, { operation, circuit });
const recovery = { retry: { baseDelayMs: 30, maxDelayMs: 60, jitter: 0 } };

test('release commits shared cooldown before waiting peers can acquire', async () => {
  const pools = pair({ maxConcurrent: 1, reservoir: 3, recovery });
  const [a, b] = pools;
  try {
    const token = a.acceptOperation(randomUUID()),
      lease = await admit(a, token);
    const peer = b.acquireDetailed();
    const reportAt = Date.now();
    a.release(lease.leaseId, { kind: 'throttle', retryAfterMs: 80 });
    a.finishOperation(token);
    assert.equal(a.inspect().active, 0);
    const next = await peer;
    assert.ok(next.leaseGrantedAt >= reportAt + 80);
    assert.equal(b.currentReservoir(), 1);
    b.release(next.leaseId);
  } finally {
    await close(pools);
  }
});

test('one failing cohort escalates once and duplicate/stale reports are fenced', async () => {
  const pools = pair({ maxConcurrent: 3, recovery });
  const [a, b] = pools;
  try {
    const [x, y, z] = await Promise.all([
      a.acquireDetailed(),
      a.acquireDetailed(),
      b.acquireDetailed(),
    ]);
    a.release(x.leaseId, { kind: 'throttle' });
    a.release(y.leaseId, { kind: 'throttle', retryAfterMs: 100 });
    const before = a.control().recovery;
    assert.equal(before.cooldownStep, 1);
    b.release(z.leaseId, { kind: 'success' });
    a.release(x.leaseId, { kind: 'throttle', retryAfterMs: 5000 });
    assert.deepEqual(a.control().recovery, before);
  } finally {
    await close(pools);
  }
});

test('open breaker admits one budgeted probe and wakes peers on successful completion', async () => {
  const pools = pair({
    maxConcurrent: 2,
    reservoir: 4,
    recovery: {
      ...recovery,
      breaker: { failureThreshold: 1, initialPauseMs: 30, maxPauseMs: 60, probeTimeoutMs: 1000 },
    },
  });
  const [a, b] = pools;
  try {
    const failed = await a.acquireDetailed();
    a.release(failed.leaseId, { kind: 'service-failure' });
    assert.equal(b.control().recovery.circuit, 'open');
    await assert.rejects(admit(b, undefined, null, 'fail-fast'), CircuitOpenError);
    const probe = await a.acquireDetailed();
    let peerAdmitted = false;
    const peer = b.acquireDetailed().then((lease) => {
      peerAdmitted = true;
      return lease;
    });
    await delay(15);
    assert.equal(peerAdmitted, false);
    assert.equal(a.control().recovery.circuit, 'half-open');
    assert.equal(a.currentReservoir(), 2);
    a.release(probe.leaseId, { kind: 'success' });
    const next = await peer;
    assert.equal(b.control().recovery.circuit, 'closed');
    b.release(next.leaseId);
  } finally {
    await close(pools);
  }
});

test('drain rejects new operations and permits every attempt of accepted work', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    const token = a.acceptOperation(randomUUID());
    const drain = b.control({ action: 'drain' });
    assert.equal(drain.maintenance.pending, 1);
    assert.throws(() => b.acceptOperation(randomUUID()), PoolDrainingError);
    await assert.rejects(b.acquireDetailed(), PoolDrainingError);
    for (let i = 0; i < 2; i++) {
      const lease = await admit(a, token);
      a.release(lease.leaseId);
      assert.equal(b.control().maintenance.pending, 1);
    }
    a.finishOperation(token);
    assert.equal(b.control().maintenance.clean, true);
    b.control({ action: 'resume', generation: drain.maintenance.generation });
    const next = b.acceptOperation(randomUUID());
    b.finishOperation(next);
  } finally {
    await close(pools);
  }
});

test('live expiration preserves actual-completion accounting and fences late success', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    const token = a.acceptOperation(randomUUID()),
      old = await admit(a, token, 15);
    const replacement = await b.acquireDetailed();
    const state = a.control({ action: 'drain' });
    assert.equal(state.maintenance.pending, 2);
    assert.equal(a.control().operations[token.id].activeAttempts, 1);
    assert.throws(() => a.finishOperation(token), /active operation/);
    a.release(old.leaseId, { kind: 'success' });
    a.finishOperation(token);
    assert.equal(b.inspect().active, 1);
    b.release(replacement.leaseId);
    assert.equal(b.control().maintenance.clean, true);
  } finally {
    await close(pools);
  }
});

test('owner retirement leaves active work unconfirmed, never clean after acknowledgement', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    const token = a.acceptOperation(randomUUID());
    await admit(a, token);
    const drain = b.control({ action: 'drain' });
    await a.close();
    const lost = b.control();
    assert.equal(lost.maintenance.pending, 0);
    assert.equal(lost.maintenance.unconfirmed, 1);
    assert.equal(lost.unconfirmed[token.id].acknowledged, false);
    const acknowledged = b.control({
      action: 'acknowledge',
      generation: drain.maintenance.generation,
      ids: [token.id],
      reason: 'Operator investigated provider; remote completion cannot be proven',
    });
    assert.equal(acknowledged.maintenance.settled, true);
    assert.equal(acknowledged.maintenance.clean, false);
    assert.throws(
      () => b.control({ action: 'resume', generation: drain.maintenance.generation + 1 }),
      /Stale/,
    );
  } finally {
    await close(pools);
  }
});

test('retiring queued work records no in-flight uncertainty', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    a.acceptOperation(randomUUID());
    b.control({ action: 'drain' });
    await a.close();
    assert.equal(b.control().maintenance.clean, true);
  } finally {
    await close(pools);
  }
});

test('drain and full recovery policy survive all owners closing', async () => {
  const path = join(root, randomUUID());
  const config = { maxConcurrent: 1, recovery };
  const a = new Pool(path, config, nativePath());
  const state = a.control({ action: 'drain' });
  await a.close();
  const b = new Pool(path, config, nativePath());
  try {
    assert.equal(b.control().fingerprint, state.fingerprint);
    assert.equal(b.control().maintenance.mode, 'draining');
    assert.throws(
      () =>
        new Pool(
          path,
          { ...config, recovery: { ...recovery, classifierId: 'changed/1' } },
          nativePath(),
        ),
      /mismatch/,
    );
    assert.throws(() => b.acceptOperation(randomUUID()), PoolDrainingError);
  } finally {
    await b.close();
  }
});

test('failed release transaction rolls back outcome, completion and lease together', async () => {
  const pools = pair({ maxConcurrent: 1, recovery });
  const [a, b] = pools;
  try {
    const token = a.acceptOperation(randomUUID()),
      lease = await admit(a, token);
    const before = b.control();
    a.stage = (stage) => {
      if (stage === 'beforeCommit') {
        throw new Error('injected rollback');
      }
    };
    assert.throws(() => a.release(lease.leaseId, { kind: 'throttle' }), /injected rollback/);
    a.stage = undefined;
    assert.deepEqual(b.control(), before);
    assert.equal(b.inspect().active, 1);
    a.release(lease.leaseId);
    a.finishOperation(token);
  } finally {
    a.stage = undefined;
    await close(pools);
  }
});

test('idle drain wait blocks without periodic wakeups and abort preserves drain', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  const controller = new AbortController();
  try {
    const token = a.acceptOperation(randomUUID());
    const drain = b.control({ action: 'drain' });
    const waiting = b.waitForDrain(drain.maintenance.generation, controller.signal);
    const rejected = assert.rejects(waiting, { name: 'AbortError' });
    await delay(40);
    assert.equal(b.stats.waits, 1);
    assert.equal(b.stats.wakes, 0);
    controller.abort();
    await rejected;
    assert.equal(b.control().maintenance.mode, 'draining');
    a.finishOperation(token);
    assert.equal((await b.waitForDrain(drain.maintenance.generation)).maintenance.clean, true);
  } finally {
    controller.abort();
    await close(pools);
  }
});

test('pool close cancels and joins pending administrative waits', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    a.acceptOperation(randomUUID());
    const drain = b.control({ action: 'drain' });
    const rejected = assert.rejects(b.waitForDrain(drain.maintenance.generation), /pool closed/);
    await b.close();
    await rejected;
  } finally {
    await close(pools);
  }
});

for (const mode of ['active', 'implicit']) {
  for (const phase of ['before-subscription', 'after-subscription']) {
    test(`SIGKILL after lease expiration preserves uncertainty (${mode}, ${phase})`, async () => {
      const path = join(root, randomUUID());
      const child = spawn(
        process.execPath,
        ['--no-warnings', 'conformance/typescript/fixtures/control-owner.mjs', path, mode],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      );
      const exit = once(child, 'exit');
      const lines = createInterface({ input: child.stdout });
      const line = await Promise.race([
        once(lines, 'line'),
        exit.then(() => {
          throw new Error('Owner exited before readiness');
        }),
      ]);
      const { token } = JSON.parse(line[0]);
      const observer = new Pool(path, { maxConcurrent: 1 }, nativePath());
      try {
        const replacement = await observer.acquireDetailed();
        observer.release(replacement.leaseId);
        const drain = observer.control({ action: 'drain' });
        let waiting;
        if (phase === 'after-subscription') {
          waiting = observer.waitForDrain(drain.maintenance.generation);
        }
        child.kill('SIGKILL');
        await exit;
        const lost = observer.control();
        assert.equal(lost.maintenance.pending, 0);
        assert.equal(lost.maintenance.unconfirmed, 1);
        waiting ??= observer.waitForDrain(drain.maintenance.generation);
        observer.control({
          action: 'acknowledge',
          generation: drain.maintenance.generation,
          ids: [token.id],
          reason: 'Explicitly accepting unresolved remote completion',
        });
        const result = await waiting;
        assert.equal(result.maintenance.settled, true);
        assert.equal(result.maintenance.clean, false);
      } finally {
        lines.close();
        child.kill('SIGKILL');
        await exit;
        await observer.close();
      }
    });
  }
}

test('implicit admissions remain pending through expiry and become uncertain on owner loss', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    await a.acquireDetailed(undefined, 1, 15);
    assert.equal(b.control().maintenance.pending, 1);
    const next = await b.acquireDetailed();
    b.release(next.leaseId);
    const drain = b.control({ action: 'drain' });
    assert.equal(drain.maintenance.pending, 1);
    assert.equal(drain.maintenance.clean, false);
    await a.close();
    assert.equal(b.control().maintenance.unconfirmed, 1);
    assert.equal(b.control().maintenance.clean, false);
  } finally {
    await close(pools);
  }
});

test('stale and duplicate-active operation tokens reject only their own admission', async () => {
  const pools = pair({ maxConcurrent: 2 });
  const [a] = pools;
  try {
    const stale = a.acceptOperation(randomUUID());
    a.finishOperation(stale);
    await assert.rejects(admit(a, stale), /stale/);
    const live = a.acceptOperation(randomUUID()),
      held = await admit(a, live);
    await assert.rejects(admit(a, live), /already active/);
    const valid = await a.acquireDetailed();
    a.release(valid.leaseId);
    a.release(held.leaseId);
    a.finishOperation(live);
    assert.equal(a.control().maintenance.pending, 0);
  } finally {
    await close(pools);
  }
});

test('fail-fast rejects behind a blocked local circuit waiter', async () => {
  const pools = pair({
    maxConcurrent: 2,
    recovery: {
      breaker: { failureThreshold: 1, initialPauseMs: 5, maxPauseMs: 10, probeTimeoutMs: 5000 },
    },
  });
  const [a, b] = pools;
  const controller = new AbortController();
  let waiting;
  try {
    const failed = await b.acquireDetailed();
    b.release(failed.leaseId, { kind: 'service-failure' });
    const probe = await b.acquireDetailed();
    waiting = a.acquireDetailed(controller.signal).catch((error) => error);
    const refusal = assert.rejects(admit(a, undefined, null, 'fail-fast'), CircuitOpenError);
    await Promise.race([
      refusal,
      delay(200).then(() => {
        throw new Error('fail-fast stayed behind queue head');
      }),
    ]);
    controller.abort();
    await waiting;
    b.release(probe.leaseId, { kind: 'success' });
    const next = await a.acquireDetailed();
    a.release(next.leaseId);
  } finally {
    controller.abort();
    await waiting;
    await close(pools);
  }
});

test('coordinator resume rejects stale wait without stopping subsequent admissions', async () => {
  const client = await openLimiter({
    path: join(root, randomUUID()),
    config: { maxConcurrent: 1 },
  });
  // Internal transport seam: public administrative methods are a later increment.
  const backend = client.backend;
  try {
    const operation = await backend.call('accept', { operationId: randomUUID() });
    const status = await backend.call('control', { command: { action: 'drain' } });
    const rejected = assert.rejects(
      backend.call('waitDrain', { generation: status.maintenance.generation }),
      /Stale maintenance/,
    );
    await backend.call('control', {
      command: { action: 'resume', generation: status.maintenance.generation },
    });
    await rejected;
    await backend.call('finish', { operation });
    assert.equal(await client.schedule(() => 42), 42);
    assert.equal(backend.failure, undefined);
  } finally {
    await client.close();
  }
});

test('coordinator invalid outcome preserves lease and permits corrected release', async () => {
  const client = await openLimiter({
    path: join(root, randomUUID()),
    config: { maxConcurrent: 1 },
  });
  const backend = client.backend;
  let lease;
  try {
    lease = await backend.call('acquire', { weight: 1, expirationMs: null });
    await assert.rejects(
      backend.call('release', { lease: lease.leaseId, outcome: { kind: 'invalid' } }),
      /Invalid outcome/,
    );
    assert.equal((await client.inspect()).active, 1);
    assert.equal(backend.failure, undefined);
    await backend.call('release', { lease: lease.leaseId, outcome: { kind: 'success' } });
    lease = undefined;
    assert.equal(await client.schedule(() => 'healthy'), 'healthy');
  } finally {
    if (lease) {
      await backend.call('release', { lease: lease.leaseId });
    }
    await client.close();
  }
});

test('fatal stop rejects current and future drain waits while permitting cleanup', async () => {
  const pools = pair({ maxConcurrent: 1 });
  const [a, b] = pools;
  try {
    const token = a.acceptOperation(randomUUID());
    const lease = await admit(a, token);
    const generation = a.control({ action: 'drain' }).maintenance.generation;
    const waits = [a.waitForDrain(generation), a.waitForDrain(generation)];
    assert.equal(a.stats.waits, 2, 'both native waits must be registered');
    const fatal = new Error('injected fatal backend error');
    const rejected = Promise.all(waits.map((wait) => assert.rejects(wait, (e) => e === fatal)));
    a.stopAdmissions(fatal);
    await rejected;
    await assert.rejects(a.waitForDrain(generation), (e) => e === fatal);
    assert.throws(
      () => a.acceptOperation(randomUUID()),
      (e) => e === fatal,
    );
    a.release(lease.leaseId);
    assert.equal(a.finishOperation(token), true);
    assert.equal(b.control().maintenance.settled, true);
    a.stopAdmissions(new Error('secondary failure'));
    await assert.rejects(a.waitForDrain(generation), (e) => e === fatal);
  } finally {
    await close(pools);
  }
});

await run();
