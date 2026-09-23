import { appendInput, subscriptionInput, claimInput } from './messaging-input.js';
// Adapt atomic Redis operations to the shared listener/telemetry lifecycle.
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  MessagingError,
  validateEnvelope,
  validateTrace,
  historyOptions,
  name,
  text,
} from '@semaphile/messaging/client';
import type {
  MessagingCommand,
  StoreConfig,
  SendOptions,
  ClaimResult,
} from '@semaphile/messaging/client';
import type { MessagingConnection, MessagingWireReply } from './messaging-connection.js';
import { MessagingReceiver } from './messaging-receiver.js';
type Args = Record<string, unknown>;
export class RedisMessagingTransport extends EventEmitter {
  private readonly receiver: MessagingReceiver;
  private readonly controllers = new Map<number, AbortController>();
  private readonly pending = new Set<Promise<void>>();
  private readonly owners = new Set<string>();
  private readonly owner = randomUUID();
  private presenceTimer?: ReturnType<typeof setTimeout>;
  private closing = false;
  constructor(
    private readonly connection: MessagingConnection,
    private readonly config: StoreConfig,
  ) {
    super();
    this.receiver = new MessagingReceiver(
      connection,
      config,
      () => this.closing,
      (deadline, pressure, signal) => this.sweep(deadline, pressure, signal),
    );
    // Keep the transport alive for close cleanup after a terminal store failure.
    connection.onFatal = () => {};
  }
  postMessage(command: MessagingCommand): void {
    command = structuredClone(command);
    if (command.action === 'abort') {
      this.controllers.get((command.args as { target: number }).target)?.abort();
      return;
    }
    const controller = new AbortController();
    this.controllers.set(command.id, controller);
    const work = this.dispatch(command, controller.signal);
    if (command.action !== 'close') {
      this.pending.add(work);
    }
    void work.finally(() => {
      this.pending.delete(work);
      this.controllers.delete(command.id);
    });
  }
  private async dispatch(command: MessagingCommand, signal: AbortSignal): Promise<void> {
    const { id, action } = command;
    try {
      if (this.closing) {
        throw new MessagingError('CLOSED', 'Messaging client closing');
      }
      const reply =
        action === 'close'
          ? await this.close()
          : await this.execute(action, command.args as Args, signal);
      this.emit('message', {
        id,
        value: reply?.value,
        clock: reply && { now: reply.now, sent: reply.sent },
      });
    } catch (error) {
      this.emit('message', {
        id,
        error: error instanceof MessagingError ? error.message : 'Messaging operation failed',
        code: error instanceof MessagingError ? error.code : 'STORE',
      });
    } finally {
      if (action === 'close') {
        this.emit('exit', 0);
      }
    }
  }
  private async sweep(deadline: number, pressure = false, signal?: AbortSignal): Promise<boolean> {
    const r = await this.connection.request<{ progress: boolean }>(
      'sweep',
      { pressure },
      deadline,
      false,
      signal,
    );
    return r.value.progress;
  }
  private async admit(
    action: string,
    input: object,
    deadline: number,
  ): Promise<MessagingWireReply> {
    await this.sweep(deadline);
    for (;;) {
      try {
        return await this.connection.request(action, input, deadline);
      } catch (error) {
        if (
          !(error instanceof MessagingError) ||
          error.code !== 'REFUSED' ||
          !['maxMessages reached', 'maxContentBytes reached', 'Recipient full'].includes(
            error.message,
          ) ||
          !(await this.sweep(deadline, error.message !== 'Recipient full'))
        ) {
          throw error;
        }
      }
    }
  }
  private async execute(
    action: string,
    args: Args,
    signal: AbortSignal,
  ): Promise<MessagingWireReply> {
    if (action === 'wait') {
      return this.receiver.wait(args, signal);
    }
    const deadline = Math.min(
      performance.now() + this.connection.options.operationTimeoutMs,
      action === 'subscription-touch' && typeof args.deadline === 'number'
        ? performance.now() + Math.max(0, args.deadline - Date.now())
        : Infinity,
    );
    let input: object = args;
    if (['create', 'register', 'receive'].includes(action)) {
      name(args.recipient);
    }
    switch (action) {
      case 'send':
      case 'publish': {
        const envelope = validateEnvelope(this.config, args as unknown as SendOptions);
        const trace = validateTrace((args as unknown as SendOptions).trace);
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([action, envelope]))
          .digest('hex');
        input = { id: randomUUID(), envelope, trace, fingerprint };
        return this.admit(action, input, deadline);
      }
      case 'receive': {
        const reply = await this.receiver.receive(
          name(args.recipient),
          this.receiver.receiveOptions(args.options ?? {}),
          deadline,
        );
        return { ...reply, value: reply.value.deliveries };
      }
      case 'register': {
        if (args.metadata !== undefined) {
          text(args.metadata, 'metadata', 16384);
        }
        const id = randomUUID();
        const reply = await this.admit(
          'register',
          {
            ...args,
            id,
            owner: this.owner,
            pid: process.pid,
            host: hostname(),
            ttl: this.connection.options.sessionTimeoutMs,
          },
          deadline,
        );
        this.owners.add(id);
        this.schedulePresence();
        return reply;
      }
      case 'unregister':
        text(args.ownerId, 'ownerId');
        this.owners.delete(String(args.ownerId));
        input = { ...args, owner: this.owner };
        break;
      case 'ack':
      case 'release':
      case 'renew':
      case 'fail':
        return this.connection.request<ClaimResult>(
          action,
          claimInput(action, args),
          deadline,
          true,
        );
      case 'retry':
        text(args.deliveryId, 'deliveryId');
        break;
      case 'history':
      case 'events':
        historyOptions(args, action === 'events');
        await this.sweep(deadline);
        break;
      case 'append':
        input = appendInput(args);
        break;
      case 'agents':
        await this.sweep(deadline);
        break;
      case 'subscribe':
        input = subscriptionInput(args);
        break;
      case 'subscription-get':
      case 'subscription-touch':
      case 'subscription-remove':
        text(args.name, 'subscription name', 128);
        if (args.id !== undefined) {
          text(args.id, 'generation');
        }
        break;
      case 'subscriptions':
      case 'info':
      case 'create':
        break;
      default:
        throw new MessagingError('INPUT', 'Unknown messaging action');
    }
    if (['create', 'subscribe'].includes(action)) {
      return this.admit(action, input, deadline);
    }
    return this.connection.request(
      action,
      input,
      deadline,
      action === 'subscription-touch',
      signal,
    );
  }
  private schedulePresence(): void {
    if (this.presenceTimer || !this.owners.size || this.closing) {
      return;
    }
    this.presenceTimer = setTimeout(
      () => {
        this.presenceTimer = undefined;
        const deadline = performance.now() + this.connection.options.sessionTimeoutMs / 3;
        void this.connection
          .request<string[]>(
            'presence-renew',
            {
              ids: [...this.owners],
              owner: this.owner,
              ttl: this.connection.options.sessionTimeoutMs,
            },
            deadline,
            true,
          )
          .then(
            (reply) => {
              const confirmed = new Set(reply.value);
              for (const id of this.owners) {
                if (!confirmed.has(id)) {
                  this.owners.delete(id);
                }
              }
            },
            () => {},
          )
          .finally(() => this.schedulePresence());
      },
      Math.max(1, Math.floor(this.connection.options.sessionTimeoutMs / 3)),
    );
  }
  private async close(): Promise<undefined> {
    this.closing = true;
    if (this.presenceTimer) {
      clearTimeout(this.presenceTimer);
    }
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    await Promise.all(this.pending);
    try {
      await Promise.all(
        [...this.owners].map((ownerId) =>
          this.connection.request('unregister', { ownerId, owner: this.owner }),
        ),
      );
    } finally {
      await this.connection.close();
    }
    return undefined;
  }
}
