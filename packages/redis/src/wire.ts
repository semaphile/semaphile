// Own command/subscription connections and renewable owner validity. A failed
// transport is terminal: never replay an uncertain mutation or revive an owner.
import { createClient, ErrorReply } from '@redis/client';
import { InputError, CircuitOpenError, PoolDrainingError } from '@semaphile/core/client';
import { randomUUID } from 'node:crypto';
import { script } from './script.js';

export type WireReply = {
  recoveryDeadline?: string | null;
  circuit?: 'closed' | 'open' | 'half-open';
  refusal?: { name: string; message: string; generation?: string; notBefore?: string | null };
  now: string;
  ownerDeadline: string;
  value: unknown;
  deadline: string | null;
  admission: null | {
    leaseId: string;
    leaseGrantedAt: string;
    expiresAt: string | null;
    weight: string;
  };
};
export type TimedReply = { reply: WireReply; sent: number; received: number };
export const abortError = () =>
  Object.assign(new Error('Scheduled job aborted before starting'), { name: 'AbortError' });

export class Wire {
  readonly owner = randomUUID();
  readonly command;
  readonly subscriber;
  failure: Error | undefined;
  version = 0;
  ownerValidUntilMonotonic = Infinity;
  readonly stats = { commands: 0, renewals: 0, waits: 0, wakes: 0 };
  private readonly responseTimeoutMs: number;
  private readonly sockets = new AbortController();
  private sequence = 0;
  private readonly commands: Array<{
    action: string;
    input: object;
    resolve: (result: TimedReply) => void;
    reject: (error: unknown) => void;
  }> = [];
  private dispatching = false;
  private readonly wakes = new Set<() => void>();
  private renewalTimer: ReturnType<typeof setTimeout> | undefined;
  private ownerExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  private retiring = false;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(
    url: string,
    readonly key: string,
    readonly config: string,
    readonly ownerTimeoutMs: number,
    private readonly create = true,
  ) {
    const timeout = (this.responseTimeoutMs = Math.min(10000, Math.floor(ownerTimeoutMs / 3)));
    const options = {
      url,
      socket: {
        reconnectStrategy: false as const,
        connectTimeout: timeout,
        signal: this.sockets.signal,
      },
      disableOfflineQueue: true,
      commandOptions: { timeout },
    };
    this.command = createClient(options);
    this.subscriber = createClient(options);
    for (const connection of [this.command, this.subscriber]) {
      connection.on('error', (error) => {
        if (!this.closed) {
          this.fail(error);
        }
      });
      connection.on('end', () => {
        if (!this.closed) {
          this.fail(new Error('Redis connection ended'));
        }
      });
    }
  }

  async open(): Promise<void> {
    try {
      await this.bounded(
        'startup',
        (async () => {
          await Promise.all([this.command.connect(), this.subscriber.connect()]);
          await this.subscriber.subscribe(this.key + ':notify', () => this.notifyWaiters());
          this.acceptRenewal(await this.invoke('open', { create: this.create }));
        })(),
      );
    } catch (error) {
      this.fail(error);
      throw this.failure;
    }
  }

