// Pure backend transition rules. Call under the backend's atomic mutation
// boundary, using its authoritative clock. Outcomes never authorize HTTP replay.
import { exponentialDelay, type BreakerPolicy, type RecoveryPolicy } from './recovery-policy.js';

export type Outcome = {
  kind: 'success' | 'throttle' | 'service-failure' | 'neutral';
  retryAfterMs?: number;
  throttled?: boolean;
};
type Attempt = { cooldownEpoch: number; breakerEpoch: number; probe: boolean };
export type RecoveryState = {
  cooldownEpoch: number;
  cooldownStep: number;
  cooldownUntil: number;
  breakerEpoch: number;
  circuit: 'closed' | 'open' | 'half-open';
  failures: number;
  samples: Array<{ at: number; failures: number; total: number }>;
  pauseStep: number;
  openUntil: number;
  probe: { id: string; expiresAt: number } | null;
  attempts: Record<string, Attempt>;
};

export type RecoveryAdmission = {
  allowed: boolean;
  circuit: RecoveryState['circuit'];
  notBefore: number | null;
};

export function initialRecoveryState(): RecoveryState {
  return {
    cooldownEpoch: 0,
    cooldownStep: 0,
    cooldownUntil: 0,
    breakerEpoch: 0,
    circuit: 'closed',
    failures: 0,
    samples: [],
    pauseStep: 0,
    openUntil: 0,
    probe: null,
    attempts: {},
  };
}

function increment(value: number): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Recovery generation overflow');
  }
  return value + 1;
}
function timestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError('Invalid recovery clock');
  }
}
function after(now: number, delay: number): number {
  const deadline = now + delay;
  if (!Number.isSafeInteger(deadline)) {
    throw new RangeError('Recovery deadline overflow');
  }
  return deadline;
}
function openCircuit(
  state: RecoveryState,
  policy: BreakerPolicy,
  now: number,
  increase: boolean,
): void {
  const pauseStep = increase ? increment(state.pauseStep) : state.pauseStep;
  const epoch = increment(state.breakerEpoch);
  const until = after(
    now,
    exponentialDelay(policy.initialPauseMs, policy.factor, policy.maxPauseMs, pauseStep),
  );
  state.pauseStep = pauseStep;
  state.breakerEpoch = epoch;
  state.circuit = 'open';
  state.probe = null;
  state.openUntil = until;
}

/** May retire an expired probe. Persist that transition even if admission fails. */
export function recoveryAdmission(
  state: RecoveryState,
  policy: RecoveryPolicy,
  now: number,
): RecoveryAdmission {
  timestamp(now);
  if (policy.breaker && state.probe && state.probe.expiresAt <= now) {
    const expired = state.probe.id;
    openCircuit(state, policy.breaker, now, false);
    delete state.attempts[expired];
  }
  const deadlines: number[] = [];
  if (state.cooldownUntil > now) {
    deadlines.push(state.cooldownUntil);
  }
  if (state.circuit === 'open' && state.openUntil > now) {
    deadlines.push(state.openUntil);
  }
  if (state.circuit === 'half-open') {
    deadlines.push(state.probe!.expiresAt);
  }
  return {
    allowed: deadlines.length === 0,
    circuit: state.circuit,
    // All restrictions must expire; an earlier timer would only produce a refused check.
    notBefore: deadlines.length ? Math.max(...deadlines) : null,
  };
}

/** Invoke only when ordinary capacity and budgets are also available. */
export function admitRecoveryAttempt(
  state: RecoveryState,
  policy: RecoveryPolicy,
  id: string,
  now: number,
): boolean {
  if (
    !id ||
    Object.hasOwn(state.attempts, id) ||
    ['__proto__', 'constructor', 'prototype'].includes(id)
  ) {
    throw new TypeError('Invalid or duplicate attempt id');
  }
  if (!recoveryAdmission(state, policy, now).allowed) {
    return false;
  }
  const probe = state.circuit === 'open';
  if (probe) {
    const expiresAt = after(now, policy.breaker!.probeTimeoutMs);
    state.circuit = 'half-open';
    state.probe = { id, expiresAt };
  }
  state.attempts[id] = {
    cooldownEpoch: state.cooldownEpoch,
    breakerEpoch: state.breakerEpoch,
    probe,
  };
  return true;
}

