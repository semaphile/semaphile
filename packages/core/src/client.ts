// Backend-neutral callback and shutdown lifecycle. No filesystem/native imports.
import type { Admission, Operations } from './protocol.js';
import { normalizeExpiration, validateWeight } from './config.js';
import { QueueTimeoutError, validateAdmission } from './client-errors.js';
import {
  startExecution,
  type ExecuteOptions,
  type AttemptContext,
  type ExecutionHandle,
} from './execution.js';
import { createHttpClient, type HttpClient } from './http.js';
export type { HttpClient, HttpInput, HttpOptions } from './http.js';
import { createAdministration, type Maintenance } from './administration.js';
export { DrainTimeoutError } from './administration.js';
export type { Maintenance, DrainWaitOptions } from './administration.js';
import type { RecoveryPolicy } from './recovery-policy.js';
export {
  LeaseExpiredError,
  QueueTimeoutError,
  ExecutionTimeoutError,
  AttemptTimeoutError,
} from './client-errors.js';
export type {
  ClassifiedOutcome,
  ExecuteOptions,
  ExecutionPolicy,
  OutcomeClassifier,
  AttemptContext,
  AttemptResult,
} from './execution.js';
export {
  normalize as normalizePoolConfig,
  normalizeExpiration,
  validateWeight,
  InputError,
} from './config.js';
export type { PoolConfig } from './config.js';
export type { Admission, Operations } from './protocol.js';
export { PoolDrainingError } from './maintenance-state.js';
export { CircuitOpenError } from './control-state.js';
export { normalizeRecovery, configFingerprint } from './recovery-policy.js';
export type { RecoveryConfig, RecoveryPolicy } from './recovery-policy.js';
export type {
  ControlCommand,
  ControlSnapshot,
  ControlReceipt,
  ControlResult,
  AttemptOptions,
} from './control-state.js';
export type { OperationToken } from './maintenance-state.js';
export type { Outcome } from './recovery-state.js';
export type ScheduleOptions = {
  signal?: AbortSignal;
  weight?: number;
  expirationMs?: number | null;
  /** Maximum time from submission until the callback starts; excludes running time. */
  queueTimeoutMs?: number;
};
export type CloseOptions = { drain?: boolean };
export type Snapshot = {
  active: number;
  reservoir: number | null;
  leases: Array<{ id: string; owner: string; expires: number | null; weight: number }>;
  trace: Array<Record<string, unknown>>;
};

export interface ClientBackend {
  readonly recovery?: RecoveryPolicy;
  readonly maxConcurrent: number | null;
  readonly expirationMs: number | null;
  readonly failure: Error | undefined;
  call<K extends keyof Operations>(
    action: K,
    extra: Operations[K]['input'],
    signal?: AbortSignal,
  ): Promise<Operations[K]['output']>;
  detach(): Promise<void>;
  isExpired?(admission: Admission): boolean;
}
const abortError = () =>
  Object.assign(new Error('Scheduled job aborted before starting'), { name: 'AbortError' });
const closedError = () => new Error('Limiter is closing or closed');

type Failure = { failed: boolean; error?: unknown };
type Job = {
  running: boolean;
  controller: AbortController;
  cancel: (error: Error) => void;
  finished: Promise<void>;
};
export class ScheduledLimiter {
  private readonly backend: ClientBackend;
  private readonly administration;
  readonly maintenance: Maintenance;
  readonly http: HttpClient;
  private readonly jobs = new Set<Job>();
  private readonly executions = new Set<ExecutionHandle<unknown>>();
  private closing: Promise<void> | undefined;
  private isClosing = false;
  private readonly cleanupErrors: unknown[] = [];
  protected constructor(backend: ClientBackend) {
    this.backend = backend;
    this.administration = createAdministration(backend);
    this.maintenance = this.administration.api;
    this.http = createHttpClient(backend, (task, options) => this.execute(task, options));
  }

