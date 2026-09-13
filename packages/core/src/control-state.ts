// Shared control records outlive expiring concurrency leases. Backends apply
// these transitions inside the same atomic boundary as admission and release.
import {
  initialRecoveryState,
  recoveryAdmission,
  admitRecoveryAttempt,
  completeRecoveryAttempt,
  type Outcome,
  type RecoveryState,
} from './recovery-state.js';
import {
  initialMaintenanceState,
  acceptOperation,
  startOperationAttempt,
  endOperationAttempt,
  finishOperation,
  abandonOwner,
  beginDrain,
  drainStatus,
  acknowledgeUnconfirmed,
  resumePool,
  PoolDrainingError,
  type MaintenanceState,
  type OperationToken,
} from './maintenance-state.js';
import type { RecoveryPolicy } from './recovery-policy.js';
import { InputError } from './config.js';

export type AttemptOptions = {
  operation?: OperationToken;
  circuit?: 'wait' | 'fail-fast';
  autoFinish?: boolean;
};
type Binding = {
  owner: string;
  operation?: OperationToken;
  generation?: number;
  autoFinish?: boolean;
};
export type ControlState = {
  recovery: RecoveryState;
  maintenance: MaintenanceState;
  bindings: Record<string, Binding>;
};
export type ControlCommand =
  | { action: 'status' }
  | { action: 'drain' }
  | { action: 'resume'; generation: number }
  | { action: 'acknowledge'; generation: number; ids: string[]; reason: string };
export type ControlSnapshot = {
  fingerprint: string;
  recovery: Omit<RecoveryState, 'attempts'>;
  maintenance: ReturnType<typeof drainStatus>;
  operations: MaintenanceState['operations'];
  unconfirmed: MaintenanceState['unconfirmed'];
};
// Mutation receipts stay bounded so Redis can return the exact prior result
// for a duplicate sequence without retaining a full operation ledger per owner.
export type ControlReceipt = Pick<ControlSnapshot, 'fingerprint' | 'maintenance'>;
export type ControlResult<C extends ControlCommand = ControlCommand> = C extends {
  action: 'status';
}
  ? ControlSnapshot
  : ControlReceipt;