export function validateOutcome(outcome: Outcome): void {
  if (
    !['success', 'throttle', 'service-failure', 'neutral'].includes(outcome.kind) ||
    Object.keys(outcome).some((key) => !['kind', 'retryAfterMs', 'throttled'].includes(key))
  ) {
    throw new TypeError('Invalid outcome');
  }
  if (outcome.throttled !== undefined && typeof outcome.throttled !== 'boolean') {
    throw new TypeError('Invalid throttled flag');
  }
  if (
    outcome.retryAfterMs !== undefined &&
    (!Number.isSafeInteger(outcome.retryAfterMs) || outcome.retryAfterMs < 0)
  ) {
    throw new RangeError('Invalid retryAfterMs');
  }
  if (outcome.kind === 'success' && (outcome.throttled || outcome.retryAfterMs !== undefined)) {
    throw new TypeError('Successful outcome cannot request cooldown');
  }
}

function cooldown(
  state: RecoveryState,
  policy: RecoveryPolicy,
  attempt: Attempt,
  outcome: Outcome,
  now: number,
): void {
  if (outcome.kind === 'throttle' || outcome.throttled || outcome.retryAfterMs !== undefined) {
    let until = state.cooldownUntil;
    const advance = attempt.cooldownEpoch === state.cooldownEpoch;
    if (advance) {
      until = Math.max(
        until,
        after(
          now,
          exponentialDelay(
            policy.retry.baseDelayMs,
            policy.retry.factor,
            policy.retry.maxDelayMs,
            state.cooldownStep,
          ),
        ),
      );
    }
    if (outcome.retryAfterMs !== undefined) {
      until = Math.max(until, after(now, outcome.retryAfterMs));
    }
    // Later provider guidance fences successes too, without treating one old
    // cohort as another exponential failure step.
    if (advance || until > state.cooldownUntil) {
      state.cooldownEpoch = increment(state.cooldownEpoch);
    }
    if (advance) {
      state.cooldownStep = increment(state.cooldownStep);
    }
    state.cooldownUntil = until;
  } else if (
    outcome.kind === 'success' &&
    attempt.cooldownEpoch === state.cooldownEpoch &&
    now >= state.cooldownUntil
  ) {
    state.cooldownStep = 0;
  }
}

function trip(state: RecoveryState, policy: BreakerPolicy, outcome: Outcome, now: number): boolean {
  if (outcome.kind !== 'success' && outcome.kind !== 'service-failure') {
    return false;
  }
  const failed = outcome.kind === 'service-failure';
  if (policy.rule === 'consecutive') {
    state.failures = failed ? increment(state.failures) : 0;
    return state.failures >= policy.failureThreshold!;
  }
  // Aggregate outcomes sharing the same millisecond; retain exactly the configured
  // sliding window rather than allowing old failures to affect a low-volume pool.
  state.samples = state.samples.filter((sample) => sample.at > now - policy.windowMs!);
  const previous = state.samples.at(-1);
  if (previous?.at === now) {
    previous.total = increment(previous.total);
    if (failed) {
      previous.failures = increment(previous.failures);
    }
  } else {
    state.samples.push({ at: now, failures: Number(failed), total: 1 });
  }
  const total = state.samples.reduce((sum, sample) => sum + sample.total, 0);
  const failures = state.samples.reduce((sum, sample) => sum + sample.failures, 0);
  return total >= policy.minimumSamples! && failures / total >= policy.failureRatio!;
}

/** Return false for duplicate/late reports. Backend persists this with release. */
function complete(
  state: RecoveryState,
  policy: RecoveryPolicy,
  id: string,
  outcome: Outcome,
  now: number,
): boolean {
  timestamp(now);
  validateOutcome(outcome);
  if (!Object.hasOwn(state.attempts, id)) {
    return false;
  }
  const attempt = state.attempts[id];
  // Fence a late probe even when no waiter has observed its deadline yet.
  recoveryAdmission(state, policy, now);
  if (!Object.hasOwn(state.attempts, id)) {
    return false;
  }
  cooldown(state, policy, attempt, outcome, now);
  if (policy.breaker && attempt.breakerEpoch === state.breakerEpoch) {
    if (attempt.probe && state.probe?.id === id) {
      if (outcome.kind === 'success') {
        state.breakerEpoch = increment(state.breakerEpoch);
        state.circuit = 'closed';
        state.probe = null;
        state.failures = 0;
        state.samples = [];
        state.pauseStep = 0;
        state.openUntil = 0;
      } else {
        openCircuit(state, policy.breaker, now, outcome.kind === 'service-failure');
      }
    } else if (state.circuit === 'closed' && trip(state, policy.breaker, outcome, now)) {
      openCircuit(state, policy.breaker, now, false);
    }
  }
  delete state.attempts[id];
  return true;
}

/** Apply atomically even for the in-process backend when validation overflows. */
export function completeRecoveryAttempt(
  state: RecoveryState,
  policy: RecoveryPolicy,
  id: string,
  outcome: Outcome,
  now: number,
): boolean {
  const draft = structuredClone(state);
  const accepted = complete(draft, policy, id, outcome, now);
  Object.assign(state, draft);
  return accepted;
}
