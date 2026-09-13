import assert from 'node:assert/strict';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
import {
  configFingerprint,
  normalizeRecovery,
  retryDelay,
} from '../../packages/core/dist/src/recovery-policy.js';
import {
  admitRecoveryAttempt,
  completeRecoveryAttempt,
  initialRecoveryState,
  recoveryAdmission,
} from '../../packages/core/dist/src/recovery-state.js';

const policy = normalizeRecovery();
const report = (state, p, id, kind, now, extra = {}) =>
  completeRecoveryAttempt(state, p, id, { kind, ...extra }, now);
function attempt(state, p, id, now) {
  assert.equal(admitRecoveryAttempt(state, p, id, now), true);
}
function trip(state, p, now = 0) {
  for (let i = 0; i < 5; i++) {
    attempt(state, p, `fail-${i}-${now}`, now);
    report(state, p, `fail-${i}-${now}`, 'service-failure', now);
  }
}

test('defaults and canonical fingerprints cover the complete normalized policy', () => {
  assert.deepEqual(policy.retry, {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
    factor: 2,
    jitter: 0.2,
  });
  assert.equal(policy.deadlineMs, 300_000);
  assert.equal(policy.attemptTimeoutMs, 60_000);
  assert.equal(policy.breaker, null);
  assert.equal(
    configFingerprint(policy),
    configFingerprint(normalizeRecovery({ retry: { jitter: 0.2, factor: 2 } })),
  );
  assert.equal(configFingerprint({ b: 2, a: 1 }), configFingerprint({ a: 1, b: 2 }));
  for (const value of [
    { retry: { factor: 3 } },
    { classifierId: 'custom/2' },
    { breaker: {} },
    { deadlineMs: 4 },
  ]) {
    assert.notEqual(configFingerprint(policy), configFingerprint(normalizeRecovery(value)));
  }
  assert.throws(() => configFingerprint({ callback() {} }));
});

test('invalid policies fail rather than silently ignore drift', () => {
  for (const value of [
    null,
    [],
    { unexpected: 1 },
    { retry: { ignored: 1 } },
    { retry: { maxAttempts: 0 } },
    { retry: { jitter: 2 } },
    { retry: { baseDelayMs: 100, maxDelayMs: 50 } },
    { breaker: { rule: 'percentage' } },
    { breaker: { failureRatio: 0.5 } },
    { breaker: { rule: 'percentage', failureThreshold: 3 } },
    { classifierId: '' },
    { deadlineMs: -1 },
  ]) {
    assert.throws(() => normalizeRecovery(value));
  }
  assert.equal(normalizeRecovery({ deadlineMs: null, attemptTimeoutMs: null }).deadlineMs, null);
});

test('retry timing applies configured exponential cap and jitter', () => {
  assert.equal(retryDelay(policy.retry, 1, 0), 400);
  assert.equal(retryDelay(policy.retry, 1, 1), 600);
  assert.equal(retryDelay(policy.retry, 2, 0.5), 1000);
  assert.equal(retryDelay(policy.retry, 1000, 1), 10_000);
  assert.throws(() => retryDelay(policy.retry, 0));
  assert.throws(() => retryDelay(policy.retry, 1, NaN));
});

test('one simultaneous throttle cohort advances backoff once; duplicate reports do nothing', () => {
  const state = initialRecoveryState();
  for (let i = 0; i < 20; i++) {
    attempt(state, policy, `a${i}`, 0);
  }
  for (let i = 0; i < 20; i++) {
    assert.equal(report(state, policy, `a${i}`, 'throttle', 10), true);
  }
  assert.equal(state.cooldownStep, 1);
  assert.equal(state.cooldownEpoch, 1);
  assert.equal(state.cooldownUntil, 510);
  assert.equal(report(state, policy, 'a0', 'throttle', 20), false);
  assert.equal(recoveryAdmission(state, policy, 509).allowed, false);
  assert.equal(admitRecoveryAttempt(state, policy, 'denied', 509), false);
  attempt(state, policy, 'next', 510);
  report(state, policy, 'next', 'throttle', 520);
  assert.equal(state.cooldownUntil, 1520);
});