export function controlResult<C extends ControlCommand>(
  state: ControlState,
  fingerprint: string,
  command: C,
): ControlResult<C> {
  return (
    command.action === 'status'
      ? controlSnapshot(state, fingerprint)
      : { fingerprint, maintenance: drainStatus(state.maintenance) }
  ) as ControlResult<C>;
}
export class CircuitOpenError extends Error {
  constructor(readonly notBefore: number | null) {
    super('Pool circuit is open');
    this.name = 'CircuitOpenError';
  }
}
export function initialControlState(): ControlState {
  return { recovery: initialRecoveryState(), maintenance: initialMaintenanceState(), bindings: {} };
}
export function acceptControlOperation(
  state: ControlState,
  owner: string,
  id: string,
): OperationToken {
  return requestTransition(() => acceptOperation(state.maintenance, owner, id));
}
export function finishControlOperation(
  state: ControlState,
  owner: string,
  token: OperationToken,
): boolean {
  return requestTransition(() => finishOperation(state.maintenance, owner, token));
}
// Validation failures from these pure rules are local to the request. Storage
// and OS exceptions occur outside this wrapper and remain backend failures.
function requestTransition<T>(transition: () => T): T {
  try {
    return transition();
  } catch (error) {
    if (error instanceof PoolDrainingError || error instanceof InputError) {
      throw error;
    }
    throw new InputError(error instanceof Error ? error.message : String(error));
  }
}
export function controlEligibility(
  state: ControlState,
  policy: RecoveryPolicy,
  owner: string,
  options: AttemptOptions,
  now: number,
) {
  if (options.operation) {
    const { id, generation } = options.operation;
    const ticket = Object.hasOwn(state.maintenance.operations, id)
      ? state.maintenance.operations[id]
      : undefined;
    if (
      !ticket ||
      ticket.owner !== owner ||
      ticket.generation !== generation ||
      ticket.activeAttempts !== 0
    ) {
      throw new InputError('Operation is missing, stale or already active');
    }
  } else if (state.maintenance.mode === 'draining') {
    throw new PoolDrainingError(state.maintenance.generation);
  }
  if (options.circuit !== undefined && !['wait', 'fail-fast'].includes(options.circuit)) {
    throw new InputError('Invalid circuit admission behavior');
  }
  const admission = recoveryAdmission(state.recovery, policy, now);
  if (options.circuit === 'fail-fast' && admission.circuit !== 'closed') {
    throw new CircuitOpenError(admission.notBefore);
  }
  return admission;
}
export function startControlAttempt(
  state: ControlState,
  policy: RecoveryPolicy,
  owner: string,
  lease: string,
  options: AttemptOptions,
  now: number,
): void {
  if (!controlEligibility(state, policy, owner, options, now).allowed) {
    throw new Error('Recovery admission is unavailable');
  }
  if (Object.hasOwn(state.bindings, lease)) {
    throw new Error('Attempt identity already used');
  }
  const generation = options.operation
    ? startOperationAttempt(state.maintenance, owner, options.operation)
    : undefined;
  if (!admitRecoveryAttempt(state.recovery, policy, lease, now)) {
    throw new Error('Recovery admission changed inside transaction');
  }
  state.bindings[lease] = {
    owner,
    ...(options.operation
      ? { operation: { ...options.operation }, generation, autoFinish: options.autoFinish ?? false }
      : {}),
  };
}
/** Expiry invalidates recovery evidence, never proof of remote completion. */
export function expireControlAttempt(
  state: ControlState,
  policy: RecoveryPolicy,
  lease: string,
  now: number,
): void {
  completeRecoveryAttempt(state.recovery, policy, lease, { kind: 'neutral' }, now);
}
export function completeControlAttempt(
  state: ControlState,
  policy: RecoveryPolicy,
  owner: string,
  lease: string,
  outcome: Outcome,
  now: number,
): boolean {
  const binding = Object.hasOwn(state.bindings, lease) ? state.bindings[lease] : undefined;
  if (!binding || binding.owner !== owner) {
    return false;
  }
  requestTransition(() => completeRecoveryAttempt(state.recovery, policy, lease, outcome, now));
  if (binding.operation) {
    endOperationAttempt(state.maintenance, owner, binding.operation, binding.generation!);
    if (binding.autoFinish) {
      finishOperation(state.maintenance, owner, binding.operation);
    }
  }
  delete state.bindings[lease];
  return true;
}
export function abandonControlOwner(
  state: ControlState,
  policy: RecoveryPolicy,
  owner: string,
  now: number,
): void {
  for (const [lease, binding] of Object.entries(state.bindings)) {
    if (binding.owner === owner) {
      expireControlAttempt(state, policy, lease, now);
      delete state.bindings[lease];
    }
  }
  abandonOwner(state.maintenance, owner);
}
export function controlSnapshot(state: ControlState, fingerprint: string): ControlSnapshot {
  const { attempts: _attempts, ...recovery } = state.recovery;
  return structuredClone({
    fingerprint,
    recovery,
    maintenance: drainStatus(state.maintenance),
    operations: state.maintenance.operations,
    unconfirmed: state.maintenance.unconfirmed,
  });
}
export function administerControl(state: ControlState, command: ControlCommand): void {
  requestTransition(() => administer(state, command));
}
function administer(state: ControlState, command: ControlCommand): void {
  switch (command.action) {
    case 'status':
      return;
    case 'drain':
      beginDrain(state.maintenance);
      return;
    case 'resume':
      resumePool(state.maintenance, command.generation);
      return;
    case 'acknowledge':
      acknowledgeUnconfirmed(state.maintenance, command.generation, command.ids, command.reason);
      return;
    default:
      throw new InputError('Unknown control command');
  }
}
