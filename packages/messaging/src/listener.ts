import { markMessageFailure, markMessageCancelled } from './telemetry.js';
import { listenerDefaults } from './validation.js';
import { MessagingError, integer, mode } from './config.js';
import type { MessagingClient } from './shared-client.js';
import type { Delivery, Handler, ListenerOptions, ClaimResult } from './types.js';
/** Owns local handlers, not the durable queue. Closing never drains a mailbox. */
export class MessageListener {
  private completion!: Promise<void>;
  get done(): Promise<void> {
    return this.completion;
  }
  private readonly waiting = new AbortController();
  private readonly active = new Set<AbortController>();
  private stopping = false;
  private cancellationRequested = false;
  private closing?: Promise<void>;
  private readonly options: ListenerOptions;
  private constructor(
    private readonly client: MessagingClient,
    private readonly recipient: string,
    private readonly handler: Handler,
    options: ListenerOptions = {},
  ) {
    if (typeof handler !== 'function') {
      throw new MessagingError('INPUT', 'handler must be a function');
    }
    const { signal: _signal, onError: _onError, ...localDefaults } = options;
    listenerDefaults(localDefaults);
    integer(options.concurrency ?? 1, 'concurrency', 1, 1000);
    integer(options.claimTtlMs ?? client.config.claimTtlMs, 'claimTtlMs');
    integer(options.maxHandlingMs ?? client.config.maxHandlingMs, 'maxHandlingMs');
    mode(options.ackMode ?? 'handler-success');
    options.acceptedAckModes?.forEach(mode);
    this.options = { ...options, ackMode: options.ackMode ?? 'handler-success' };
  }
  static start(
    client: MessagingClient,
    recipient: string,
    handler: Handler,
    options: ListenerOptions = {},
  ): MessageListener {
    const listener = new MessageListener(client, recipient, handler, options);
    listener.startSlots();
    return listener;
  }
  private startSlots(): void {
    const options = this.options;
    const concurrency = options.concurrency ?? 1;
    const abort = () => {
      void this.close({ cancel: true }).catch((error) => this.report(error));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    this.client.track(this);
    const slots = Array.from({ length: concurrency }, () => this.slot());
    this.completion = Promise.allSettled(slots)
      .then((results) => {
        const errors = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason as unknown);
        if (errors.length) {
          throw new AggregateError(errors, 'Listener failed');
        }
      })
      .finally(() => {
        options.signal?.removeEventListener('abort', abort);
        this.client.untrack(this);
      });
    // A caller may observe done later; terminal failures are also reported now.
    void this.done.catch((error) => this.report(error));
    if (options.signal?.aborted) {
      abort();
    }
  }
  private report(error: unknown, delivery?: Delivery): void {
    try {
      if (this.options.onError) {
        this.options.onError(error, delivery);
      } else {
        process.emitWarning(String(error), { code: 'SEMAPHILE_HANDLER' });
      }
    } catch (reportError) {
      process.emitWarning(String(reportError), { code: 'SEMAPHILE_ERROR_HANDLER' });
    }
  }
  private async slot(): Promise<void> {
    try {
      while (!this.stopping) {
        const {
          signal: _signal,
          onError: _onError,
          concurrency: _concurrency,
          ...options
        } = this.options;
        const delivery = await this.client.wait(this.recipient, {
          ...options,
          signal: this.waiting.signal,
        });
        if (!delivery) {
          continue;
        }
        if (this.stopping) {
          await this.client.release(delivery.receipt);
          break;
        }
        await this.client.processDelivery(delivery, () => this.handle(delivery));
      }
    } catch (error) {
      if (this.stopping && error instanceof MessagingError && error.code === 'ABORTED') {
        return;
      }
      this.stopping = true;
      this.waiting.abort();
      for (const controller of this.active) {
        controller.abort(error);
      }
      throw error;
    }
  }
  private async handle(delivery: Delivery): Promise<void> {
    // A processing-start hook can cancel the listener before a handler has a
    // controller. Preserve that cancellation and release the undispatched claim.
    if (this.cancellationRequested) {
      markMessageCancelled();
      await this.client.release(delivery.receipt);
      return;
    }
    if (this.client.remaining(delivery, delivery.claimExpiresAt) <= 0) {
      markMessageFailure();
      this.report(new MessagingError('STALE', 'Claim expired before handler dispatch'), delivery);
      return;
    }
    const controller = new AbortController();
    this.active.add(controller);
    const ttl = this.options.claimTtlMs ?? this.client.config.claimTtlMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let renewal: Promise<void> = Promise.resolve();
    let finished = false,
      settled = false,
      lost = false;
    let expiresAt = delivery.claimExpiresAt;
    let expirySource: Delivery | ClaimResult = delivery;
    const lose = (error: unknown) => {
      if (lost || settled) {
        return;
      }
      lost = true;
      markMessageFailure();
      if (timer) {
        clearTimeout(timer);
      }
      controller.abort(error);
      this.report(error, delivery);
    };
    const schedule = () => {
      if (finished || settled || lost) {
        return;
      }
      const remaining = this.client.remaining(expirySource, expiresAt);
      if (remaining <= 0) {
        lose(new MessagingError('STALE', 'Handler claim expired'));
        return;
      }
      if (watchdog) {
        clearTimeout(watchdog);
      }
      watchdog = setTimeout(
        () => lose(new MessagingError('STALE', 'Claim deadline reached while handler active')),
        remaining,
      );
      timer = setTimeout(
        () => {
          renewal = (async () => {
            try {
              if (finished || settled || lost) {
                return;
              }
              if (this.client.remaining(delivery, delivery.handlingExpiresAt) <= 0) {
                lose(new MessagingError('STALE', 'Maximum handling duration reached'));
                return;
              }
              const result = await this.client.renew(delivery.receipt, ttl);
              if (settled || finished || lost) {
                return;
              }
              if (result.status === 'acked') {
                settled = true;
                if (watchdog) {
                  clearTimeout(watchdog);
                }
                return;
              }
              if (result.status !== 'renewed') {
                lose(new MessagingError('STALE', 'Claim replaced or expired'));
                return;
              }
              expiresAt = result.expiresAt!;
              expirySource = result;
              schedule();
            } catch (error) {
              if (
                error instanceof MessagingError &&
                ['UNCERTAIN', 'UNAVAILABLE', 'TIMEOUT', 'QUEUE_FULL'].includes(error.code)
              ) {
                // Transport loss cannot extend or shorten confirmed ownership.
                // Retry renewal on its computed timer; the original watchdog stays authoritative.
                schedule();
              } else {
                lose(error);
              }
            }
          })();
        },
        Math.max(1, Math.min(Math.floor(ttl / 3), remaining)),
      );
    };
    const settle = async (action: 'ack' | 'release'): Promise<ClaimResult> => {
      const result = await this.client[action](delivery.receipt);
      if (result.status !== 'stale') {
        settled = true;
        if (watchdog) {
          clearTimeout(watchdog);
        }
        if (timer) {
          clearTimeout(timer);
        }
      }
      return result;
    };
    schedule();
    let failure: unknown,
      failed = false;
    try {
      if (lost) {
        return;
      }
      await this.handler(delivery, {
        signal: controller.signal,
        ack: () => settle('ack'),
        release: () => settle('release'),
      });
    } catch (error) {
      failed = true;
      markMessageFailure();
      failure = error;
    } finally {
      if (controller.signal.aborted && !lost) {
        markMessageCancelled();
      }
      finished = true;
      if (watchdog) {
        clearTimeout(watchdog);
      }
      if (timer) {
        clearTimeout(timer);
      }
      await renewal;
      this.active.delete(controller);
    }
    if (failed) {
      this.report(failure, delivery);
      if (!settled && !lost) {
        await this.client.fail(delivery.receipt, failure);
      }
    } else if (!settled && !lost && delivery.ackMode === 'handler-success') {
      const result = await this.client.ack(delivery.receipt);
      if (result.status === 'stale') {
        markMessageFailure();
        this.report(new MessagingError('STALE', 'Handler completed after claim loss'), delivery);
      }
    }
  }
  close(options: { cancel?: boolean } = {}): Promise<void> {
    if (options.cancel) {
      this.cancellationRequested = true;
      for (const controller of this.active) {
        controller.abort();
      }
    }
    if (!this.closing) {
      this.stopping = true;
      this.waiting.abort();
      this.closing = this.done;
    }
    return this.closing;
  }
}