test('provider floor exceeds local cap and an old success cannot erase it', () => {
  const state = initialRecoveryState();
  attempt(state, policy, 'old-success', 0);
  attempt(state, policy, 'throttle', 0);
  report(state, policy, 'throttle', 'throttle', 1, { retryAfterMs: 90_000 });
  report(state, policy, 'old-success', 'success', 2);
  assert.equal(state.cooldownUntil, 90_001);
  assert.equal(state.cooldownStep, 1);
  attempt(state, policy, 'fresh-success', 90_001);
  report(state, policy, 'fresh-success', 'success', 90_002);
  assert.equal(state.cooldownStep, 0);
});

test('late cohort guidance can extend a cooldown without doubling it', () => {
  const state = initialRecoveryState();
  attempt(state, policy, 'a', 0);
  attempt(state, policy, 'b', 0);
  report(state, policy, 'a', 'throttle', 0);
  report(state, policy, 'b', 'throttle', 50, { retryAfterMs: 1000 });
  assert.equal(state.cooldownUntil, 1050);
  assert.equal(state.cooldownStep, 1);
});

test('consecutive breaker trips, permits one probe, and fences older successes', () => {
  const p = normalizeRecovery({ breaker: {} });
  const state = initialRecoveryState();
  attempt(state, p, 'old-success', 0);
  trip(state, p);
  assert.equal(state.circuit, 'open');
  assert.equal(state.openUntil, 30_000);
  report(state, p, 'old-success', 'success', 1);
  assert.equal(state.circuit, 'open');
  assert.equal(recoveryAdmission(state, p, 29_999).allowed, false);
  attempt(state, p, 'probe', 30_000);
  assert.equal(state.circuit, 'half-open');
  assert.equal(admitRecoveryAttempt(state, p, 'second-probe', 30_000), false);
  report(state, p, 'probe', 'success', 30_001);
  assert.equal(state.circuit, 'closed');
  assert.equal(state.failures, 0);
});

test('success resets consecutive failures; neutral/throttle reports do not trip', () => {
  const p = normalizeRecovery({ breaker: { failureThreshold: 2 } });
  const state = initialRecoveryState();
  for (const [i, kind] of ['service-failure', 'success', 'service-failure', 'neutral'].entries()) {
    attempt(state, p, String(i), 0);
    report(state, p, String(i), kind, 0);
  }
  assert.equal(state.circuit, 'closed');
  assert.equal(state.failures, 1);
  attempt(state, p, 'throttle', 0);
  report(state, p, 'throttle', 'throttle', 0);
  assert.equal(state.circuit, 'closed');
  assert.equal(state.failures, 1);
});

