// Public lifecycle errors and the final pre-dispatch lease check are shared by
// single-attempt scheduling and bounded execution, independent of storage.
import type { Admission } from './protocol.js';
import type { ClientBackend } from './client.js';
export class LeaseExpiredError extends Error {
  constructor(readonly admission: Admission) {
    super('Admission lease expired before callback started');
    this.name = 'LeaseExpiredError';
  }
}
export class QueueTimeoutError extends Error {
  constructor(readonly queueTimeoutMs: number) {
    super(`Scheduled job did not start within ${queueTimeoutMs} ms`);
    this.name = 'QueueTimeoutError';
  }
}
export class ExecutionTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`Execution exceeded ${deadlineMs} ms`);
    this.name = 'ExecutionTimeoutError';
  }
}
export class AttemptTimeoutError extends Error {
  constructor(readonly attemptTimeoutMs: number) {
    super(`Attempt exceeded ${attemptTimeoutMs} ms`);
    this.name = 'AttemptTimeoutError';
  }
}
export const abortError = (message = 'Operation aborted') =>
  Object.assign(new Error(message), { name: 'AbortError' });
export function validateAdmission(backend: ClientBackend, admission: Admission): void {
  // Redis timestamps belong to its server; use the backend's monotonic bound.
  const expired =
    backend.isExpired?.(admission) ??
    (admission.expiresAt !== null && Date.now() >= admission.expiresAt);
  if (expired) {
    throw new LeaseExpiredError(admission);
  }
}
