import { ScheduledLimiter } from '@semaphile/core/client';
import { RedisBackend, type OpenOptions } from './backend.js';
export {
  LeaseExpiredError,
  QueueTimeoutError,
  ExecutionTimeoutError,
  AttemptTimeoutError,
} from '@semaphile/core/client';
export type {
  Admission,
  PoolConfig,
  ScheduleOptions,
  CloseOptions,
  Snapshot,
} from '@semaphile/core/client';
export type { OpenOptions } from './backend.js';

export class Limiter extends ScheduledLimiter {
  static async open(options: OpenOptions): Promise<Limiter> {
    const backend = new RedisBackend(options);
    await backend.open();
    return new Limiter(backend, options.telemetry, 'redis');
  }
}
export const openLimiter = (options: OpenOptions): Promise<Limiter> => Limiter.open(options);

export type {
  ExecuteOptions,
  ExecutionPolicy,
  OutcomeClassifier,
  AttemptContext,
  AttemptResult,
} from '@semaphile/core/client';

export { DrainTimeoutError, PoolDrainingError, CircuitOpenError } from '@semaphile/core/client';
export type {
  Maintenance,
  DrainWaitOptions,
  ControlSnapshot,
  ControlReceipt,
} from '@semaphile/core/client';

export type { HttpClient, HttpInput, HttpOptions, ClassifiedOutcome } from '@semaphile/core/client';
