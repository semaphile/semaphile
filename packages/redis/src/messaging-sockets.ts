import { createClient, ErrorReply } from '@redis/client';
import { MessagingError } from '@semaphile/messaging/client';
import { readFileSync } from 'node:fs';
const script = ['messaging-records.lua', 'messaging-delivery.lua', 'messaging-actions.lua']
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');
import type {
  Connection,
  Job,
  MessagingWireOptions,
  MessagingWireReply,
} from './messaging-wire-types.js';
import { checkReadiness } from './messaging-readiness.js';
export abstract class MessagingSockets {
  protected abstract broken(): void;
  protected abstract fatal(error: Error): void;
  protected abstract publishWake(): void;

  identity?: string;
  failure?: Error;
  version = 0;
  onFatal?: (error: Error) => void;
  protected command?: Connection;
  protected subscriber?: Connection;
  protected recovering?: Promise<void>;
  protected closing = false;
  protected ready = false;
  protected draining = false;
  protected readonly jobs: Job[] = [];
  protected readonly wakeups = new Set<() => void>();
  protected retryTimer?: ReturnType<typeof setTimeout>;
  protected cancelRetry?: () => void;
  protected healthTimer?: ReturnType<typeof setTimeout>;
  protected anchor?: { now: number; received: number };
  protected readonly stop = new AbortController();
  constructor(
    readonly options: MessagingWireOptions,
    protected openInput: object,
  ) {}
  /** The driver timeout ends at socket dispatch; this timer covers the reply too. */
  protected response<T>(work: Promise<T>, deadline: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.stop.signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        finish();
        reject(new MessagingError('CLOSED', 'Messaging client closed'));
      };
      const timer = setTimeout(
        () => {
          finish();
          reject(new MessagingError('UNAVAILABLE', 'Redis response deadline exceeded'));
        },
        Math.max(0, deadline - performance.now()),
      );
      this.stop.signal.addEventListener('abort', abort, { once: true });
      work.then(
        (value) => {
          finish();
          resolve(value);
        },
        (error) => {
          finish();
          reject(
            error instanceof ErrorReply &&
              /^(NOPERM|NOAUTH|WRONGPASS)\b|^ERR ACL failure in script:|user executing the script can't run this command/.test(
                error.message,
              )
              ? new MessagingError('ACCESS', error.message)
              : error,
          );
        },
      );
      if (this.stop.signal.aborted) {
        abort();
      }
    });
  }
  protected dispose(): void {
    this.ready = false;
    for (const client of [this.command, this.subscriber]) {
      if (client?.isOpen) {
        client.destroy();
      }
    }
    this.command = this.subscriber = undefined;
    if (this.healthTimer) {
      clearTimeout(this.healthTimer);
    }
    this.healthTimer = undefined;
  }
  protected async connectSockets(deadline: number): Promise<void> {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    const opts = {
      url: this.options.url,
      RESP: 2 as const,
      socket: {
        reconnectStrategy: false as const,
        connectTimeout: remaining,
        signal: this.stop.signal,
      },
      disableOfflineQueue: true,
      commandOptions: { timeout: Math.min(remaining, this.options.operationTimeoutMs) },
    };
    const command = createClient(opts),
      subscriber = createClient(opts);
    this.command = command;
    this.subscriber = subscriber;
    for (const client of [command, subscriber]) {
      client.on('error', () => {
        if (this.ready && this.command === command) {
          this.broken();
        }
      });
      client.on('end', () => {
        if (this.ready && this.command === command) {
          this.broken();
        }
      });
    }
    await this.response(Promise.all([command.connect(), subscriber.connect()]), deadline);
    if (this.closing) {
      throw new MessagingError('CLOSED', 'Messaging client closed');
    }
    await this.response(
      subscriber.subscribe(this.options.key + ':notify', () => this.publishWake()),
      deadline,
    );
    const time = await this.response(command.sendCommand(['TIME']), deadline);
    if (!Array.isArray(time) || time.length !== 2) {
      throw new Error('Invalid Redis time reply');
    }
    this.anchor = {
      now: Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000),
      received: performance.now(),
    };
  }
  protected async invoke(
    action: string,
    input: object,
    deadline: number,
  ): Promise<MessagingWireReply> {
    if (!this.command) {
      throw new MessagingError('UNAVAILABLE', 'Redis is disconnected');
    }
    const sent = performance.now();
    const timeout = Math.ceil(deadline - sent);
    if (timeout <= 0) {
      throw new MessagingError('TIMEOUT', 'Messaging operation deadline exceeded');
    }
    const before = this.anchor
      ? Math.floor(this.anchor.now + deadline - this.anchor.received)
      : undefined;
    const client = this.command;
    let raw: unknown;
    try {
      raw = await this.response(
        client.withCommandOptions({ timeout }).eval(script, {
          keys: [this.options.key],
          arguments: [JSON.stringify({ action, input, identity: this.identity, before })],
        }),
        deadline,
      );
    } catch (error) {
      // A permission refusal is a definitive server reply, not a lost result.
      if (error instanceof MessagingError && error.code === 'ACCESS') {
        throw error;
      }
      if (this.command === client) {
        this.broken();
      }
      throw new MessagingError(
        'UNCERTAIN',
        'Redis operation was dispatched but its outcome is unknown',
      );
    }
    const received = performance.now();
    let reply: { ok: boolean; value: unknown; now: number; code?: string; message?: string };
    try {
      reply = JSON.parse(String(raw)) as typeof reply;
      if (typeof reply.ok !== 'boolean' || (reply.ok && !Number.isSafeInteger(reply.now))) {
        throw new Error('Invalid messaging reply shape');
      }
    } catch {
      const error = new MessagingError('STATE_LOST', 'Invalid messaging protocol response');
      this.fatal(error);
      throw error;
    }
    if (!reply.ok) {
      const error = new MessagingError(
        reply.code ?? 'STORE',
        reply.message ?? 'Messaging operation failed',
      );
      if (['STATE_LOST', 'FORMAT'].includes(error.code)) {
        this.fatal(error);
      }
      throw error;
    }
    this.anchor = { now: reply.now, received };
    return { value: reply.value, now: reply.now, sent, received };
  }
  protected scheduleHealth(): void {
    if (this.healthTimer || !this.ready || this.closing || !this.wakeups.size) {
      return;
    }
    this.healthTimer = setTimeout(
      () => {
        this.healthTimer = undefined;
        if (!this.ready || !this.wakeups.size) {
          return;
        }
        void this.response(
          this.subscriber!.ping(),
          performance.now() +
            Math.min(this.options.operationTimeoutMs, this.options.sessionTimeoutMs / 3),
        ).then(
          () => this.scheduleHealth(),
          () => this.broken(),
        );
      },
      Math.max(1, Math.floor(this.options.sessionTimeoutMs / 3)),
    );
  }
  protected readiness(deadline: number): Promise<void> {
    return checkReadiness(
      this.command!,
      this.options,
      (work, due) => this.response(work, due),
      deadline,
    );
  }
}
