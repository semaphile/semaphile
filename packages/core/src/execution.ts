import type { Telemetry } from './telemetry.js';
// An execution owns one accepted operation across all attempts. Caller deadlines
// settle promptly; finished still tracks actual callback and storage cleanup.
import { randomUUID } from 'node:crypto';
import type { ClientBackend, ScheduleOptions } from './client.js';
import type { Admission } from './protocol.js';
import type { OperationToken } from './maintenance-state.js';
import { normalizeExpiration, validateWeight } from './config.js';
import {
  normalizeRecovery,
  recoveryConfig,
  retryDelay,
  type RecoveryConfig,
} from './recovery-policy.js';
import { validateOutcome, type Outcome } from './recovery-state.js';
import { deadline, delayUntil } from './deadline.js';
import {
  abortError,
  validateAdmission,
  QueueTimeoutError,
  ExecutionTimeoutError,
  AttemptTimeoutError,
} from './client-errors.js';

export type AttemptContext = Readonly<{
  admission: Admission;
  operationId: string;
  attempt: number;
  signal: AbortSignal;
}>;
export type AttemptResult<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; error: unknown };
export type ClassifiedOutcome = Outcome & { retry?: boolean };
export type OutcomeClassifier<T> = {
  id: string;
  classify: (result: AttemptResult<T>) => ClassifiedOutcome;
};
export type ExecutionPolicy = Pick<
  RecoveryConfig,
  'retry' | 'deadlineMs' | 'attemptTimeoutMs' | 'classifierId'
>;
export type ExecuteOptions<T> = ScheduleOptions & {
  /** Automatic replay requires both safe and an explicit transient classifier. */
  retrySafety?: 'safe' | 'unsafe';
  classifier?: OutcomeClassifier<T>;
  /** Explicit per-operation override; never changes shared breaker/admission policy. */
  policy?: ExecutionPolicy;
  circuit?: 'wait' | 'fail-fast';
};
export type ExecutionHandle<T> = { result: Promise<T>; finished: Promise<void>; stop: () => void };

function executionPolicy<T>(backend: ClientBackend, options: ExecuteOptions<T>) {
  const base = recoveryConfig(backend.recovery ?? normalizeRecovery());
  const override = options.policy ?? {};
  if (
    Object.keys(override).some(
      (key) => !['retry', 'deadlineMs', 'attemptTimeoutMs', 'classifierId'].includes(key),
    )
  ) {
    throw new TypeError('Unknown execution policy override');
  }
  const policy = normalizeRecovery({
    ...base,
    ...override,
    retry: { ...base.retry, ...override.retry },
  });
  if (options.retrySafety !== undefined && !['safe', 'unsafe'].includes(options.retrySafety)) {
    throw new TypeError('Invalid retrySafety');
  }
  if (options.circuit !== undefined && !['wait', 'fail-fast'].includes(options.circuit)) {
    throw new TypeError('Invalid circuit behavior');
  }
  if (
    options.classifier &&
    (typeof options.classifier.classify !== 'function' ||
      options.classifier.id !== policy.classifierId)
  ) {
    throw new TypeError('Classifier must match the configured policy/version identifier');
  }
  return policy;
}

