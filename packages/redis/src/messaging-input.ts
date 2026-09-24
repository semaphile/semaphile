import { randomUUID } from 'node:crypto';
import { MessagingError, text, integer } from '@semaphile/messaging/client';
import type { Receipt } from '@semaphile/messaging/client';
export function claimInput(action: string, args: Record<string, unknown>): object {
  const receipt = args.receipt as Receipt;
  text(receipt?.deliveryId, 'deliveryId');
  text(receipt?.claimId, 'claimId');
  if (action === 'renew' && args.value !== undefined) {
    integer(args.value, 'claimTtlMs');
  }
  if (action === 'fail') {
    return { ...args, value: Buffer.from(String(args.value)).subarray(0, 4096).toString('utf8') };
  }
  return args;
}
export function appendInput(args: Record<string, unknown>): object {
  text(args.kind, 'kind');
  for (const field of ['agent', 'subject', 'topic']) {
    if (args[field] !== undefined) {
      text(args[field], field);
    }
  }
  if (args.payload !== undefined) {
    text(args.payload, 'payload', 16384);
  }
  return Object.fromEntries(
    ['kind', 'agent', 'subject', 'topic', 'payload']
      .filter((k) => args[k] !== undefined)
      .map((k) => [k, args[k]]),
  );
}
export function subscriptionInput(args: Record<string, unknown>): object {
  text(args.name, 'subscription name', 128);
  if (!Array.isArray(args.topics) || !args.topics.length) {
    throw new MessagingError('INPUT', 'topics must be nonempty');
  }
  const topics = [...new Set(args.topics.map((t) => text(t, 'topic')))].sort((a, b) =>
    a < b ? -1 : Number(a > b),
  );
  if (topics.length !== args.topics.length) {
    throw new MessagingError('INPUT', 'topics must be unique');
  }
  if (args.inactivityTtlMs !== undefined) {
    integer(args.inactivityTtlMs, 'inactivityTtlMs');
  }
  return { ...args, topics, id: randomUUID() };
}
