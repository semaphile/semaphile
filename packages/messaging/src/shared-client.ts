import { MessageSubscription } from './subscription.js';
import type { SubscriptionInfo, SubscriptionOptions, PublishOptions } from './types.js';
import {
  MessageTelemetry,
  type MessageOperation,
  type MessageMetadata,
  type MessageTelemetryOptions,
} from './telemetry.js';
import { filterTrace, validateTrace } from './trace.js';
import { MessageListener } from './listener.js';
import { MessagingError, integer } from './config.js';
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
  Receipt,
  ReceiveOptions,
  SendOptions,
  SendResult,
  StoreConfig,
  WaitOptions,
} from './types.js';
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
export class MessagingClient {
  readonly config: Readonly<StoreConfig>;
  readonly differences: readonly Difference[];
  private sequence = 0;
  private readonly clocks = new WeakMap<object, { now: number; sent: number }>();
  private readonly telemetry: MessageTelemetry;
  private readonly observations = new Set<Promise<unknown>>();
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
    private readonly worker: MessagingTransport,
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
    worker.on('message', (reply: MessagingReply) => {
      const call = this.calls.get(reply.id);
      if (!call) {
        return;
      }
      this.calls.delete(reply.id);
      if (reply.error) {
        call.reject(new MessagingError(reply.code ?? 'STORE', reply.error));
      } else {
        if (reply.clock && reply.value && typeof reply.value === 'object') {
          for (const value of Array.isArray(reply.value) ? reply.value : [reply.value]) {
            if (value && typeof value === 'object') {
              this.clocks.set(value, reply.clock);
            }
          }
        }
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
  private call<T>(
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
  info(): Promise<unknown> {
    return this.call('info');
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
  private observe<T>(
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
  subscriptionCommand<T>(
    action:
      | 'subscribe'
      | 'subscription-get'
      | 'subscription-touch'
      | 'subscription-remove'
      | 'subscriptions',
    args: object = {},
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new MessagingError('ABORTED', 'Subscription operation cancelled'));
    }
    return this.call(action, args, signal);
  }
  async subscribe(name: string, options: SubscriptionOptions): Promise<MessageSubscription> {
    const info = await this.subscriptionCommand<SubscriptionInfo>('subscribe', {
      name,
      ...structuredClone(options),
    });
    return new MessageSubscription(this, info);
  }
  async subscription(name: string): Promise<MessageSubscription> {
    const info = await this.subscriptionCommand<SubscriptionInfo>('subscription-get', { name });
    if (info.state !== 'active') {
      throw new MessagingError('STALE', 'Subscription retired');
    }
    return new MessageSubscription(this, info);
  }
  subscriptions(): Promise<SubscriptionInfo[]> {
    return this.subscriptionCommand('subscriptions');
  }
  publish(message: PublishOptions): Promise<SendResult> {
    return this.sendEnvelope({ ...message, to: '*' }, 'publish');
  }
  send(message: SendOptions): Promise<SendResult> {
    return this.sendEnvelope(message, 'send');
  }
  private sendEnvelope(message: SendOptions, action: 'send' | 'publish'): Promise<SendResult> {
    try {
      message = structuredClone(message);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.observe(
      'send',
      (scope) => {
        const trace =
          message.trace === undefined
            ? scope.inject()
            : filterTrace(message.trace, this.telemetry.baggageAllowlist);
        return this.call(action, { ...message, trace }, undefined, true);
      },
      { correlationId: message.correlationId },
    );
  }
  receive(recipient: string, options: ReceiveOptions = {}): Promise<Delivery[]> {
    try {
      options = structuredClone(options);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.observe('receive', async (scope) => {
      const deliveries = await this.call<Delivery[]>(
        'receive',
        { recipient, options },
        undefined,
        true,
      );
      for (const delivery of deliveries) {
        this.filterDelivery(delivery);
      }
      scope.received(
        deliveries.map((delivery) => ({
          messageId: delivery.messageId,
          deliveryId: delivery.id,
          attempt: delivery.attempt,
          trace: delivery.trace,
          correlationId: delivery.message.correlationId,
        })),
      );
      return deliveries;
    });
  }
  private filterDelivery(delivery: Delivery): void {
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
  /** Observe one handler attempt, including its durable automatic settlement. */
  processDelivery<T>(delivery: Delivery, callback: () => Promise<T>): Promise<T> {
    return this.observe(
      'process',
      () => callback(),
      {
        messageId: delivery.messageId,
        deliveryId: delivery.id,
        correlationId: delivery.message.correlationId,
        attempt: delivery.attempt,
        trace: delivery.trace,
      },
      true,
    );
  }
  wait(recipient: string, options: WaitOptions = {}): Promise<Delivery | null> {
    if (this.closing || this.failure) {
      return Promise.reject(this.failure ?? new MessagingError('CLOSED', 'Client closing'));
    }
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
    const work = this.observe('wait', async (scope) => {
      try {
        const delivery = await this.call<Delivery | null>(
          'wait',
          { recipient, options: receiveOptions, timeoutMs, deadline },
          controller.signal,
          true,
        );
        if (controller.signal.aborted) {
          if (delivery) {
            await this.release(delivery.receipt);
          }
          throw new MessagingError('ABORTED', 'Wait cancelled');
        }
        if (delivery) {
          this.filterDelivery(delivery);
          scope.received([
            {
              messageId: delivery.messageId,
              deliveryId: delivery.id,
              correlationId: delivery.message.correlationId,
              trace: delivery.trace,
              attempt: delivery.attempt,
            },
          ]);
        }
        return delivery;
      } finally {
        signal?.removeEventListener('abort', abort);
        this.waitControllers.delete(controller);
      }
    });
    const cleanup = work.then(
      () => undefined,
      () => undefined,
    );
    this.waitJobs.add(cleanup);
    void cleanup.then(() => this.waitJobs.delete(cleanup));
    return work;
  }

  private settleClaim(
    action: 'ack' | 'release' | 'renew' | 'fail',
    receipt: Receipt,
    value?: number | string,
  ): Promise<ClaimResult> {
    // Trace is observational only. Pass just the two fencing identifiers to
    // the coordinator; hooks cannot mutate the claim or make it uncloneable.
    const claim = { deliveryId: receipt.deliveryId, claimId: receipt.claimId };
    let carrier: Receipt['trace'];
    let invalidTrace = false;
    try {
      carrier = validateTrace(receipt.trace);
    } catch {
      invalidTrace = true;
    }
    return this.observe(
      action,
      () => {
        if (invalidTrace) {
          this.telemetry.diagnostic('trace-dropped');
        }
        return this.call(action, { receipt: claim, value });
      },
      { deliveryId: claim.deliveryId, trace: carrier },
      true,
    );
  }
  ack(receipt: Receipt): Promise<ClaimResult> {
    return this.settleClaim('ack', receipt);
  }
  release(receipt: Receipt): Promise<ClaimResult> {
    return this.settleClaim('release', receipt);
  }
  renew(receipt: Receipt, claimTtlMs?: number): Promise<ClaimResult> {
    return this.settleClaim('renew', receipt, claimTtlMs);
  }
  fail(receipt: Receipt, error: unknown): Promise<ClaimResult> {
    return this.settleClaim('fail', receipt, String(error));
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