export function startExecution<T>(
  backend: ClientBackend,
  task: (context: AttemptContext) => T | PromiseLike<T>,
  input: ExecuteOptions<T>,
  cleanupFailure: (error: unknown) => void,
  telemetry?: Telemetry,
): ExecutionHandle<T> {
  const submitted = performance.now();
  if (typeof task !== 'function') {
    throw new TypeError('Task must be a function');
  }
  const policy = executionPolicy(backend, input);
  // Copy options before queueing; mutation by a caller cannot change retry safety
  // or classifier identity after this operation has been accepted.
  const options = {
    ...input,
    classifier: input.classifier && {
      id: input.classifier.id,
      classify: input.classifier.classify.bind(input.classifier),
    },
  };
  const { weight = 1, queueTimeoutMs } = options;
  const expirationMs =
    options.expirationMs === undefined ? backend.expirationMs : options.expirationMs;
  validateWeight(weight, backend.maxConcurrent);
  normalizeExpiration(expirationMs);
  if (
    queueTimeoutMs !== undefined &&
    (!Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1 || queueTimeoutMs > 2_147_483_647)
  ) {
    throw new RangeError('Invalid queueTimeoutMs');
  }
  const observation = telemetry?.begin('execute');
  const controller = new AbortController();
  let running = false,
    settling = false,
    stopRetries = false;
  let resolveResult!: (value: T) => void, rejectResult!: (error: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const cancel = (error: Error) => {
    if (controller.signal.aborted) {
      return;
    }
    controller.abort(error);
    observation?.settle('cancelled');
    rejectResult(error);
  };
  const abort = () => cancel(abortError());
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) {
    abort();
  }
  const overall = deadline(policy.deadlineMs === null ? null : submitted + policy.deadlineMs, () =>
    cancel(new ExecutionTimeoutError(policy.deadlineMs!)),
  );
  let queueTimer: ReturnType<typeof deadline> | undefined;
  let attemptTimer: ReturnType<typeof deadline> | undefined;
  const checkCancelled = () => {
    overall.check();
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
  };
  const finished = (async () => {
    let operation: OperationToken | undefined;
    let completion: AttemptResult<T> | undefined;
    try {
      checkCancelled();
      queueTimer = deadline(queueTimeoutMs === undefined ? null : submitted + queueTimeoutMs, () =>
        cancel(new QueueTimeoutError(queueTimeoutMs!)),
      );
      operation = await backend.call('accept', { operationId: randomUUID() });
      for (let attempt = 1; attempt <= policy.retry.maxAttempts; attempt++) {
        checkCancelled();
        if (attempt > 1) {
          observation?.emit('queued', { attempt });
        }
        const queueAt = attempt === 1 ? submitted : performance.now();
        queueTimer?.stop();
        queueTimer = deadline(queueTimeoutMs === undefined ? null : queueAt + queueTimeoutMs, () =>
          cancel(new QueueTimeoutError(queueTimeoutMs!)),
        );
        let admission: Admission | undefined;
        let outcome: Outcome = { kind: 'neutral' };
        let retryable = true;
        let failure: { error: unknown } | undefined;
        const attemptController = new AbortController();
        const forwardAbort = () => attemptController.abort(controller.signal.reason);
        controller.signal.addEventListener('abort', forwardAbort, { once: true });
        try {
          checkCancelled();
          admission = Object.freeze(
            await backend.call(
              'acquire',
              { weight, expirationMs, operation, circuit: options.circuit },
              controller.signal,
            ),
          );
          observation?.emit('leaseGranted', { weight, attempt });
          queueTimer.check();
          checkCancelled();
          if (backend.failure) {
            throw backend.failure;
          }
          validateAdmission(backend, admission);
          queueTimer.stop();
          running = true;
          attemptTimer = deadline(
            policy.attemptTimeoutMs === null ? null : performance.now() + policy.attemptTimeoutMs,
            () => cancel(new AttemptTimeoutError(policy.attemptTimeoutMs!)),
          );
          observation?.emit('attemptStarted', { attempt });
          const started = performance.now();
          try {
            const invoke = () =>
              task(
                Object.freeze({
                  admission: admission!,
                  operationId: operation!.id,
                  attempt,
                  signal: attemptController.signal,
                }),
              );
            completion = {
              status: 'fulfilled',
              value: await (observation ? observation.run(invoke) : invoke()),
            };
          } catch (error) {
            completion = { status: 'rejected', error };
          }
          observation?.emit('attemptCompleted', {
            attempt,
            status: completion.status,
            durationMs: performance.now() - started,
          });
          attemptTimer.check();
          attemptTimer.stop();
          checkCancelled();
          if (options.classifier) {
            const { retry, ...classified } = options.classifier.classify(completion);
            if (retry !== undefined && typeof retry !== 'boolean') {
              throw new TypeError('Invalid classifier retry decision');
            }
            validateOutcome(classified);
            retryable = retry ?? true;
            outcome = { ...classified };
          }
        } catch (error) {
          failure = { error };
        } finally {
          overall.check();
          if (controller.signal.aborted) {
            outcome = { kind: 'neutral' };
          }
          controller.signal.removeEventListener('abort', forwardAbort);
          attemptTimer?.stop();
          queueTimer?.stop();
          // running remains true through release: close must not detach an owner
          // before the atomic outcome/completion write has finished.
          if (admission) {
            try {
              await backend.call('release', { lease: admission.leaseId, outcome });
              observation?.emit('leaseReleased', {
                attempt,
                status: 'fulfilled',
                state: outcome.kind,
              });
            } catch (error) {
              cleanupFailure(error);
              failure = {
                error: failure
                  ? new AggregateError([failure.error, error], 'Attempt and release failed')
                  : error,
              };
            }
          }
          running = false;
        }
        if (failure) {
          throw failure.error;
        }
        checkCancelled();
        if (!completion) {
          throw new Error('Attempt completed without a result');
        }
        const transient = outcome.kind === 'throttle' || outcome.kind === 'service-failure';
        if (
          stopRetries ||
          !retryable ||
          options.retrySafety !== 'safe' ||
          !transient ||
          attempt === policy.retry.maxAttempts
        ) {
          break;
        }
        // Provider cooldown is also enforced atomically by the shared backend.
        const delayMs = Math.max(retryDelay(policy.retry, attempt), outcome.retryAfterMs ?? 0);
        observation?.emit('retryScheduled', { attempt, delayMs });
        await delayUntil(performance.now() + delayMs, controller.signal);
      }
    } catch (error) {
      completion = { status: 'rejected', error };
    } finally {
      settling = true;
      queueTimer?.stop();
      attemptTimer?.stop();
      if (operation) {
        try {
          await backend.call('finish', { operation });
        } catch (error) {
          cleanupFailure(error);
          completion = { status: 'rejected', error };
        }
      }
      overall.check();
      overall.stop();
      options.signal?.removeEventListener('abort', abort);
    }
    observation?.settle(completion?.status ?? 'rejected');
    observation?.end();
    if (completion?.status === 'fulfilled') {
      resolveResult(completion.value);
    } else if (completion?.status === 'rejected') {
      rejectResult(completion.error);
    } else {
      rejectResult(controller.signal.reason);
    }
  })();
  return {
    result,
    finished,
    stop: () => {
      stopRetries = true;
      if (!running && !settling) {
        cancel(new Error('Limiter is closing or closed'));
      }
    },
  };
}
