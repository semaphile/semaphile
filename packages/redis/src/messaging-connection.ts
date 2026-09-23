// Recover socket subscriptions, never replay an already dispatched mutation.
import { createClient } from '@redis/client';
import { MessagingError } from '@semaphile/messaging/client';
import { readFileSync } from 'node:fs';
const script = ['messaging-records.lua', 'messaging-delivery.lua', 'messaging-actions.lua']
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');
type Connection = ReturnType<typeof createClient<{}, {}, {}, 2>>;
export interface MessagingWireOptions {
  url: string;
  key: string;
  operationTimeoutMs: number;
  maxPending: number;
  sessionTimeoutMs: number;
  readiness: 'warn' | 'strict';
  onWarning?: (issues: readonly string[]) => void;
}
export interface MessagingWireReply<T = unknown> {
  value: T;
  now: number;
  sent: number;
  received: number;
}
interface Job {
  action: string;
  input: object;
  deadline: number;
  priority: boolean;
  resolve: (value: MessagingWireReply) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  dispatched: boolean;
  detach?: () => void;
}
export class MessagingConnection {
  identity?: string;
  failure?: Error;
  version = 0;
  onFatal?: (error: Error) => void;
  private command?: Connection;
  private subscriber?: Connection;
  private recovering?: Promise<void>;
  private closing = false;
  private ready = false;
  private draining = false;
  private readonly jobs: Job[] = [];
  private readonly wakeups = new Set<() => void>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private cancelRetry?: () => void;
  private healthTimer?: ReturnType<typeof setTimeout>;
  private anchor?: { now: number; received: number };
  private readonly stop = new AbortController();
  constructor(
    readonly options: MessagingWireOptions,
    private openInput: object,
  ) {}
  /** The driver timeout ends at socket dispatch; this timer covers the reply too. */
  private response<T>(work: Promise<T>, deadline: number): Promise<T> {
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
          reject(error);
        },
      );
      if (this.stop.signal.aborted) {
        abort();
      }
    });
  }
  private publishWake(): void {
    this.version++;
    for (const wake of this.wakeups) {
      wake();
    }
  }
  private dispose(): void {
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
  private broken(): void {
    if (this.closing || this.failure) {
      return;
    }
    this.dispose();
    this.publishWake();
    if (this.identity) {
      void this.recover().catch(() => {});
    }
  }
  private fatal(error: Error): void {
    if (this.failure) {
      return;
    }
    this.failure = error;
    this.dispose();
    this.publishWake();
    this.onFatal?.(error);
  }
  async open(): Promise<MessagingWireReply<{ identity: string; config: unknown; format: string }>> {
    const deadline = performance.now() + this.options.operationTimeoutMs;
    try {
      await this.connectSockets(deadline);
      await this.readiness(deadline);
      const reply = await this.invoke('open', this.openInput, deadline);
      const value = reply.value as { identity: string; config: unknown; format: string };
      this.identity = value.identity;
      this.openInput = { ...this.openInput, config: value.config, configMismatch: 'error' };
      this.ready = true;
      this.publishWake();
      return { ...reply, value };
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  private async connectSockets(deadline: number): Promise<void> {
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
    const time = (await this.response(command.sendCommand(['TIME']), deadline)) as string[];
    this.anchor = {
      now: Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000),
      received: performance.now(),
    };
  }
  private async readiness(deadline: number): Promise<void> {
    const issues: string[] = [];
    try {
      const pairs = (await this.response(
        this.command!.sendCommand([
          'CONFIG',
          'GET',
          'appendonly',
          'appendfsync',
          'no-appendfsync-on-rewrite',
          'maxmemory-policy',
        ]),
        deadline,
      )) as string[];
      const config: Record<string, string> = {};
      for (let i = 0; i < pairs.length; i += 2) {
        config[pairs[i]] = pairs[i + 1];
      }
      if (config.appendonly !== 'yes') {
        issues.push('AOF persistence is not verified enabled');
      }
      if (config.appendfsync !== 'always') {
        issues.push('Synchronous AOF flushing is not verified');
      }
      if (config['no-appendfsync-on-rewrite'] !== 'no') {
        issues.push('AOF flushing during rewrite is not verified');
      }
      if (config['maxmemory-policy'] !== 'noeviction') {
        issues.push('noeviction is not verified');
      }
      const info = (await this.response(
        this.command!.sendCommand(['INFO', 'persistence']),
        deadline,
      )) as string;
      if (!/^aof_last_write_status:ok\r?$/m.test(info)) {
        issues.push('AOF health is not verified');
      }
    } catch {
      issues.push('Redis persistence and eviction settings could not be inspected');
    }
    if (!issues.length) {
      return;
    }
    if (this.options.readiness === 'strict') {
      throw new MessagingError('READINESS', issues.join('; '));
    }
    if (this.options.onWarning) {
      this.options.onWarning(issues);
    } else {
      process.emitWarning(issues.join('; '), { code: 'SEMAPHILE_REDIS_READINESS' });
    }
  }
  private async recover(): Promise<void> {
    if (this.ready || this.closing || this.failure) {
      return;
    }
    if (this.recovering) {
      return this.recovering;
    }
    const work = (async () => {
      let delay = 500;
      while (!this.closing && !this.failure && !this.ready) {
        try {
          const deadline = performance.now() + this.options.operationTimeoutMs;
          await this.connectSockets(deadline);
          const reply = await this.invoke(
            'open',
            { ...this.openInput, create: false, expectedIdentity: this.identity },
            deadline,
          );
          const value = reply.value as { identity: string };
          if (value.identity !== this.identity) {
            throw new MessagingError('STATE_LOST', 'Messaging store replaced');
          }
          this.ready = true;
          this.publishWake();
          this.scheduleHealth();
          return;
        } catch (error) {
          this.dispose();
          if (
            error instanceof MessagingError &&
            ['STATE_LOST', 'FORMAT', 'CONFIG_MISMATCH'].includes(error.code)
          ) {
            this.fatal(error);
            throw error;
          }
          if (this.closing) {
            return;
          }
          await new Promise<void>((resolve) => {
            this.cancelRetry = resolve;
            this.retryTimer = setTimeout(resolve, Math.ceil(delay * (0.8 + Math.random() * 0.4)));
          });
          this.cancelRetry = undefined;
          this.retryTimer = undefined;
          delay = Math.min(10000, delay * 2);
        }
      }
    })();
    this.recovering = work;
    try {
      await work;
    } finally {
      if (this.recovering === work) {
        this.recovering = undefined;
      }
    }
  }
  private async invoke(
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
    let raw: unknown;
    try {
      raw = await this.response(
        this.command.withCommandOptions({ timeout }).eval(script, {
          keys: [this.options.key],
          arguments: [JSON.stringify({ action, input, identity: this.identity, before })],
        }),
        deadline,
      );
    } catch {
      this.broken();
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
        throw new Error();
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
  request<T>(
    action: string,
    input: object,
    deadline = performance.now() + this.options.operationTimeoutMs,
    priority = false,
    signal?: AbortSignal,
  ): Promise<MessagingWireReply<T>> {
    if (this.failure || this.closing) {
      return Promise.reject(
        this.failure ?? new MessagingError('CLOSED', 'Messaging client closed'),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(new MessagingError('ABORTED', 'Operation cancelled before dispatch'));
    }
    if (this.jobs.length >= this.options.maxPending) {
      return Promise.reject(new MessagingError('QUEUE_FULL', 'Messaging operation queue full'));
    }
    return new Promise<MessagingWireReply>((resolve, reject) => {
      const job: Job = {
        action,
        input,
        deadline,
        priority,
        resolve,
        reject,
        dispatched: false,
        timer: setTimeout(
          () => {
            if (!job.dispatched) {
              const index = this.jobs.indexOf(job);
              if (index >= 0) {
                this.jobs.splice(index, 1);
              }
              job.detach?.();
              reject(new MessagingError('TIMEOUT', 'Messaging operation expired before dispatch'));
            }
          },
          Math.max(0, deadline - performance.now()),
        ),
      };
      const abort = () => {
        if (job.dispatched) {
          return;
        }
        const index = this.jobs.indexOf(job);
        if (index >= 0) {
          this.jobs.splice(index, 1);
        }
        clearTimeout(job.timer);
        job.detach?.();
        reject(new MessagingError('ABORTED', 'Operation cancelled before dispatch'));
      };
      job.detach = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      this.jobs.push(job);
      void this.drain();
    }) as Promise<MessagingWireReply<T>>;
  }
  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.jobs.length && !this.closing) {
        if (!this.ready) {
          await this.recover();
        }
        if (this.failure) {
          throw this.failure;
        }
        if (this.closing || !this.jobs.length) {
          break;
        }
        const urgent = this.jobs.findIndex((job) => job.priority);
        const job = this.jobs.splice(urgent < 0 ? 0 : urgent, 1)[0];
        clearTimeout(job.timer);
        job.detach?.();
        if (job.deadline <= performance.now()) {
          job.reject(new MessagingError('TIMEOUT', 'Messaging operation expired before dispatch'));
          continue;
        }
        job.dispatched = true;
        try {
          job.resolve(await this.invoke(job.action, job.input, job.deadline));
        } catch (error) {
          job.reject(error);
        }
      }
    } catch (error) {
      for (const job of this.jobs.splice(0)) {
        clearTimeout(job.timer);
        job.detach?.();
        job.reject(error);
      }
    } finally {
      this.draining = false;
    }
  }
  wait(version: number, deadline: number | undefined, signal: AbortSignal): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (signal.aborted || this.closing) {
      return Promise.reject(new MessagingError('ABORTED', 'Wait cancelled'));
    }
    if (version !== this.version) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) {
          clearTimeout(timer);
        }
        this.wakeups.delete(wake);
        signal.removeEventListener('abort', abort);
      };
      const wake = () => {
        finish();
        resolve();
      };
      const abort = () => {
        finish();
        reject(new MessagingError('ABORTED', 'Wait cancelled'));
      };
      this.wakeups.add(wake);
      signal.addEventListener('abort', abort, { once: true });
      if (deadline !== undefined) {
        timer = setTimeout(wake, Math.max(0, deadline - performance.now()));
      }
      this.scheduleHealth();
      if (version !== this.version) {
        wake();
      }
    });
  }
  private scheduleHealth(): void {
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
  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.stop.abort();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.cancelRetry?.();
    this.dispose();
    for (const job of this.jobs.splice(0)) {
      clearTimeout(job.timer);
      job.detach?.();
      job.reject(new MessagingError('CLOSED', 'Messaging client closed'));
    }
    this.publishWake();
    await this.recovering?.catch(() => {});
  }
}
