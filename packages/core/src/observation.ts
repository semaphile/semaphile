// Public observational interface; native descriptors and SQLite stay in a worker.
import { Worker } from 'node:worker_threads';
export type PoolMeasurement = {
  at: number;
  active: number;
  maxConcurrent: number | null;
  reservoir: number | null;
  pending: number;
  unconfirmed: number;
  maintenance: string;
  circuit: string;
  cooldownUntil: number;
  openUntil: number;
};
export interface PoolObserver {
  valid(): boolean;
  sample(): Promise<PoolMeasurement>;
  owners(): Promise<string[]>;
  close(): Promise<void>;
}
export class CollectorConflictError extends Error {
  constructor(readonly owners: string[]) {
    super('Pool is already watched by another collector');
  }
}
export async function openPoolObserver(options: {
  path: string;
  collectorId: string;
  allowOverlap?: boolean;
}): Promise<PoolObserver> {
  const worker = new Worker(new URL('./observation-worker.js', import.meta.url), {
    workerData: options,
  });
  let sequence = 0,
    closed = false;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = (error: Error) => {
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    void worker.terminate();
  };
  worker.on('error', fail);
  worker.on('exit', () => fail(new Error('Pool observation worker stopped')));
  worker.on(
    'message',
    (reply: { id: number; value: unknown; error?: string; owners?: string[] }) => {
      const entry = pending.get(reply.id);
      if (!entry) {
        return;
      }
      pending.delete(reply.id);
      clearTimeout(entry.timer);
      if (reply.error) {
        entry.reject(
          reply.owners ? new CollectorConflictError(reply.owners) : new Error(reply.error),
        );
      } else {
        entry.resolve(reply.value);
      }
    },
  );
  const call = <T>(action: string): Promise<T> => {
    if (closed) {
      return Promise.reject(new Error('Pool observer is closed'));
    }
    if (pending.size >= 8) {
      return Promise.reject(new Error('Too many outstanding observation requests'));
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => fail(new Error('Pool observation timed out')), 2000);
      pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      worker.postMessage({ id, action });
    });
  };
  try {
    await call('open');
  } catch (error) {
    fail(new Error('Pool observer startup failed'));
    throw error;
  }
  return {
    valid: () => !closed,
    sample: () => call<PoolMeasurement>('sample'),
    owners: () => call<string[]>('owners'),
    close: async () => {
      if (!closed) {
        try {
          await call('close');
        } finally {
          closed = true;
          await worker.terminate();
        }
      }
    },
  };
}
