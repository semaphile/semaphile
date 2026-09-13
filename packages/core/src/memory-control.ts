// In-process control transitions mirror the persisted SQLite record. Clone before
// changing state so invalid reports never partly change admission or drain state.
import { InputError, type normalize } from './config.js';
import { normalizeRecovery, configFingerprint } from './recovery-policy.js';
import { recoveryAdmission, type Outcome } from './recovery-state.js';
import type { OperationToken } from './maintenance-state.js';
import {
  initialControlState,
  controlEligibility,
  startControlAttempt,
  completeControlAttempt,
  expireControlAttempt,
  abandonControlOwner,
  acceptControlOperation,
  finishControlOperation,
  administerControl,
  controlSnapshot,
  controlResult,
  CircuitOpenError,
  type ControlState,
  type AttemptOptions,
  type ControlCommand,
} from './control-state.js';

export class MemoryControl {
  private state = initialControlState();
  readonly policy;
  private readonly fingerprint;
  private readonly watchers = new Set<() => void>();
  constructor(config: ReturnType<typeof normalize>) {
    this.policy = normalizeRecovery(config.recovery);
    this.fingerprint = configFingerprint(config);
  }
  private update<T>(transition: (state: ControlState) => T): T {
    const state = structuredClone(this.state);
    const result = transition(state);
    this.state = state;
    for (const notify of this.watchers) {
      notify();
    }
    return result;
  }
  accept(owner: string, id: string) {
    return this.update((state) => acceptControlOperation(state, owner, id));
  }
  finish(owner: string, operation: OperationToken) {
    return this.update((state) => finishControlOperation(state, owner, operation));
  }
  eligibility(owner: string, options: AttemptOptions, now: number) {
    // Retiring an expired probe must persist even when fail-fast rejects the call.
    recoveryAdmission(this.state.recovery, this.policy, now);
    return controlEligibility(this.state, this.policy, owner, options, now);
  }
  assertCircuitClosed(now: number): void {
    const eligibility = recoveryAdmission(this.state.recovery, this.policy, now);
    if (eligibility.circuit !== 'closed') {
      throw new CircuitOpenError(eligibility.notBefore);
    }
  }
  start(owner: string, lease: string, options: AttemptOptions, now: number) {
    this.update((state) => startControlAttempt(state, this.policy, owner, lease, options, now));
  }
  expire(lease: string, now: number) {
    this.update((state) => expireControlAttempt(state, this.policy, lease, now));
  }
  complete(owner: string, lease: string, outcome: Outcome, expired: boolean) {
    this.update((state) => {
      const now = Date.now();
      if (expired) {
        expireControlAttempt(state, this.policy, lease, now);
      }
      completeControlAttempt(state, this.policy, owner, lease, outcome, now);
    });
  }
  retire(owner: string) {
    this.update((state) => abandonControlOwner(state, this.policy, owner, Date.now()));
  }
  administer<C extends ControlCommand>(command: C) {
    this.update((state) => {
      recoveryAdmission(state.recovery, this.policy, Date.now());
      administerControl(state, command);
    });
    return controlResult(this.state, this.fingerprint, command);
  }
  wait(generation: number, signal?: AbortSignal) {
    return new Promise<ReturnType<typeof controlSnapshot>>((resolve, reject) => {
      const cleanup = () => {
        this.watchers.delete(check);
        signal?.removeEventListener('abort', check);
      };
      const check = () => {
        try {
          if (signal?.aborted) {
            throw Object.assign(new Error('Drain wait aborted'), { name: 'AbortError' });
          }
          const snapshot = controlSnapshot(this.state, this.fingerprint);
          if (
            snapshot.maintenance.mode !== 'draining' ||
            snapshot.maintenance.generation !== generation
          ) {
            throw new InputError('Stale maintenance generation');
          }
          if (snapshot.maintenance.settled) {
            cleanup();
            resolve(snapshot);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      this.watchers.add(check);
      signal?.addEventListener('abort', check, { once: true });
      check();
    });
  }
}