  // The driver's queue timeout ends at socket write. Bound response latency
  // ourselves, including startup handshakes and subscription acknowledgements.
  private async bounded<T>(stage: string, operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`Redis ${stage} timed out`);
            this.fail(error);
            reject(error);
          }, this.responseTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private notifyWaiters(): void {
    this.version++;
    for (const wake of this.wakes) {
      wake();
    }
  }
  fail(reason: unknown): void {
    if (this.failure) {
      return;
    }
    this.failure = reason instanceof Error ? reason : new Error(String(reason));
    this.destroy();
    this.notifyWaiters();
  }
  private destroy(): void {
    this.closed = true;
    clearTimeout(this.renewalTimer);
    clearTimeout(this.ownerExpiryTimer);
    // Cancel sockets still resolving/connecting, before the driver retains them.
    this.sockets.abort();
    for (const connection of [this.command, this.subscriber]) {
      if (connection.isOpen) {
        connection.destroy();
      }
    }
  }
  private acceptRenewal(result: TimedReply): void {
    if (this.failure || this.closed) {
      return;
    }
    // Starting at send time discounts the entire round trip; a delayed reply
    // cannot extend our local belief beyond the server's ownership deadline.
    this.ownerValidUntilMonotonic =
      result.sent + Number(result.reply.ownerDeadline) - Number(result.reply.now);
    if (performance.now() >= this.ownerValidUntilMonotonic) {
      this.fail(new Error('Redis ownership expired before reply'));
      return;
    }
    clearTimeout(this.renewalTimer);
    clearTimeout(this.ownerExpiryTimer);
    this.ownerExpiryTimer = setTimeout(
      () => this.fail(new Error('Redis ownership renewal deadline missed')),
      Math.max(0, this.ownerValidUntilMonotonic - performance.now()),
    );
    if (!this.retiring) {
      this.renewalTimer = setTimeout(
        () => {
          this.stats.renewals++;
          // A healthy command socket cannot prove that subscription hints arrive.
          // PING shares the subscription stream and is checked only at renewal.
          void Promise.all([
            this.invoke('renew'),
            this.bounded('subscription health check', this.subscriber.ping()),
          ])
            .then(([result]) => this.acceptRenewal(result))
            .catch((error) => this.fail(error));
        },
        Math.max(0, result.sent + Math.floor(this.ownerTimeoutMs / 3) - performance.now()),
      );
    }
  }

  invoke(action: string, input: object = {}): Promise<TimedReply> {
    // Assign sequences at dispatch, preserving ordinary command order while a
    // due renewal can run next instead of expiring behind a caller's backlog.
    return new Promise<TimedReply>((resolve, reject) => {
      const command = { action, input, resolve, reject };
      if (action === 'renew') {
        this.commands.unshift(command);
      } else {
        this.commands.push(command);
      }
      if (!this.dispatching) {
        this.dispatching = true;
        void this.dispatch();
      }
    });
  }
  private async dispatch(): Promise<void> {
    while (this.commands.length) {
      const command = this.commands.shift()!;
      try {
        command.resolve(await this.execute(command.action, command.input));
      } catch (error) {
        command.reject(error);
      }
    }
    this.dispatching = false;
  }
  private async execute(action: string, input: object): Promise<TimedReply> {
    if (this.failure) {
      throw this.failure;
    }
    if (performance.now() >= this.ownerValidUntilMonotonic) {
      this.fail(new Error('Redis ownership expired'));
      throw this.failure;
    }
    const sequence = this.sequence + 1;
    if (!Number.isSafeInteger(sequence)) {
      this.fail(new Error('Redis command sequence exhausted'));
      throw this.failure;
    }
    const sent = performance.now();
    this.stats.commands++;
    try {
      const raw = await this.bounded(
        'command',
        this.command.sendCommand<string>([
          'EVAL',
          script,
          '2',
          this.key,
          this.key + ':notify',
          action,
          this.owner,
          String(sequence),
          this.config,
          JSON.stringify(input),
        ]),
      );
      const reply = JSON.parse(raw) as WireReply;
      if (
        !Number.isSafeInteger(Number(reply.now)) ||
        !Number.isSafeInteger(Number(reply.ownerDeadline))
      ) {
        throw new TypeError('Invalid Redis timing reply');
      }
      this.sequence = sequence;
      if (reply.refusal) {
        if (reply.refusal.name === 'PoolDrainingError') {
          throw new PoolDrainingError(Number(reply.refusal.generation));
        }
        if (reply.refusal.name === 'CircuitOpenError') {
          throw new CircuitOpenError(
            reply.refusal.notBefore == null ? null : Number(reply.refusal.notBefore),
          );
        }
        throw new InputError(reply.refusal.message);
      }
      return { reply, sent, received: performance.now() };
    } catch (error) {
      if (
        error instanceof InputError ||
        error instanceof CircuitOpenError ||
        error instanceof PoolDrainingError
      ) {
        throw error;
      }
      if (error instanceof ErrorReply && /SEMAPHILE_INPUT\b/.test(error.message)) {
        throw new InputError(error.message);
      }
      this.fail(error);
      throw this.failure;
    }
  }

  wait(observed: number, deadline: number | undefined, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (observed !== this.version) {
      return Promise.resolve();
    }
    this.stats.waits++;
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const done = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.wakes.delete(wake);
        signal?.removeEventListener('abort', abort);
        this.stats.wakes++;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const wake = () => done(this.failure);
      const abort = () => done(abortError());
      this.wakes.add(wake);
      signal?.addEventListener('abort', abort, { once: true });
      if (deadline !== undefined) {
        timer = setTimeout(wake, Math.min(2147483647, Math.max(0, deadline - performance.now())));
      }
    });
  }
  close(): Promise<void> {
    this.retiring = true;
    clearTimeout(this.renewalTimer);
    this.closing ??= (async () => {
      try {
        await this.invoke('close');
      } finally {
        this.destroy();
      }
    })();
    return this.closing;
  }
}
