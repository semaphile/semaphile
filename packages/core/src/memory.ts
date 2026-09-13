// Explicit in-process entry point: importing it requires no SQLite or native addon.
import { ScheduledLimiter } from './client.js';
import { openMemoryBackend } from './memory-backend.js';
import type { PoolConfig } from './config.js';
export {
  LeaseExpiredError,
  QueueTimeoutError,
  ExecutionTimeoutError,
  AttemptTimeoutError,
} from './client.js';
export type { Admission, PoolConfig, ScheduleOptions, CloseOptions, Snapshot } from './client.js';
export type OpenOptions = { key: string; config: PoolConfig };

export class Limiter extends ScheduledLimiter {
  static async open(options: OpenOptions): Promise<Limiter> {
    return new Limiter(openMemoryBackend(options.key, options.config));
  }
}
export const openLimiter = (options: OpenOptions): Promise<Limiter> => Limiter.open(options);

export type {
  ExecuteOptions,
  ExecutionPolicy,
  OutcomeClassifier,
  AttemptContext,
  AttemptResult,
} from './client.js';

export { DrainTimeoutError, PoolDrainingError, CircuitOpenError } from './client.js';
export type { Maintenance, DrainWaitOptions, ControlSnapshot, ControlReceipt } from './client.js';

export type { HttpClient, HttpInput, HttpOptions, ClassifiedOutcome } from './client.js';
