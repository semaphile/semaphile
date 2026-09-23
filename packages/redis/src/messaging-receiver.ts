import { randomUUID } from 'node:crypto';
import { MessagingError, name, mode, integer } from '@semaphile/messaging/client';
import type { StoreConfig, ReceiveOptions, Delivery } from '@semaphile/messaging/client';
import type { MessagingConnection, MessagingWireReply } from './messaging-connection.js';
type Args = Record<string, unknown>;
const aborted = () => new MessagingError('ABORTED', 'Wait cancelled');
export class MessagingReceiver {
  constructor(
    private readonly connection: MessagingConnection,
    private readonly config: StoreConfig,
    private readonly isClosing: () => boolean,
    private readonly sweep: (
      deadline: number,
      pressure: boolean,
      signal?: AbortSignal,
    ) => Promise<boolean>,
  ) {}

  receiveOptions(value: unknown): ReceiveOptions {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new MessagingError('INPUT', 'Invalid receive options');
    }
    const o = value as ReceiveOptions;
    const result: ReceiveOptions = {
      max: integer(o.max ?? 1, 'max', 1, 1000),
      claimTtlMs: integer(o.claimTtlMs ?? this.config.claimTtlMs, 'claimTtlMs'),
      maxHandlingMs: integer(o.maxHandlingMs ?? this.config.maxHandlingMs, 'maxHandlingMs'),
      ackMode: mode(o.ackMode ?? 'manual'),
    };
    const modes = o.acceptedAckModes ?? [result.ackMode!];
    if (!Array.isArray(modes) || !modes.length) {
      throw new MessagingError('INPUT', 'acceptedAckModes cannot be empty');
    }
    result.acceptedAckModes = modes.map(mode);
    return result;
  }
  async receive(
    recipient: string,
    options: ReceiveOptions,
    deadline: number,
    signal?: AbortSignal,
  ) {
    try {
      await this.sweep(deadline, false, signal);
    } catch (error) {
      // Cleanup never grants a delivery. Cancellation here is still definitive.
      if (signal?.aborted) {
        throw aborted();
      }
      if (!(error instanceof MessagingError) || error.code !== 'UNCERTAIN') {
        throw error;
      }
      // No claim was dispatched. Queue the first claim behind reconnection;
      // do not replay the uncertain cleanup command.
    }
    return this.connection.request<{ deliveries: Delivery[]; deadline: number | null }>(
      'receive',
      { recipient, options, claimId: randomUUID() },
      deadline,
      false,
      signal,
    );
  }
  private async waitReceive(
    recipient: string,
    options: ReceiveOptions,
    deadline: number,
    opDeadline: number | undefined,
    signal: AbortSignal,
    version: number,
  ) {
    let reply: MessagingWireReply<{ deliveries: Delivery[]; deadline: number | null }>;
    try {
      reply = await this.receive(
        recipient,
        options,
        opDeadline ?? performance.now() + this.connection.options.operationTimeoutMs,
        signal,
      );
    } catch (error) {
      if (error instanceof MessagingError && error.code === 'TIMEOUT' && opDeadline !== undefined) {
        if (performance.now() >= deadline) {
          return undefined;
        }
        // No mutation was dispatched. Block for a notification/reconnect or the
        // caller's deadline instead of turning operation timeouts into polling.
        await this.connection.wait(
          version,
          Number.isFinite(deadline) ? deadline : undefined,
          signal,
        );
        return null;
      }
      throw error;
    }

    return reply;
  }
  private async awaitChange(
    version: number,
    reply: MessagingWireReply<{ deliveries: Delivery[]; deadline: number | null }>,
    deadline: number,
    signal: AbortSignal,
  ): Promise<void> {
    const due =
      reply.value.deadline === null ? Infinity : reply.sent + reply.value.deadline - reply.now;
    await this.connection.wait(
      version,
      Number.isFinite(Math.min(deadline, due)) ? Math.min(deadline, due) : undefined,
      signal,
    );
  }
  async wait(args: Args, signal: AbortSignal): Promise<MessagingWireReply<Delivery | null>> {
    const recipient = name(args.recipient),
      options = this.receiveOptions(args.options ?? {});
    options.max = 1;
    const { timeout, deadline } = waitTiming(args);
    let first = true;
    for (;;) {
      if (signal.aborted || this.isClosing()) {
        throw aborted();
      }
      if (!first && performance.now() >= deadline) {
        return { value: null, now: 0, sent: 0, received: 0 };
      }
      first = false;
      const version = this.connection.version;
      const opDeadline =
        timeout === 0
          ? undefined
          : Math.min(deadline, performance.now() + this.connection.options.operationTimeoutMs);
      const reply = await this.waitReceive(
        recipient,
        options,
        deadline,
        opDeadline,
        signal,
        version,
      );
      if (reply === null) {
        continue;
      }
      if (!reply) {
        return { value: null, now: 0, sent: 0, received: 0 };
      }
      const delivery = reply.value.deliveries[0];
      // A raced grant is returned even when cancelled: shared-client releases it.
      if (delivery) {
        return { ...reply, value: delivery };
      }
      if (timeout === 0 || performance.now() >= deadline) {
        return { ...reply, value: null };
      }
      await this.awaitChange(version, reply, deadline, signal);
    }
  }
}

function waitTiming(args: Args) {
  const timeout =
    args.timeoutMs === undefined ? undefined : integer(args.timeoutMs, 'timeoutMs', 0);
  let deadline = Infinity;
  if (timeout !== undefined) {
    const remaining = timeout === 0 ? 0 : Math.max(0, Number(args.deadline) - Date.now());
    deadline = performance.now() + remaining;
  }
  return { timeout, deadline };
}
