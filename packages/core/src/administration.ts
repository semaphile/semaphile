import type { Telemetry } from './telemetry.js';
// Administrative waits observe persisted acceptance/completion boundaries. A
// timeout or local client close cancels the wait, never resumes the pool.
import type { ClientBackend } from './client.js';
import type { ControlCommand, ControlReceipt, ControlSnapshot } from './control-state.js';
import { deadline } from './deadline.js';
import { abortError } from './client-errors.js';
export type DrainWaitOptions = { generation: number; timeoutMs?: number; signal?: AbortSignal };
export class DrainTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Drain wait exceeded ${timeoutMs} ms`);
    this.name = 'DrainTimeoutError';
  }
}
export interface Maintenance {
  status(): Promise<ControlSnapshot>;
  drain(): Promise<ControlReceipt>;
  wait(options: DrainWaitOptions): Promise<ControlSnapshot>;
  acknowledge(options: {
    generation: number;
    ids: string[];
    reason: string;
  }): Promise<ControlReceipt>;
  resume(generation: number): Promise<ControlReceipt>;
}
export function createAdministration(
  backend: ClientBackend,
  telemetry?: Telemetry,
): {
  api: Maintenance;
  close: () => Promise<void>;
} {
  let closed = false;
  const closing = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closed) {
      return Promise.reject(new Error('Limiter is closing or closed'));
    }
    const task = Promise.resolve().then(operation);
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  };
  const command = (input: ControlCommand) =>
    run(async () => {
      const observation = telemetry?.begin(`maintenance.${input.action}`);
      let status: 'fulfilled' | 'rejected' = 'rejected';
      try {
        const result = await backend.call('control', { command: input });
        observation?.emit('stateObserved', {
          state:
            'recovery' in result
              ? `${result.maintenance.mode}/${result.recovery.circuit}`
              : result.maintenance.mode,
        });
        status = 'fulfilled';
        return result;
      } finally {
        observation?.settle(status);
        observation?.end(status);
      }
    });
  const api: Maintenance = {
    status: () => command({ action: 'status' }) as Promise<ControlSnapshot>,
    drain: () => command({ action: 'drain' }),
    acknowledge: ({ generation, ids, reason }) =>
      command({ action: 'acknowledge', generation, ids: [...ids], reason }),
    resume: (generation) => command({ action: 'resume', generation }),
    wait: (options) => {
      const { generation, timeoutMs, signal } = options;
      if (!Number.isSafeInteger(generation) || generation < 1) {
        return Promise.reject(new RangeError('Invalid drain generation'));
      }
      if (
        timeoutMs !== undefined &&
        (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      ) {
        return Promise.reject(new RangeError('Invalid drain timeout'));
      }
      const controller = new AbortController();
      const combined = AbortSignal.any([closing.signal, ...(signal ? [signal] : [])]);
      const abort = () => controller.abort(abortError());
      combined.addEventListener('abort', abort, { once: true });
      if (combined.aborted) {
        abort();
      }
      const timer = deadline(timeoutMs === undefined ? null : performance.now() + timeoutMs, () =>
        controller.abort(new DrainTimeoutError(timeoutMs!)),
      );
      const task = run(async () => {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        try {
          const result = await backend.call('waitDrain', { generation }, controller.signal);
          timer.check();
          if (controller.signal.aborted) {
            throw controller.signal.reason;
          }
          return result;
        } catch (error) {
          throw controller.signal.aborted ? controller.signal.reason : error;
        }
      });
      return task.finally(() => {
        timer.stop();
        combined.removeEventListener('abort', abort);
      });
    },
  };
  return {
    api,
    close: async () => {
      closed = true;
      closing.abort();
      await Promise.allSettled(pending);
    },
  };
}
