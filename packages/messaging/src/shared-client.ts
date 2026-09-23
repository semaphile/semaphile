import { MessagingClientTransport } from './shared-transport.js';
export type { MessagingCommand, MessagingReply, MessagingTransport } from './shared-transport.js';
import { MessageSubscription } from './subscription.js';
import { MessageListener } from './listener.js';
import { filterTrace, validateTrace } from './trace.js';
import { MessagingError, integer } from './config.js';
import type {
  SubscriptionInfo,
  SubscriptionOptions,
  PublishOptions,
  Handler,
  ListenerOptions,
  Agent,
  ClaimResult,
  Delivery,
  EventInput,
  EventRecord,
  EventHistoryOptions,
  HistoryOptions,
  MessageHistory,
  Receipt,
  ReceiveOptions,
  SendOptions,
  SendResult,
  WaitOptions,
} from './types.js';
export class MessagingClient extends MessagingClientTransport {
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
}
