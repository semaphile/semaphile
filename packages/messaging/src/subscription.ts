import { MessagingError, integer } from './config.js';
import type { MessagingClient } from './shared-client.js';
import type {
  SubscriptionInfo,
  ReceiveOptions,
  WaitOptions,
  Handler,
  ListenerOptions,
} from './types.js';
/** A generation-fenced view of a durable subscription; close never deletes its queue. */
export class MessageSubscription {
  private readonly stopped = new AbortController();
  private confirmed?: SubscriptionInfo;
  constructor(
    private readonly client: MessagingClient,
    readonly info: Readonly<SubscriptionInfo>,
  ) {
    Object.freeze(info.topics);
    Object.freeze(info);
  }
  private active(external?: AbortSignal, deadline?: number) {
    const controller = new AbortController();
    const signal = AbortSignal.any([
      this.stopped.signal,
      controller.signal,
      ...(external ? [external] : []),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const finish = () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (watchdog) {
        clearTimeout(watchdog);
      }
    };
    const schedule = (value: SubscriptionInfo) => {
      if (closed || signal.aborted || !value.inactivityTtlMs) {
        return;
      }
      const remaining = this.client.remaining(value, value.expiresAt!);
      if (remaining <= 0) {
        controller.abort(new MessagingError('STALE', 'Subscription inactivity expired'));
        return;
      }
      if (watchdog) {
        clearTimeout(watchdog);
      }
      watchdog = setTimeout(
        () => controller.abort(new MessagingError('STALE', 'Subscription inactivity expired')),
        remaining,
      );
      timer = setTimeout(
        () => {
          void this.touch(signal, deadline).then(schedule, (error) => {
            if (transportInterrupted(error)) {
              schedule(value);
            } else {
              controller.abort(error);
            }
          });
        },
        Math.max(1, Math.min(Math.floor(value.inactivityTtlMs / 3), remaining)),
      );
    };
    signal.addEventListener('abort', finish, { once: true });
    const ready = this.touch(signal, deadline).then(
      (value) => {
        if (!closed) {
          schedule(value);
        }
      },
      (error) => {
        const known = this.confirmed ?? this.info;
        if (
          transportInterrupted(error) &&
          (!known.inactivityTtlMs || this.client.remaining(known, known.expiresAt!) > 0)
        ) {
          schedule(known);
          return;
        }
        // An expired snapshot cannot prove retirement: another worker may have
        // renewed it. Preserve the transport failure until the server confirms.
        controller.abort(error);
        throw error;
      },
    );
    void ready.catch(() => {});
    return {
      signal,
      ready,
      finish: () => {
        finish();
        signal.removeEventListener('abort', finish);
        controller.abort();
      },
    };
  }
  private touch(signal?: AbortSignal, deadline?: number): Promise<SubscriptionInfo> {
    return this.client
      .subscriptionCommand<SubscriptionInfo>(
        'subscription-touch',
        { name: this.info.name, id: this.info.id, deadline },
        signal,
      )
      .then((value) => {
        this.confirmed = value;
        return value;
      });
  }
  async receive(options: ReceiveOptions = {}) {
    if (this.stopped.signal.aborted) {
      throw new MessagingError('CLOSED', 'Subscription handle closed');
    }
    await this.touch(this.stopped.signal);
    return this.client.receive(this.info.recipient, options);
  }
  async wait(options: WaitOptions = {}) {
    if (options.timeoutMs !== undefined) {
      integer(options.timeoutMs, 'timeoutMs', 0);
    }
    if (options.signal?.aborted || this.stopped.signal.aborted) {
      throw new MessagingError('ABORTED', 'Wait cancelled');
    }
    const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : undefined;
    const active = this.active(options.signal, deadline);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        abort = () =>
          reject(
            active.signal.reason instanceof MessagingError
              ? active.signal.reason
              : new MessagingError('ABORTED', 'Wait cancelled'),
          );
        active.signal.addEventListener('abort', abort, { once: true });
        if (deadline !== undefined) {
          timer = setTimeout(
            () => reject(new MessagingError('TIMEOUT', 'Subscription wait expired')),
            Math.max(0, deadline - Date.now()),
          );
        }
        active.ready.then(resolve, reject);
        if (active.signal.aborted) {
          abort();
        }
      });
      if (timer) {
        clearTimeout(timer);
      }
      if (abort) {
        active.signal.removeEventListener('abort', abort);
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        return null;
      }
      return await this.client.wait(this.info.recipient, {
        ...options,
        timeoutMs: deadline === undefined ? options.timeoutMs : Math.max(1, deadline - Date.now()),
        signal: active.signal,
      });
    } catch (error) {
      if (
        error instanceof MessagingError &&
        error.code === 'TIMEOUT' &&
        deadline !== undefined &&
        Date.now() >= deadline
      ) {
        return null;
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (abort) {
        active.signal.removeEventListener('abort', abort);
      }
      active.finish();
    }
  }
  listen(handler: Handler, options: ListenerOptions = {}) {
    if (this.stopped.signal.aborted) {
      throw new MessagingError('CLOSED', 'Subscription handle closed');
    }
    if (typeof handler !== 'function') {
      throw new MessagingError('INPUT', 'handler must be a function');
    }
    const active = this.active(options.signal);
    try {
      const listener = this.client.listen(
        this.info.recipient,
        async (delivery, context) => {
          await active.ready;
          return handler(delivery, context);
        },
        { ...options, signal: active.signal },
      );
      void listener.done.finally(active.finish).catch(() => {});
      return listener;
    } catch (error) {
      active.finish();
      throw error;
    }
  }
  async remove(): Promise<void> {
    await this.client.subscriptionCommand('subscription-remove', {
      name: this.info.name,
      id: this.info.id,
    });
    this.close();
  }
  close(): void {
    this.stopped.abort();
  }
}

function transportInterrupted(error: unknown): boolean {
  return (
    error instanceof MessagingError &&
    ['UNCERTAIN', 'UNAVAILABLE', 'TIMEOUT', 'QUEUE_FULL'].includes(error.code)
  );
}