  /** Queue a callback; its result settles after lease cleanup, except queued cancellation. */
  schedule<T>(
    task: (admission: Admission) => T | PromiseLike<T>,
    options: ScheduleOptions = {},
  ): Promise<T> {
    const submittedAt = performance.now();
    if (this.isClosing) {
      return Promise.reject(closedError());
    }
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('Task must be a function'));
    }
    const { weight = 1 } = options;
    const expirationMs =
      options.expirationMs === undefined ? this.backend.expirationMs : options.expirationMs;
    try {
      validateWeight(weight, this.backend.maxConcurrent);
      normalizeExpiration(expirationMs);
      if (
        options.queueTimeoutMs !== undefined &&
        (!Number.isSafeInteger(options.queueTimeoutMs) ||
          options.queueTimeoutMs < 1 ||
          options.queueTimeoutMs > 2_147_483_647)
      ) {
        throw new RangeError('Invalid queueTimeoutMs');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortError());
    }
    let resolveResult!: (value: T | PromiseLike<T>) => void,
      rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((yes, no) => {
      resolveResult = yes;
      rejectResult = no;
    });
    // Queue cancellation settles the caller immediately. job.finished still tracks
    // late admission/release so close() cannot retire the backend too early.
    let cancelled = false;
    const queueTimeoutMs = options.queueTimeoutMs;
    const queueDeadline = queueTimeoutMs === undefined ? undefined : submittedAt + queueTimeoutMs;
    let queueTimer: ReturnType<typeof setTimeout> | undefined;
    const clearQueueTimer = () => {
      clearTimeout(queueTimer);
      queueTimer = undefined;
    };
    const controller = new AbortController();
    const abort = () => job.cancel(abortError());
    const job: Job = {
      running: false,
      controller,
      finished: Promise.resolve(),
      cancel: (error) => {
        if (job.running || cancelled) {
          return;
        }
        cancelled = true;
        clearQueueTimer();
        controller.abort();
        rejectResult(error);
        options.signal?.removeEventListener('abort', abort);
      },
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    this.jobs.add(job);
    const checkQueueDeadline = () => {
      if (queueDeadline === undefined || queueTimeoutMs === undefined || cancelled || job.running) {
        return;
      }
      const remaining = queueDeadline - performance.now();
      if (remaining <= 0) {
        job.cancel(new QueueTimeoutError(queueTimeoutMs));
      } else {
        // Recompute only if the runtime delivered its timer before the deadline.
        queueTimer = setTimeout(checkQueueDeadline, Math.ceil(remaining));
      }
    };
    checkQueueDeadline();
    const runJob = async () => {
      let lease: string | undefined, value!: T;
      // A separate flag preserves rejection reasons such as undefined or false.
      const failure: Failure = { failed: false };
      try {
        const admission = Object.freeze(
          await this.backend.call('acquire', { weight, expirationMs }, controller.signal),
        );
        // Save the identity before checking cancellation: even a late grant owns
        // capacity until this client explicitly releases it.
        lease = admission.leaseId;
        // A delayed event loop can deliver admission before an overdue timer.
        if (queueDeadline !== undefined && performance.now() >= queueDeadline) {
          job.cancel(new QueueTimeoutError(queueTimeoutMs!));
        }
        if (!cancelled && this.backend.failure) {
          throw this.backend.failure;
        }
        if (!cancelled) {
          validateAdmission(this.backend, admission);
          clearQueueTimer();
          job.running = true;
          options.signal?.removeEventListener('abort', abort);
          value = await task(admission);
        }
      } catch (error) {
        if (!cancelled) {
          failure.failed = true;
          failure.error = error;
        }
      } finally {
        if (lease) {
          await this.releaseLease(lease, failure);
        }
        clearQueueTimer();
        options.signal?.removeEventListener('abort', abort);
        this.jobs.delete(job);
      }
      if (cancelled) {
        return;
      }
      if (failure.failed) {
        rejectResult(failure.error);
      } else {
        resolveResult(value);
      }
    };
    job.finished = runJob();
    return result;
  }

  execute<T>(
    task: (context: AttemptContext) => T | PromiseLike<T>,
    options: ExecuteOptions<T> = {},
  ): Promise<T> {
    if (this.isClosing) {
      return Promise.reject(closedError());
    }
    try {
      const execution = startExecution(this.backend, task, options, (error) =>
        this.cleanupErrors.push(error),
      );
      this.executions.add(execution);
      void execution.finished.finally(() => this.executions.delete(execution)).catch(() => {});
      return execution.result;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async releaseLease(lease: string, failure: Failure): Promise<void> {
    try {
      await this.backend.call('release', { lease });
    } catch (error) {
      this.cleanupErrors.push(error);
      failure.error = failure.failed
        ? new AggregateError([failure.error, error], 'Task and lease release failed')
        : error;
      failure.failed = true;
    }
  }

  inspect(): Promise<Snapshot> {
    if (this.isClosing) {
      return Promise.reject(closedError());
    }
    return this.backend.call('inspect', {});
  }
  currentReservoir(): Promise<number | null> {
    if (this.isClosing) {
      return Promise.reject(closedError());
    }
    return this.backend.call('reservoir', {});
  }
  incrementReservoir(amount: number): Promise<number> {
    if (this.isClosing) {
      return Promise.reject(closedError());
    }
    if (!Number.isSafeInteger(amount)) {
      return Promise.reject(new RangeError('Invalid reservoir increment'));
    }
    return this.backend.call('increment', { amount });
  }
  /** Stop submissions and await cleanup. The first call selects drain behavior. */
  close(options: CloseOptions = {}): Promise<void> {
    if (this.closing) {
      return this.closing;
    }
    this.isClosing = true;
    const administrationClosed = this.administration.close();
    if (!options.drain) {
      for (const execution of this.executions) {
        execution.stop();
      }
      for (const job of this.jobs) {
        job.cancel(closedError());
      }
    }
    this.closing = (async () => {
      try {
        await Promise.all([
          administrationClosed,
          ...[...this.jobs, ...this.executions].map((job) => job.finished),
        ]);
      } finally {
        await this.backend.detach();
      }
      if (this.cleanupErrors.length) {
        throw new AggregateError(this.cleanupErrors, 'Lease cleanup failed');
      }
    })();
    return this.closing;
  }
}
