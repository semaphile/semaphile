// Redis stores mutable integers as decimal strings to avoid cjson rounding.
// Decode fields by schema name, preserving arbitrary IDs and acknowledgement text.
import type { ControlSnapshot, ControlResult } from '@semaphile/core/client';
const numericFields = new Set([
  'generation',
  'operationSequence',
  'activeAttempts',
  'attemptGeneration',
  'cooldownEpoch',
  'cooldownStep',
  'cooldownUntil',
  'breakerEpoch',
  'failures',
  'pauseStep',
  'openUntil',
  'expiresAt',
  'at',
  'total',
  'pending',
  'unconfirmed',
  'acknowledged',
  'notBefore',
  'revision',
]);
export function decodeControl(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(decodeControl);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === 'string' && numericFields.has(key) ? Number(item) : decodeControl(item),
    ]),
  );
}
export function controlSnapshot(value: unknown, fingerprint: string): ControlSnapshot {
  const snapshot = decodeControl(value) as Omit<ControlSnapshot, 'fingerprint'>;
  // cjson represents an empty Lua array as {}. No payload data is transformed.
  snapshot.recovery.samples = Object.values(snapshot.recovery.samples);
  return { ...snapshot, fingerprint };
}

export function controlResult(value: unknown, fingerprint: string): ControlResult {
  const result = decodeControl(value) as Omit<ControlResult, 'fingerprint'>;
  return 'recovery' in result ? controlSnapshot(value, fingerprint) : { ...result, fingerprint };
}
