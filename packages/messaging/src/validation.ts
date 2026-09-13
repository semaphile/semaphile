import { integer, MessagingError, mode, text } from './config.js';
import type { ListenerOptions, HistoryOptions, EventHistoryOptions } from './types.js';
export function record(value: unknown, label: string, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MessagingError('INPUT', `${label} must be an object`);
  }
  const result = value as Record<string, unknown>;
  if (keys) {
    for (const key of Object.keys(result)) {
      if (!keys.includes(key)) {
        throw new MessagingError('INPUT', `Unknown ${label} field: ${key}`);
      }
    }
  }
  return result;
}
export function listenerDefaults(value: unknown): Omit<ListenerOptions, 'signal' | 'onError'> {
  const input = record(value, 'listenerDefaults', [
    'concurrency',
    'claimTtlMs',
    'maxHandlingMs',
    'ackMode',
    'acceptedAckModes',
  ]);
  for (const key of ['concurrency', 'claimTtlMs', 'maxHandlingMs']) {
    if (input[key] !== undefined) {
      integer(input[key], key, 1, key === 'concurrency' ? 1000 : 2_147_483_647);
    }
  }
  if (input.ackMode !== undefined) {
    mode(input.ackMode);
  }
  if (input.acceptedAckModes !== undefined) {
    if (!Array.isArray(input.acceptedAckModes) || !input.acceptedAckModes.length) {
      throw new MessagingError('INPUT', 'acceptedAckModes must be a nonempty array');
    }
    input.acceptedAckModes.forEach(mode);
  }
  return input as Omit<ListenerOptions, 'signal' | 'onError'>;
}
export function historyOptions(input: HistoryOptions | EventHistoryOptions, events = false): void {
  const value = record(
    input,
    'history options',
    events
      ? ['after', 'limit', 'topic', 'since']
      : ['after', 'limit', 'topic', 'since', 'recipient', 'sender', 'correlationId'],
  );
  for (const key of ['after', 'since']) {
    if (value[key] !== undefined) {
      integer(value[key], key, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  if (value.limit !== undefined) {
    integer(value.limit, 'limit', 1, 1000);
  }
  for (const key of ['topic', 'recipient', 'sender', 'correlationId']) {
    if (value[key] !== undefined) {
      text(value[key], key);
    }
  }
}
