// Recover subscriptions without replaying dispatched mutations.
import { MessagingError } from '@semaphile/messaging/client';
import { MessagingSockets } from './messaging-sockets.js';
import type { Job, MessagingWireReply } from './messaging-wire-types.js';
export type { MessagingWireOptions, MessagingWireReply } from './messaging-wire-types.js';
export class MessagingConnection extends MessagingSockets {
  protected publishWake(): void {
    this.version++;
    for (const wake of this.wakeups) {
      wake();
    }
  }
  protected broken(): void {
    if (this.closing || this.failure) {
      return;
    }
    this.dispose();
    this.publishWake();
    if (this.identity) {
      void this.recover().catch(() => {});
    }
  }
  protected fatal(error: Error): void {
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
        const job = this.jobs.splice(Math.max(0, urgent), 1)[0];
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
      this.rejectQueued(error);
    } finally {
      this.draining = false;
    }
  }
  private rejectQueued(error: unknown): void {
    for (const job of this.jobs.splice(0)) {
      clearTimeout(job.timer);
      job.detach?.();
      job.reject(error);
    }
  }
  waitAfterTimeout(version: number, deadline: number | undefined, signal: AbortSignal) {
    // A queued job can expire just after recovery. Ready sockets can admit a
    // fresh operation; waiting for another notification would miss retained work.
    return this.ready ? Promise.resolve() : this.wait(version, deadline, signal);
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
