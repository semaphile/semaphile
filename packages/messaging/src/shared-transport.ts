import {
  MessageTelemetry,
  type MessageOperation,
  type MessageMetadata,
  type MessageTelemetryOptions,
} from './telemetry.js';
import { filterTrace } from './trace.js';
import { MessagingError } from './config.js';
import type { StoreConfig, Difference, Delivery } from './types.js';
/** Transport boundary shared by local workers and remote messaging stores. */
export interface MessagingReply {
  id: number;
  value?: unknown;
  error?: string;
  code?: string;
  clock?: { now: number; sent: number };
}
export interface MessagingCommand {
  id: number;
  action: string;
  args: object;
}
export interface MessagingTransport {
  postMessage(command: MessagingCommand): void;
  on(event: 'message', listener: (reply: MessagingReply) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
}
export class MessagingClientTransport {
  readonly config: Readonly<StoreConfig>;
  readonly differences: readonly Difference[];
  protected sequence = 0;
  protected readonly clocks = new WeakMap<object, { now: number; sent: number }>();
  protected readonly telemetry: MessageTelemetry;
  protected readonly observations = new Set<Promise<unknown>>();
  protected closing?: Promise<void>;
  protected failure?: Error;
  protected readonly waitControllers = new Set<AbortController>();
  protected readonly waitJobs = new Set<Promise<void>>();
  protected readonly calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  protected readonly listeners = new Set<{
    close: (options?: { cancel?: boolean }) => Promise<void>;
  }>();
  protected readonly exited: Promise<number>;
  constructor(
    readonly path: string,
    protected readonly worker: MessagingTransport,
    config: StoreConfig,
    differences: Difference[],
    telemetry?: MessageTelemetryOptions,
  ) {
    this.telemetry = new MessageTelemetry(telemetry);
    this.config = Object.freeze(config);
    this.differences = differences;
    const fail = (error: Error) => {
      this.failure = error;
      for (const call of this.calls.values()) {
        call.reject(error);
      }
      this.calls.clear();
    };
    worker.on('message', (reply: MessagingReply) => this.receiveReply(reply));
    worker.on('error', fail);
    this.exited = new Promise((resolveExit) =>
      worker.once('exit', (code) => {
        fail(new MessagingError('CLOSED', `Coordinator exited (${code})`));
        resolveExit(code);
      }),
    );
  }
  private receiveReply(reply: MessagingReply): void {
    const call = this.calls.get(reply.id);
    if (!call) {
      return;
    }
    this.calls.delete(reply.id);
    if (reply.error) {
      call.reject(new MessagingError(reply.code ?? 'STORE', reply.error));
    } else {
      this.recordClock(reply);
      call.resolve(reply.value);
    }
  }
  private recordClock(reply: MessagingReply): void {
    if (reply.clock && reply.value && typeof reply.value === 'object') {
      for (const value of Array.isArray(reply.value) ? reply.value : [reply.value]) {
        if (value && typeof value === 'object') {
          this.clocks.set(value, reply.clock);
        }
      }
    }
  }
  /** Private transport; callbacks always execute in the caller's runtime. */
  protected call<T>(
    action: string,
    args: object = {},
    signal?: AbortSignal,
    accepted = false,
  ): Promise<T> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (
      this.closing &&
      !accepted &&
      ![
        'ack',
        'release',
        'renew',
        'fail',
        'close',
        'history',
        'events',
        'agents',
        'subscription-touch',
      ].includes(action)
    ) {
      return Promise.reject(new MessagingError('CLOSED', 'Client closing'));
    }
    const id = ++this.sequence;
    const abort = () => this.worker.postMessage({ id: 0, action: 'abort', args: { target: id } });
    const result = new Promise<unknown>((resolveCall, reject) => {
      this.calls.set(id, { resolve: resolveCall, reject });
      try {
        this.worker.postMessage({ id, action, args });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
          abort();
        }
      } catch (error) {
        this.calls.delete(id);
        reject(error);
      }
    });
    return result.finally(() => signal?.removeEventListener('abort', abort)) as Promise<T>;
  }
  /** Conservative remaining lifetime; remote timestamps stay in server time. */
  remaining(value: object, timestamp: number): number {
    const clock = this.clocks.get(value);
    return clock ? clock.sent + timestamp - clock.now - performance.now() : timestamp - Date.now();
  }
  protected observe<T>(
    operation: MessageOperation,
    work: (scope: ReturnType<MessageTelemetry['begin']>) => Promise<T>,
    metadata: MessageMetadata = {},
    cleanup = false,
  ): Promise<T> {
    if (this.failure || (this.closing && !cleanup)) {
      return Promise.reject(this.failure ?? new MessagingError('CLOSED', 'Client closing'));
    }
    const at = Date.now();
    // Register the operation before invoking any consumer hook. Reentrant close
    // must await accepted work, and cannot prevent its eventual RPC dispatch.
    const result = Promise.resolve().then(async () => {
      const scope = this.telemetry.begin(operation, metadata, at);
      try {
        const value = await scope.run(() => work(scope));
        scope.end('fulfilled');
        return value;
      } catch (error) {
        scope.end('rejected');
        throw error;
      }
    });
    this.observations.add(result);
    void result.then(
      () => this.observations.delete(result),
      () => this.observations.delete(result),
    );
    return result;
  }
  protected filterDelivery(delivery: Delivery): void {
    try {
      delivery.trace = filterTrace(delivery.trace, this.telemetry.baggageAllowlist);
    } catch {
      delete delivery.trace;
      this.telemetry.diagnostic('trace-dropped');
    }
    if (delivery.trace) {
      delivery.receipt.trace = delivery.trace;
    }
  }
  track(listener: { close: (options?: { cancel?: boolean }) => Promise<void> }): void {
    this.listeners.add(listener);
  }
  untrack(listener: { close: (options?: { cancel?: boolean }) => Promise<void> }): void {
    this.listeners.delete(listener);
  }
  close(options: { cancel?: boolean } = {}): Promise<void> {
    if (options.cancel) {
      for (const listener of this.listeners) {
        void listener.close({ cancel: true });
      }
    }
    this.closing ??= (async () => {
      const closingListeners = [...this.listeners].map((listener) => listener.close());
      for (const controller of this.waitControllers) {
        controller.abort();
      }
      const results = await Promise.allSettled(closingListeners);
      await Promise.all(this.waitJobs);
      await Promise.allSettled(this.observations);
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason as unknown);
      try {
        await this.call('close');
      } catch (error) {
        errors.push(error);
      }
      await this.exited;
      if (errors.length) {
        throw new AggregateError(errors, 'Messaging client cleanup failed');
      }
    })();
    return this.closing;
  }
}
