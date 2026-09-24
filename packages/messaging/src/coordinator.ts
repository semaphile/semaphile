import { expireSubscriptions, subscriptionDeadline, topicCommand } from './topics.js';
import { parentPort, workerData } from 'node:worker_threads';
import { Database, FORMAT } from './database.js';
import { Presence } from './presence.js';
import { normalize, MessagingError, integer } from './config.js';
import { send } from './send.js';
import { receive, nextDeadline, claim, retry } from './delivery.js';
import { event, events, history, validateEvent } from './storage.js';
import type { NativeSubscription } from './native.js';
import type { EventInput, HistoryOptions, Receipt, ReceiveOptions, SendOptions } from './types.js';
interface Command {
  id: number;
  action: string;
  args: Record<string, unknown>;
}
const controllers = new Map<number, AbortController>();
const pending = new Set<Promise<void>>();
let store: Database,
  presence: Presence,
  closing = false;
const aborted = () => new MessagingError('ABORTED', 'Wait cancelled');
async function kernelWait(
  subscription: NativeSubscription,
  deadline: number | undefined,
  signal: AbortSignal,
): Promise<void> {
  const cancel = () => subscription.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = deadline === undefined ? null : Math.max(0, Math.ceil(deadline - Date.now()));
      subscription.start(timeout, (error) => (error ? reject(error) : resolve()));
    });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
async function wait(
  id: number,
  recipient: string,
  options: ReceiveOptions,
  timeoutMs?: number,
  deadline?: number,
) {
  if (timeoutMs !== undefined) {
    integer(timeoutMs, 'timeoutMs', 0);
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  const callerDeadline = deadline ?? (timeoutMs === undefined ? undefined : Date.now() + timeoutMs);
  try {
    for (;;) {
      if (controller.signal.aborted || closing) {
        throw aborted();
      }
      let subscription: NativeSubscription | undefined;
      try {
        const result = store.locked(() => {
          expireSubscriptions(store);
          presence.require(recipient);
          // Positive timeouts include RPC and gate delay. Zero means one check.
          if (timeoutMs !== 0 && callerDeadline !== undefined && Date.now() >= callerDeadline) {
            return { delivery: null, deadline: callerDeadline };
          }
          subscription = store.native.subscribe(store.notifyPath(recipient));
          const deliveries = receive(store, recipient, { ...options, max: 1 });
          const computed = nextDeadline(store, recipient);
          return {
            delivery: deliveries[0] ?? null,
            deadline: Math.min(
              computed ?? Infinity,
              callerDeadline ?? Infinity,
              subscriptionDeadline(store, recipient) ?? Infinity,
            ),
          };
        });
        if (result.delivery) {
          return result.delivery;
        }
        if (callerDeadline !== undefined && Date.now() >= callerDeadline) {
          return null;
        }
        await kernelWait(
          subscription!,
          Number.isFinite(result.deadline) ? result.deadline : undefined,
          controller.signal,
        );
      } finally {
        // Rust close cancels and joins before destroying its owned resources.
        subscription?.close();
      }
    }
  } finally {
    controllers.delete(id);
  }
}
function execute(action: string, args: Record<string, unknown>): unknown {
  const recipient = typeof args.recipient === 'string' ? args.recipient : '';
  expireSubscriptions(store);
  if (action === 'subscribe' || action === 'subscriptions' || action.startsWith('subscription-')) {
    return topicCommand(store, action, args);
  }
  switch (action) {
    case 'create':
      return presence.create(recipient);
    case 'register':
      return presence.register(recipient, args.metadata as string | undefined);
    case 'unregister':
      return presence.unregister(String(args.ownerId));
    case 'agents':
      return presence.agents();
    case 'send':
      return send(store, presence, args as unknown as SendOptions);
    case 'receive':
      presence.require(recipient);
      return receive(store, recipient, args.options as ReceiveOptions);
    case 'ack':
    case 'release':
    case 'renew':
    case 'fail':
      return claim(
        store,
        action,
        args.receipt as Receipt,
        args.value as number | string | undefined,
      );
    case 'retry':
      return retry(store, String(args.deliveryId));
    case 'history':
      return history(store, args as HistoryOptions);
    case 'events':
      return events(store, args as HistoryOptions);
    case 'append':
      return store.mutate(
        [],
        () => event(store, validateEvent(args as unknown as EventInput)),
        (id) => {
          if (!store.db.prepare('SELECT 1 FROM events WHERE seq=?').get(id)) {
            throw new MessagingError('REFUSED', 'Event cannot fit within maxContentBytes');
          }
        },
      );
    case 'info':
      return {
        format: FORMAT,
        config: store.config,
        differences: store.differences,
        agents: presence.agents(),
      };
    default:
      throw new MessagingError('INPUT', `Unknown action: ${action}`);
  }
}
// Each retry follows measured cleanup progress, with the gate released between batches.
async function sendWithCleanup(
  args: Record<string, unknown>,
  publication = false,
): Promise<unknown> {
  for (;;) {
    if (closing) {
      throw new MessagingError('CLOSED', 'Client closed');
    }
    try {
      return store.locked(() => {
        expireSubscriptions(store);
        return send(store, presence, args as unknown as SendOptions, publication);
      });
    } catch (error) {
      if (!(error instanceof MessagingError) || error.code !== 'CLEANUP_PROGRESS') {
        throw error;
      }
      // Every repeat follows actual cleanup progress. Yield with the gate
      // released so acknowledgments and renewals can interleave batches.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
async function dispatch(command: Command): Promise<void> {
  const { id, action, args } = command;
  if (action === 'abort') {
    controllers.get(Number(args.target))?.abort();
    return;
  }
  try {
    if (closing) {
      throw new MessagingError('CLOSED', 'Client closed');
    }
    let value: unknown;
    if (action === 'close') {
      closing = true;
      for (const controller of controllers.values()) {
        controller.abort();
      }
      await Promise.all(pending);
      try {
        store.locked(() => presence.close());
      } finally {
        store.close();
      }
    } else if (action === 'send' || action === 'publish') {
      value = await sendWithCleanup(args, action === 'publish');
    } else if (action === 'wait') {
      value = await wait(
        id,
        String(args.recipient),
        args.options as ReceiveOptions,
        args.timeoutMs as number | undefined,
        args.deadline as number | undefined,
      );
    } else {
      value = store.locked(() => execute(action, args));
    }
    parentPort!.postMessage({ id, value });
    if (action === 'close') {
      parentPort!.close();
    }
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: String(error),
      code: error instanceof MessagingError ? error.code : 'STORE',
    });
    if (action === 'close') {
      parentPort!.close();
    }
  }
}
try {
  store = new Database(
    workerData.path,
    normalize(workerData.config),
    workerData.configMismatch ?? 'warn',
    workerData.inspect ?? false,
  );
  presence = new Presence(store);
  parentPort!.on('message', (command: Command) => {
    const work = dispatch(command);
    if (command.action !== 'close' && command.action !== 'abort') {
      pending.add(work);
      void work.finally(() => pending.delete(work));
    }
  });
  parentPort!.postMessage({ ready: true, config: store.config, differences: store.differences });
} catch (error) {
  parentPort!.postMessage({
    ready: false,
    error: String(error),
    code: error instanceof MessagingError ? error.code : 'STORE',
  });
  parentPort!.close();
}
