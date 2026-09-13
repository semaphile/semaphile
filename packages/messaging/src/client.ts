import { Worker } from 'node:worker_threads';
import { realpath, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MessageListener } from './listener.js';
import { MessagingError, normalize, integer } from './config.js';
import type {
  Handler,
  ListenerOptions,
  Agent,
  ClaimResult,
  Delivery,
  Difference,
  EventInput,
  EventRecord,
  EventHistoryOptions,
  HistoryOptions,
  MessageHistory,
  OpenOptions,
  Receipt,
  ReceiveOptions,
  SendOptions,
  SendResult,
  StoreConfig,
  WaitOptions,
} from './types.js';
export class MessagingClient {
  readonly config: Readonly<StoreConfig>;
  readonly differences: readonly Difference[];
  private sequence = 0;
  private closing?: Promise<void>;
  private failure?: Error;
  private readonly waitControllers = new Set<AbortController>();
  private readonly waitJobs = new Set<Promise<void>>();
  private readonly calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  private readonly listeners = new Set<{
    close: (options?: { cancel?: boolean }) => Promise<void>;
  }>();
  private readonly exited: Promise<number>;
  constructor(
    readonly path: string,
    private readonly worker: Worker,
    config: StoreConfig,
    differences: Difference[],
  ) {
    this.config = Object.freeze(config);
    this.differences = differences;
    const fail = (error: Error) => {
      this.failure = error;
      for (const call of this.calls.values()) {
        call.reject(error);
      }
      this.calls.clear();
    };
    worker.on('message', (reply: { id: number; value: unknown; error?: string; code?: string }) => {
      const call = this.calls.get(reply.id);
      if (!call) {
        return;
      }
      this.calls.delete(reply.id);
      if (reply.error) {
        call.reject(new MessagingError(reply.code ?? 'STORE', reply.error));
      } else {
        call.resolve(reply.value);
      }
    });
    worker.on('error', fail);
    this.exited = new Promise((resolveExit) =>
      worker.once('exit', (code) => {
        fail(new MessagingError('CLOSED', `Coordinator exited (${code})`));
        resolveExit(code);
      }),
    );
  }
  /** Private transport; callbacks always execute in the caller's runtime. */
  private call<T>(action: string, args: object = {}, signal?: AbortSignal): Promise<T> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (
      this.closing &&
      !['ack', 'release', 'renew', 'fail', 'close', 'history', 'events', 'agents'].includes(action)
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
  createMailbox(recipient: string): Promise<void> {
    return this.call('create', { recipient });
  }
  register(recipient: string, metadata?: string): Promise<Agent> {
    return this.call('register', { recipient, metadata });
  }
  unregister(ownerId: string): Promise<void> {
    return this.call('unregister', { ownerId });
  }
  agents(): Promise<Agent[]> {
    return this.call('agents');
  }
  send(message: SendOptions): Promise<SendResult> {
    return this.call('send', message);
  }
  receive(recipient: string, options: ReceiveOptions = {}): Promise<Delivery[]> {
    return this.call('receive', { recipient, options });
  }
  wait(recipient: string, options: WaitOptions = {}): Promise<Delivery | null> {
    const { signal, timeoutMs, ...receiveOptions } = options;
    if (timeoutMs !== undefined) {
      integer(timeoutMs, 'timeoutMs', 0);
    }
    const deadline =
      timeoutMs === undefined || timeoutMs === 0 ? undefined : Date.now() + timeoutMs;
    if (signal?.aborted) {
      return Promise.reject(new MessagingError('ABORTED', 'Wait cancelled'));
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.waitControllers.add(controller);
    const work = (async () => {
      try {
        const delivery = await this.call<Delivery | null>(
          'wait',
          { recipient, options: receiveOptions, timeoutMs, deadline },
          controller.signal,
        );
        if (controller.signal.aborted) {
          if (delivery) {
            await this.release(delivery.receipt);
          }
          throw new MessagingError('ABORTED', 'Wait cancelled');
        }
        return delivery;
      } finally {
        signal?.removeEventListener('abort', abort);
        this.waitControllers.delete(controller);
      }
    })();
    const cleanup = work.then(
      () => undefined,
      () => undefined,
    );
    this.waitJobs.add(cleanup);
    void cleanup.then(() => this.waitJobs.delete(cleanup));
    return work;
  }

  ack(receipt: Receipt): Promise<ClaimResult> {
    return this.call('ack', { receipt });
  }
  release(receipt: Receipt): Promise<ClaimResult> {
    return this.call('release', { receipt });
  }
  renew(receipt: Receipt, claimTtlMs?: number): Promise<ClaimResult> {
    return this.call('renew', { receipt, value: claimTtlMs });
  }
  fail(receipt: Receipt, error: unknown): Promise<ClaimResult> {
    return this.call('fail', { receipt, value: String(error) });
  }
  retry(deliveryId: string): Promise<void> {
    return this.call('retry', { deliveryId });
  }
  history(options: HistoryOptions = {}): Promise<MessageHistory[]> {
    return this.call('history', options);
  }
  events(options: EventHistoryOptions = {}): Promise<EventRecord[]> {
    return this.call('events', options);
  }
  append(event: EventInput): Promise<number> {
    return this.call('append', event);
  }
  listen(recipient: string, handler: Handler, options: ListenerOptions = {}): MessageListener {
    if (this.closing || this.failure) {
      throw new MessagingError('CLOSED', 'Client closing or closed');
    }
    return MessageListener.start(this, recipient, handler, options);
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
export async function openClient(options: OpenOptions, inspect = false): Promise<MessagingClient> {
  const config = normalize(options.config);
  if (options.configMismatch !== undefined && !['warn', 'error'].includes(options.configMismatch)) {
    throw new MessagingError('INPUT', 'Invalid configMismatch');
  }
  const path = resolve(options.path);
  if (!inspect) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const canonical = await realpath(path);
  const worker = new Worker(new URL('./coordinator.js', import.meta.url), {
    workerData: { path: canonical, config, configMismatch: options.configMismatch, inspect },
  });
  return new Promise((resolveClient, reject) => {
    const fail = (error: Error) => {
      worker.off('message', ready);
      reject(error);
    };
    const ready = (reply: {
      ready: boolean;
      config: StoreConfig;
      differences: Difference[];
      error?: string;
      code?: string;
    }) => {
      worker.off('error', fail);
      worker.off('message', ready);
      if (!reply.ready) {
        reject(new MessagingError(reply.code ?? 'STORE', reply.error ?? 'Startup failed'));
        return;
      }
      const client = new MessagingClient(canonical, worker, reply.config, reply.differences);
      if (reply.differences.length && !inspect) {
        try {
          if (options.onWarning) {
            options.onWarning(reply.differences);
          } else {
            process.emitWarning(
              `Messaging config differs; adopting persisted settings: ${JSON.stringify(reply.differences)}`,
              { code: 'SEMAPHILE_CONFIG_MISMATCH' },
            );
          }
        } catch (error) {
          void client.close().then(
            () => reject(error),
            (error_) =>
              reject(new AggregateError([error, error_], 'Warning callback and cleanup failed')),
          );
          return;
        }
      }
      resolveClient(client);
    };
    worker.once('error', fail);
    worker.once('message', ready);
  });
}
