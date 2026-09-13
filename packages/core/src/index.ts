// Public scheduling/lifecycle API. Clients in one JS runtime share a coordinator
// for each canonical pool; separate processes coordinate through the same files.
import { mkdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ScheduledLimiter } from './client.js';
import { nativePath } from './native-path.ts';
import { Worker } from 'node:worker_threads';
import type { Operations, Reply } from './protocol.js';
import { normalizeRecovery } from './recovery-policy.js';
import { normalize, InputError, type PoolConfig } from './config.js';
import { CircuitOpenError } from './control-state.js';
import { PoolDrainingError } from './maintenance-state.js';

export type { PoolConfig } from './config.js';
export type { Admission } from './protocol.js';
export type OpenOptions = { path: string; config: PoolConfig };
export {
  LeaseExpiredError,
  QueueTimeoutError,
  ExecutionTimeoutError,
  AttemptTimeoutError,
} from './client.js';
export type { ScheduleOptions, CloseOptions, Snapshot } from './client.js';
const registryKey = Symbol.for('semaphile.node.coordinators.v5');
const runtime = globalThis as typeof globalThis & { [registryKey]?: Map<string, Coordinator> };
const registry = (runtime[registryKey] ??= new Map());
const abortError = () =>
  Object.assign(new Error('Scheduled job aborted before starting'), { name: 'AbortError' });

class Coordinator {
  readonly key: string;
  readonly worker: Worker;
  readonly config: string;
  readonly recovery;
  readonly maxConcurrent: number | null;
  readonly expirationMs: number | null;
  readonly ready: Promise<void>;
  readonly exited: Promise<number>;
  users = 0;
  closing: Promise<void> | undefined;
  failure: Error | undefined;
  private nextId = 0;
  private transportClosed = false;
  private readonly requests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
  >();
  constructor(key: string, path: string, config: ReturnType<typeof normalize>) {
    this.key = key;
    this.config = JSON.stringify(config);
    this.recovery = normalizeRecovery(config.recovery);
    this.maxConcurrent = config.maxConcurrent;
    this.expirationMs = config.expirationMs;
    this.worker = new Worker(new URL('./coordinator.js', import.meta.url), {
      workerData: { path, config, addon: nativePath() },
    });
    let readyResolve!: () => void, readyReject!: (error: Error) => void;
    this.ready = new Promise((yes, no) => {
      readyResolve = yes;
      readyReject = no;
    });
    const fail = (error: Error) => {
      this.transportClosed = true;
      this.failure = error;
      readyReject(error);
      for (const pending of this.requests.values()) {
        pending.cleanup();
        pending.reject(error);
      }
      this.requests.clear();
    };
    this.worker.on('message', (message: Reply) => {
      if (message.event === 'ready') {
        readyResolve();
        return;
      }
      if (message.event === 'startup-error') {
        readyReject(new Error(message.error));
        return;
      }
      if (message.event === 'admission-failure') {
        this.failure = new Error(message.error);
        return;
      }
      if (message.id === undefined) {
        return;
      }
      const request = this.requests.get(message.id);
      if (!request) {
        return;
      }
      this.requests.delete(message.id);
      request.cleanup();
      if (message.error) {
        const error = message.aborted
          ? abortError()
          : message.errorName === 'PoolDrainingError'
            ? new PoolDrainingError(message.generation!)
            : message.errorName === 'CircuitOpenError'
              ? new CircuitOpenError(message.notBefore ?? null)
              : message.errorName === 'InputError'
                ? new InputError(message.error)
                : new Error(message.error);
        if (!message.aborted && !message.recoverable) {
          this.failure = error;
        }
        request.reject(error);
      } else {
        request.resolve(message.value);
      }
    });
    this.worker.on('error', fail);
    this.exited = new Promise((resolveExit) =>
      this.worker.once('exit', (code) => {
        this.transportClosed = true;
        if (!this.closing || this.requests.size) {
          fail(new Error(`Coordinator exited unexpectedly (${code})`));
        }
        resolveExit(code);
      }),
    );
  }
  call<K extends keyof Operations>(
    action: K,
    extra: Operations[K]['input'],
    signal?: AbortSignal,
  ): Promise<Operations[K]['output']> {
    if (this.transportClosed) {
      return Promise.reject(this.failure ?? new Error('Coordinator is closed'));
    }
    if (this.failure && !['close', 'release', 'inspect', 'finish', 'control'].includes(action)) {
      return Promise.reject(this.failure);
    }
    const id = ++this.nextId;
    const reply = new Promise<unknown>((resolveRequest, reject) => {
      const abort = () => this.worker.postMessage({ action: 'abort', target: id });
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.requests.set(id, { resolve: resolveRequest, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage({ id, action, ...extra });
        if (signal?.aborted) {
          abort();
        }
      } catch (error) {
        this.requests.delete(id);
        cleanup();
        reject(error);
      }
    });
    // Replies originate in our paired coordinator. The operation's request
    // ID connects the otherwise untyped structured-clone transport.
    return reply as Promise<Operations[K]['output']>;
  }
  async detach(): Promise<void> {
    this.users--;
    if (this.users) {
      return;
    }
    this.closing = (async () => {
      try {
        await this.call('close', {});
        const exitCode = await this.exited;
        if (exitCode !== 0) {
          throw new Error(`Coordinator shutdown failed (${exitCode})`);
        }
      } finally {
        if (registry.get(this.key) === this) {
          registry.delete(this.key);
        }
      }
    })();
    return this.closing;
  }
}

export class Limiter extends ScheduledLimiter {
  static async open(options: OpenOptions): Promise<Limiter> {
    const config = normalize(options.config);
    const path = resolve(options.path);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const canonical = await realpath(path),
      identity = await stat(canonical, { bigint: true });
    const key = `${identity.dev}:${identity.ino}`;
    // No await between registry selection and reservation; simultaneous opens
    // in this JS runtime attach to one coordinator or observe its closing state.
    let coordinator = registry.get(key);
    if (coordinator?.closing) {
      await coordinator.closing;
      return Limiter.open(options);
    }
    if (coordinator && coordinator.config !== JSON.stringify(config)) {
      throw new Error('Pool config mismatch');
    }
    if (coordinator?.failure) {
      throw coordinator.failure;
    }
    if (!coordinator) {
      coordinator = new Coordinator(key, canonical, config);
      registry.set(key, coordinator);
    }
    coordinator.users++;
    try {
      await coordinator.ready;
      return new Limiter(coordinator);
    } catch (error) {
      coordinator.users--;
      if (!coordinator.users && registry.get(key) === coordinator) {
        registry.delete(key);
      }
      throw error;
    }
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
