// Pool-wide acceptance and drain accounting. These records identify work; they
// never contain executable callbacks or payloads, and cannot replay abandoned work.
export type MaintenanceOperation = {
  owner: string;
  generation: number;
  attempted: boolean;
  activeAttempts: number;
  attemptGeneration: number;
};
export type UnconfirmedOperation = {
  owner: string;
  acknowledged: boolean;
  reason: string | null;
};
export type MaintenanceState = {
  generation: number;
  operationSequence: number;
  mode: 'active' | 'draining';
  operations: Record<string, MaintenanceOperation>;
  unconfirmed: Record<string, UnconfirmedOperation>;
};
export type OperationToken = Readonly<{ id: string; generation: number }>;
export type DrainStatus = {
  generation: number;
  mode: MaintenanceState['mode'];
  pending: number;
  unconfirmed: number;
  acknowledged: number;
  clean: boolean;
  settled: boolean;
};

export class PoolDrainingError extends Error {
  constructor(readonly generation: number) {
    super(`Pool is draining (generation ${generation})`);
    this.name = 'PoolDrainingError';
  }
}

function identifier(value: string): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 256 ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  ) {
    throw new TypeError('Invalid maintenance identifier');
  }
}
function current(state: MaintenanceState, generation: number): void {
  if (state.mode !== 'draining' || state.generation !== generation) {
    throw new Error('Stale maintenance generation');
  }
}
function operation(
  state: MaintenanceState,
  owner: string,
  token: OperationToken,
): MaintenanceOperation | undefined {
  const ticket = Object.hasOwn(state.operations, token.id) ? state.operations[token.id] : undefined;
  if (!ticket || ticket.generation !== token.generation) {
    return undefined;
  }
  if (ticket.owner !== owner) {
    throw new Error('Operation is missing or belongs to another owner');
  }
  return ticket;
}

export function initialMaintenanceState(): MaintenanceState {
  return { generation: 0, operationSequence: 0, mode: 'active', operations: {}, unconfirmed: {} };
}

/** This commit, not the caller's local invocation time, is the acceptance point. */
export function acceptOperation(
  state: MaintenanceState,
  owner: string,
  id: string,
): OperationToken {
  identifier(owner);
  identifier(id);
  if (state.mode !== 'active') {
    throw new PoolDrainingError(state.generation);
  }
  if (Object.hasOwn(state.operations, id) || Object.hasOwn(state.unconfirmed, id)) {
    throw new Error('Operation id already used');
  }
  if (state.operationSequence >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Operation generation overflow');
  }
  // Sequence survives deletion so delayed reports cannot target a reused id.
  const generation = ++state.operationSequence;
  state.operations[id] = {
    owner,
    generation,
    attempted: false,
    activeAttempts: 0,
    attemptGeneration: 0,
  };
  return { id, generation };
}

/** A pre-drain ticket permits subsequent attempts while the pool drains. */
export function startOperationAttempt(
  state: MaintenanceState,
  owner: string,
  token: OperationToken,
): number {
  const ticket = operation(state, owner, token);
  if (!ticket) {
    throw new Error('Operation is missing or stale');
  }
  if (ticket.activeAttempts !== 0) {
    throw new Error('Operation already has an active attempt');
  }
  if (ticket.attemptGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Attempt generation overflow');
  }
  ticket.attempted = true;
  ticket.activeAttempts = 1;
  return ++ticket.attemptGeneration;
}

/** Only actual completion/cancellation acknowledgement ends an attempt. */
export function endOperationAttempt(
  state: MaintenanceState,
  owner: string,
  token: OperationToken,
  generation: number,
): boolean {
  const ticket = operation(state, owner, token);
  if (!ticket || ticket.activeAttempts === 0 || ticket.attemptGeneration !== generation) {
    return false;
  }
  ticket.activeAttempts = 0;
  return true;
}

export function finishOperation(
  state: MaintenanceState,
  owner: string,
  token: OperationToken,
): boolean {
  const ticket = operation(state, owner, token);
  if (!ticket) {
    return false;
  }
  if (ticket.activeAttempts !== 0) {
    throw new Error('Cannot finish an active operation');
  }
  delete state.operations[token.id];
  return true;
}

/** Reclaim leases separately. A missing callback acknowledgement is not success. */
export function abandonOwner(state: MaintenanceState, owner: string): void {
  identifier(owner);
  for (const [id, ticket] of Object.entries(state.operations)) {
    if (ticket.owner !== owner) {
      continue;
    }
    if (ticket.activeAttempts !== 0) {
      state.unconfirmed[id] = { owner, acknowledged: false, reason: null };
    }
    // A queued operation with no active attempt has no in-flight remote effect.
    delete state.operations[id];
  }
}

export function beginDrain(state: MaintenanceState): DrainStatus {
  if (state.mode === 'active') {
    if (state.generation >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Maintenance generation overflow');
    }
    state.generation++;
    state.mode = 'draining';
  }
  return drainStatus(state);
}

export function drainStatus(state: MaintenanceState): DrainStatus {
  const pending = Object.keys(state.operations).length;
  const uncertain = Object.values(state.unconfirmed);
  const unconfirmed = uncertain.filter((entry) => !entry.acknowledged).length;
  const acknowledged = uncertain.length - unconfirmed;
  return {
    generation: state.generation,
    mode: state.mode,
    pending,
    unconfirmed,
    acknowledged,
    clean: state.mode === 'draining' && pending === 0 && uncertain.length === 0,
    settled: state.mode === 'draining' && pending === 0 && unconfirmed === 0,
  };
}

export function acknowledgeUnconfirmed(
  state: MaintenanceState,
  generation: number,
  ids: string[],
  reason: string,
): DrainStatus {
  current(state, generation);
  if (!ids.length || typeof reason !== 'string' || !reason.trim() || reason.length > 4096) {
    throw new TypeError('Acknowledgement requires operation ids and a reason');
  }
  for (const id of ids) {
    if (!Object.hasOwn(state.unconfirmed, id)) {
      throw new Error('Unknown unconfirmed operation');
    }
  }
  for (const id of ids) {
    state.unconfirmed[id].acknowledged = true;
    state.unconfirmed[id].reason = reason;
  }
  return drainStatus(state);
}

/** Explicitly cancels maintenance or reopens a drained pool; changes no policy. */
export function resumePool(state: MaintenanceState, generation: number): void {
  current(state, generation);
  state.mode = 'active';
}