test('failed recovery probes double their pause until the configured cap', () => {
  const p = normalizeRecovery({ breaker: {} });
  const state = initialRecoveryState();
  trip(state, p);
  for (const [i, delay] of [60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
    const now = state.openUntil;
    attempt(state, p, `probe-${i}`, now);
    report(state, p, `probe-${i}`, 'service-failure', now + 1);
    assert.equal(state.openUntil, now + 1 + delay);
  }
});

test('expired or cancelled probe cannot establish recovery or affect a replacement', () => {
  const p = normalizeRecovery({ breaker: {} });
  const state = initialRecoveryState();
  trip(state, p);
  attempt(state, p, 'expired', 30_000);
  report(state, p, 'expired', 'success', 90_000);
  assert.equal(state.circuit, 'open');
  attempt(state, p, 'cancelled', state.openUntil);
  report(state, p, 'cancelled', 'neutral', state.openUntil + 1);
  assert.equal(state.circuit, 'open');
  attempt(state, p, 'replacement', state.openUntil);
  assert.equal(report(state, p, 'expired', 'success', state.openUntil + 1), false);
  assert.equal(state.probe.id, 'replacement');
});

test('percentage breaker requires sufficient traffic and ages failures out of its window', () => {
  const p = normalizeRecovery({
    breaker: { rule: 'percentage', failureRatio: 0.5, minimumSamples: 4, windowMs: 1000 },
  });
  const state = initialRecoveryState();
  for (let i = 0; i < 3; i++) {
    attempt(state, p, `old-${i}`, 0);
    report(state, p, `old-${i}`, 'service-failure', 0);
  }
  assert.equal(state.circuit, 'closed');
  attempt(state, p, 'fresh', 1000);
  report(state, p, 'fresh', 'success', 1000);
  assert.equal(state.samples.length, 1);
  for (const [i, kind] of ['service-failure', 'success', 'service-failure'].entries()) {
    attempt(state, p, `new-${i}`, 1001);
    report(state, p, `new-${i}`, kind, 1001);
  }
  assert.equal(state.circuit, 'open');
});

test('invalid outcomes preserve the unreported attempt', () => {
  const state = initialRecoveryState();
  attempt(state, policy, 'a', 0);
  assert.throws(() => report(state, policy, 'a', 'throttle', 0, { retryAfterMs: -1 }));
  assert.throws(() => report(state, policy, 'a', 'success', 0, { throttled: true }));
  assert.ok(state.attempts.a);
  assert.equal(report(state, policy, 'a', 'success', 1), true);
});

test('late provider guidance fences a success admitted before that guidance', () => {
  const state = initialRecoveryState();
  attempt(state, policy, 'a', 0);
  attempt(state, policy, 'b', 0);
  report(state, policy, 'a', 'throttle', 0);
  attempt(state, policy, 'c', 500);
  report(state, policy, 'b', 'throttle', 600, { retryAfterMs: 1000 });
  report(state, policy, 'c', 'success', 1600);
  assert.equal(state.cooldownStep, 1);
  attempt(state, policy, 'd', 1600);
  report(state, policy, 'd', 'success', 1601);
  assert.equal(state.cooldownStep, 0);
});

test('expired probes cannot reset cooldown and their attempt records are retired', () => {
  const p = normalizeRecovery({ breaker: { failureThreshold: 1 } });
  const state = initialRecoveryState();
  attempt(state, p, 'initial', 0);
  report(state, p, 'initial', 'service-failure', 0, { throttled: true });
  attempt(state, p, 'probe', 30_000);
  assert.equal(report(state, p, 'probe', 'success', 90_000), false);
  assert.equal(state.cooldownStep, 1);
  assert.deepEqual(state.attempts, {});
  for (let i = 0; i < 5; i++) {
    attempt(state, p, `lost-${i}`, state.openUntil);
    recoveryAdmission(state, p, state.probe.expiresAt);
    assert.deepEqual(state.attempts, {});
  }
});

test('overflowing provider deadline rolls back the complete transition', () => {
  const state = initialRecoveryState();
  attempt(state, policy, 'a', 1000);
  const before = structuredClone(state);
  assert.throws(() =>
    report(state, policy, 'a', 'throttle', 1000, { retryAfterMs: Number.MAX_SAFE_INTEGER }),
  );
  assert.deepEqual(state, before);
  report(state, policy, 'a', 'throttle', 1000);
  assert.equal(state.cooldownUntil, 1500);
});

test('fractional exponential factors still produce integral shared deadlines', () => {
  const p = normalizeRecovery({ retry: { baseDelayMs: 1, factor: 1.5 } });
  const state = initialRecoveryState();
  for (let i = 0; i < 10; i++) {
    const now = state.cooldownUntil;
    attempt(state, p, String(i), now);
    report(state, p, String(i), 'throttle', now);
    assert.ok(Number.isSafeInteger(state.cooldownUntil));
  }
});

await run();
