// Declarative recovery policy. Backends compare normalized values, while the
// fingerprint is a compact diagnostic identifier, not proof of callback code.
import { createHash } from 'node:crypto';

export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number;
};
export type BreakerConfig = {
  rule?: 'consecutive' | 'percentage';
  failureThreshold?: number;
  failureRatio?: number;
  minimumSamples?: number;
  windowMs?: number;
  initialPauseMs?: number;
  maxPauseMs?: number;
  factor?: number;
  probeTimeoutMs?: number;
};
export type RecoveryConfig = {
  classifierId?: string;
  retry?: Partial<RetryPolicy>;
  deadlineMs?: number | null;
  attemptTimeoutMs?: number | null;
  breaker?: false | BreakerConfig;
};
export type BreakerPolicy = {
  rule: 'consecutive' | 'percentage';
  failureThreshold: number | null;
  failureRatio: number | null;
  minimumSamples: number | null;
  windowMs: number | null;
  initialPauseMs: number;
  maxPauseMs: number;
  factor: number;
  probeTimeoutMs: number;
};
export type RecoveryPolicy = {
  classifierId: string;
  retry: RetryPolicy;
  deadlineMs: number | null;
  attemptTimeoutMs: number | null;
  breaker: BreakerPolicy | null;
};

const timerMaximum = 2_147_483_647;
function object(value: unknown, keys: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`Unknown ${name} field`);
  }
  return value as Record<string, unknown>;
}
function integer(value: number, name: string, min = 1, max = timerMaximum): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${name}`);
  }
  return value;
}
function fraction(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${name}`);
  }
  return value;
}
function timeout(value: number | null | undefined, fallback: number, name: string) {
  return value === null ? null : integer(value ?? fallback, name);
}

function normalizeBreaker(value: false | BreakerConfig | undefined): BreakerPolicy | null {
  if (value === undefined || value === false) {
    return null;
  }
  object(
    value,
    [
      'rule',
      'failureThreshold',
      'failureRatio',
      'minimumSamples',
      'windowMs',
      'initialPauseMs',
      'maxPauseMs',
      'factor',
      'probeTimeoutMs',
    ],
    'breaker',
  );
  const rule = value.rule ?? 'consecutive';
  if (rule !== 'consecutive' && rule !== 'percentage') {
    throw new TypeError('Invalid breaker rule');
  }
  if (
    rule === 'consecutive' &&
    [value.failureRatio, value.minimumSamples, value.windowMs].some((v) => v !== undefined)
  ) {
    throw new TypeError('Percentage settings require the percentage breaker rule');
  }
  if (rule === 'percentage' && value.failureThreshold !== undefined) {
    throw new TypeError('failureThreshold requires the consecutive breaker rule');
  }
  const initialPauseMs = integer(value.initialPauseMs ?? 30_000, 'initialPauseMs');
  const maxPauseMs = integer(value.maxPauseMs ?? 300_000, 'maxPauseMs');
  if (maxPauseMs < initialPauseMs) {
    throw new RangeError('maxPauseMs is below initialPauseMs');
  }
  return {
    rule,
    failureThreshold:
      rule === 'consecutive' ? integer(value.failureThreshold ?? 5, 'failureThreshold') : null,
    failureRatio:
      rule === 'percentage'
        ? fraction(value.failureRatio!, 'failureRatio', Number.MIN_VALUE, 1)
        : null,
    minimumSamples: rule === 'percentage' ? integer(value.minimumSamples!, 'minimumSamples') : null,
    windowMs: rule === 'percentage' ? integer(value.windowMs!, 'windowMs') : null,
    initialPauseMs,
    maxPauseMs,
    factor: fraction(value.factor ?? 2, 'breaker factor', 1, 16),
    probeTimeoutMs: integer(value.probeTimeoutMs ?? 60_000, 'probeTimeoutMs'),
  };
}

export function normalizeRecovery(config: RecoveryConfig = {}): RecoveryPolicy {
  object(
    config,
    ['classifierId', 'retry', 'deadlineMs', 'attemptTimeoutMs', 'breaker'],
    'recovery',
  );
  const retry = config.retry ?? {};
  object(retry, ['maxAttempts', 'baseDelayMs', 'maxDelayMs', 'factor', 'jitter'], 'retry');
  const baseDelayMs = integer(retry.baseDelayMs ?? 500, 'baseDelayMs');
  const maxDelayMs = integer(retry.maxDelayMs ?? 10_000, 'maxDelayMs');
  if (maxDelayMs < baseDelayMs) {
    throw new RangeError('maxDelayMs is below baseDelayMs');
  }
  const classifierId = config.classifierId ?? 'semaphile.generic/1';
  if (typeof classifierId !== 'string' || !classifierId.trim() || classifierId.length > 256) {
    throw new TypeError('Invalid classifierId');
  }
  return {
    classifierId,
    retry: {
      maxAttempts: integer(retry.maxAttempts ?? 3, 'maxAttempts'),
      baseDelayMs,
      maxDelayMs,
      factor: fraction(retry.factor ?? 2, 'retry factor', 1, 16),
      jitter: fraction(retry.jitter ?? 0.2, 'jitter', 0, 1),
    },
    deadlineMs: timeout(config.deadlineMs, 300_000, 'deadlineMs'),
    attemptTimeoutMs: timeout(config.attemptTimeoutMs, 60_000, 'attemptTimeoutMs'),
    breaker: normalizeBreaker(config.breaker),
  };
}

/** Canonical input shape stays valid when a coordinator normalizes it again. */
export function recoveryConfig(policy: RecoveryPolicy): RecoveryConfig {
  const breaker = policy.breaker;
  return {
    classifierId: policy.classifierId,
    retry: { ...policy.retry },
    deadlineMs: policy.deadlineMs,
    attemptTimeoutMs: policy.attemptTimeoutMs,
    breaker:
      breaker === null
        ? false
        : {
            rule: breaker.rule,
            ...(breaker.rule === 'consecutive'
              ? { failureThreshold: breaker.failureThreshold! }
              : {
                  failureRatio: breaker.failureRatio!,
                  minimumSamples: breaker.minimumSamples!,
                  windowMs: breaker.windowMs!,
                }),
            initialPauseMs: breaker.initialPauseMs,
            maxPauseMs: breaker.maxPauseMs,
            factor: breaker.factor,
            probeTimeoutMs: breaker.probeTimeoutMs,
          },
  };
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  throw new TypeError('Fingerprint input must contain normalized JSON values');
}

export function configFingerprint(normalized: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(normalized)))
    .digest('hex');
}

export function exponentialDelay(base: number, factor: number, cap: number, step: number): number {
  return Math.min(cap, Math.ceil(base * factor ** step));
}

/** failedAttempt is one-based; randomness is injectable only at this pure seam. */
export function retryDelay(
  policy: RetryPolicy,
  failedAttempt: number,
  random = Math.random(),
): number {
  integer(failedAttempt, 'failedAttempt');
  fraction(random, 'random', 0, 1);
  const delay = exponentialDelay(
    policy.baseDelayMs,
    policy.factor,
    policy.maxDelayMs,
    failedAttempt - 1,
  );
  return Math.min(
    policy.maxDelayMs,
    Math.max(0, Math.round(delay * (1 + policy.jitter * (2 * random - 1)))),
  );
}
