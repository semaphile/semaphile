import { normalizeRecovery, recoveryConfig, type RecoveryConfig } from './recovery-policy.js';

export type PoolConfig = {
  maxConcurrent: number | null;
  expirationMs?: number | null;
  minTime?: number;
  reservoir?: number | null;
  reservoirRefreshAmount?: number | null;
  reservoirRefreshInterval?: number | null;
  recovery?: RecoveryConfig;
};

export class InputError extends RangeError {}

export function normalizeExpiration(value: number | null): number | null {
  if (value !== null) {
    integer(value, 'expirationMs', 1, 2_147_483_647);
  }
  return value;
}

function integer(value: number, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new InputError(`Invalid ${name}`);
  }
}

export function validateWeight(weight: number, maxConcurrent: number | null) {
  integer(weight, 'weight', 1);
  if (maxConcurrent !== null && weight > maxConcurrent) {
    throw new InputError('Weight exceeds maxConcurrent');
  }
}

export function normalize(config: PoolConfig) {
  if (
    Object.keys(config).some(
      (key) =>
        ![
          'maxConcurrent',
          'expirationMs',
          'minTime',
          'reservoir',
          'reservoirRefreshAmount',
          'reservoirRefreshInterval',
          'recovery',
        ].includes(key),
    )
  ) {
    throw new Error('Unknown pool config field');
  }
  if (config.maxConcurrent !== null) {
    integer(config.maxConcurrent, 'maxConcurrent', 1);
  }
  const expirationMs = normalizeExpiration(config.expirationMs ?? null);
  const { minTime = 0 } = config;
  integer(minTime, 'minTime', 0, 2_147_483_647);
  const reservoir = config.reservoir ?? null;
  const reservoirRefreshAmount = config.reservoirRefreshAmount ?? null;
  const reservoirRefreshInterval = config.reservoirRefreshInterval ?? null;
  if (reservoir !== null) {
    integer(reservoir, 'reservoir');
  }
  if (reservoirRefreshAmount !== null) {
    integer(reservoirRefreshAmount, 'reservoirRefreshAmount');
  }
  if (reservoirRefreshInterval !== null) {
    integer(reservoirRefreshInterval, 'reservoirRefreshInterval', 1, 2_147_483_647);
  }
  if ((reservoirRefreshAmount === null) !== (reservoirRefreshInterval === null)) {
    throw new RangeError('Reservoir refresh amount and interval must be configured together');
  }
  return {
    maxConcurrent: config.maxConcurrent,
    expirationMs,
    minTime,
    reservoir,
    reservoirRefreshAmount,
    reservoirRefreshInterval,
    recovery: recoveryConfig(normalizeRecovery(config.recovery)),
  };
}
