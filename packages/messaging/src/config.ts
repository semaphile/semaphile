import type { AckMode, Difference, StoreConfig } from './types.js';
export const defaults: Readonly<StoreConfig> = Object.freeze({
  claimTtlMs: 300_000,
  maxHandlingMs: 3_600_000,
  maxAttempts: 5,
  retryDelayMs: 1000,
  retainHistoryMs: 604_800_000,
  dedupeRetentionMs: 604_800_000,
  maxBodyBytes: 1_048_576,
  maxPendingPerRecipient: 1000,
  maxMessages: 10_000,
  maxEvents: 100_000,
  maxContentBytes: 134_217_728,
});
export class MessagingError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}
export function refusal(message: string): never {
  throw new MessagingError('REFUSED', message);
}
export function integer(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 2_147_483_647,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new MessagingError('INPUT', `${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
export function text(value: unknown, field: string, max = 256): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    Buffer.byteLength(value) > max ||
    value.includes('\0')
  ) {
    throw new MessagingError(
      'INPUT',
      `${field} must be nonempty UTF-8 text of at most ${max} bytes without NUL`,
    );
  }
  return value;
}
export function name(value: unknown): string {
  const result = text(value, 'mailbox name', 128);
  if (result === '*') {
    refusal('* is reserved for broadcasts');
  }
  return result;
}
export function mode(value: unknown): AckMode {
  if (value !== 'manual' && value !== 'handler-success') {
    throw new MessagingError('INPUT', 'Invalid acknowledgment mode');
  }
  return value;
}
export function normalize(input: Partial<StoreConfig> = {}): StoreConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MessagingError('INPUT', 'config must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(defaults, key)) {
      throw new MessagingError('INPUT', `Unknown setting: ${key}`);
    }
  }
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof StoreConfig)[]) {
    if (input[key] !== undefined) {
      result[key] = integer(input[key], key);
    }
  }
  return result;
}
export function differences(expected: StoreConfig, actual: StoreConfig): Difference[] {
  return (Object.keys(expected) as (keyof StoreConfig)[])
    .filter((k) => expected[k] !== actual[k])
    .map((field) => ({ field, expected: expected[field], actual: actual[field] }));
}
