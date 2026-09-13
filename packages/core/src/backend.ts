// Authoritative pool state: every SQLite access is serialized by the file gate.
// Kernel notifications are hints; admission always rechecks committed state.
import type { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeContext, NativeFile, NativeSubscription } from './native.js';
import type { Snapshot } from './index.js';
import {
  InputError,
  normalize,
  normalizeExpiration,
  validateWeight,
  type PoolConfig,
} from './config.js';
import type { Admission } from './protocol.js';
import { budgetAt, writeBudget } from './budget.js';
import { waitForWake } from './wake.js';
import { openResources, retireResources, mutateState, observeOwners } from './sqlite-resources.js';
import { attemptAdmission } from './sqlite-admission.js';
import { readControl, writeControl } from './sqlite-control.js';
import { normalizeRecovery, configFingerprint } from './recovery-policy.js';
import {
  acceptControlOperation,
  finishControlOperation,
  completeControlAttempt,
  expireControlAttempt,
  abandonControlOwner,
  administerControl,
  controlResult,
  type ControlSnapshot,
  type ControlResult,
  CircuitOpenError,
  type AttemptOptions,
  type ControlCommand,
} from './control-state.js';
import { PoolDrainingError, type OperationToken } from './maintenance-state.js';
import { recoveryAdmission, type Outcome } from './recovery-state.js';

import type { Pending, Stage } from './sqlite-types.js';
export type { Stage } from './sqlite-types.js';

// Private coordinator-owned backend; application code uses Limiter instead.
export class Pool {
  readonly owner = randomUUID();
  readonly config: ReturnType<typeof normalize>;
  readonly path: string;
  readonly native: NativeContext;
  readonly db: DatabaseSync;
  readonly gate: NativeFile;
  readonly notification: NativeFile;
  readonly lifetime: NativeFile;
  stats = { waits: 0, wakes: 0 };
  onWait: (() => void) | undefined;
  stage: ((name: Stage) => void) | undefined; // Harness-only crash injection.
  private readonly pending: Pending[] = [];
  private pumping: Promise<void> | undefined;
  private waiting: NativeSubscription | undefined;
  private readonly controlWaits = new Set<NativeSubscription>();
  private readonly controlTasks = new Set<Promise<unknown>>();
  private readonly acquisitionTasks = new Set<Promise<unknown>>();
  private closing = false;
  private fatal: Error | undefined;

  constructor(path: string, config: PoolConfig, addon: string) {
    this.config = normalize(config);
    this.path = resolve(path);
    ({
      native: this.native,
      db: this.db,
      gate: this.gate,
      notification: this.notification,
      lifetime: this.lifetime,
    } = openResources(this.path, this.config, addon, this.owner));
  }

  private locked<T>(fn: () => T): T {
    return this.gate.withGate(fn);
  }
  private mutate(operation: () => void) {
    mutateState(this, (stage) => this.stage?.(stage), operation);
  }

  private count(): number {
    return Number(this.db.prepare('SELECT coalesce(sum(weight),0) AS n FROM leases').get()!.n);
  }
  private trace(kind: string, id: string, owner: string, at = Date.now()) {
    this.db
      .prepare('INSERT INTO trace(kind,lease,owner,active,at) VALUES(?,?,?,?,?)')
      .run(kind, id, owner, this.count(), at);
  }
  private refreshBudget(): number | null {
    const budget = budgetAt(this.db, this.config, Date.now());
    if (budget.refreshed) {
      this.mutate(() => {
        writeBudget(this.db, budget);
        this.trace('refreshed', '', this.owner);
      });
    }
    return budget.remaining;
  }
  currentReservoir(): number | null {
    return this.locked(() => this.refreshBudget());
  }
  incrementReservoir(amount: number): number {
    if (!Number.isSafeInteger(amount)) {
      throw new InputError('Invalid reservoir increment');
    }
    return this.locked(() => {
      const budget = budgetAt(this.db, this.config, Date.now()),
        remaining = (budget.remaining ?? 0) + amount;
      if (!Number.isSafeInteger(remaining)) {
        throw new InputError('Reservoir increment overflow');
      }
      if (remaining !== budget.remaining || budget.refreshed) {
        this.mutate(() => {
          writeBudget(this.db, { ...budget, remaining });
          this.trace('adjusted', '', this.owner);
        });
      }
      return remaining;
    });
  }

  private attempt(weight: number, expirationMs: number | null, options: AttemptOptions) {
    return this.locked(() =>
      attemptAdmission(
        {
          db: this.db,
          native: this.native,
          path: this.path,
          owner: this.owner,
          config: this.config,
          mutate: (operation) => this.mutate(operation),
          trace: (kind, id, owner, at) => this.trace(kind, id, owner, at),
        },
        weight,
        expirationMs,
        options,
      ),
    );
  }

  acquire(signal?: AbortSignal, weight = 1): Promise<string> {
    return this.acquireDetailed(signal, weight).then((admission) => admission.leaseId);
  }
  acquireDetailed(
    signal?: AbortSignal,
    weight = 1,
    expirationMs = this.config.expirationMs,
    options: AttemptOptions = {},
  ): Promise<Admission> {
    options = { ...options, ...(options.operation ? { operation: { ...options.operation } } : {}) };
    if (this.closing || this.fatal) {
      return Promise.reject(this.fatal ?? new Error('pool closed'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('acquire aborted'));
    }
    try {
      validateWeight(weight, this.config.maxConcurrent);
      normalizeExpiration(expirationMs);
      if (options.circuit === 'fail-fast') {
        this.assertCircuitClosed();
      }
      if (!options.operation) {
        options = { ...options, operation: this.acceptOperation(randomUUID()), autoFinish: true };
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const promise = new Promise<Admission>((resolveLease, reject) => {
      const entry: Pending = {
        weight,
        expirationMs,
        options,
        resolve: resolveLease,
        reject,
        signal,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        const index = this.pending.indexOf(entry);
        if (index < 0) {
          return;
        }
        this.pending.splice(index, 1);
        entry.cleanup();
        reject(new Error('acquire aborted'));
        if (this.waiting) {
          this.waiting.cancel();
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.push(entry);
    });
    this.start();
    const acquisition = promise.catch((error: unknown) => {
      if (options.autoFinish && options.operation) {
        this.finishOperation(options.operation);
      }
      throw error;
    });
    this.acquisitionTasks.add(acquisition);
    void acquisition.finally(() => this.acquisitionTasks.delete(acquisition)).catch(() => {});
    return acquisition;
  }
  private assertCircuitClosed(): void {
    const recovery = this.control().recovery;
    if (recovery.circuit !== 'closed') {
      throw new CircuitOpenError(
        Math.max(recovery.cooldownUntil, recovery.openUntil, recovery.probe?.expiresAt ?? 0),
      );
    }
  }
  private rejectCircuitWaiters(): void {
    if (!this.pending.some((entry) => entry.options.circuit === 'fail-fast')) {
      return;
    }
    try {
      this.assertCircuitClosed();
    } catch (error) {
      if (!(error instanceof CircuitOpenError)) {
        throw error;
      }
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].options.circuit !== 'fail-fast') {
          continue;
        }
        const [entry] = this.pending.splice(i, 1);
        entry.cleanup();
        entry.reject(error);
      }
    }
  }
  private start() {
    this.pumping ??= this.pump().finally(() => {
      this.pumping = undefined;
      if (this.pending.length && !this.closing && !this.fatal) {
        this.start();
      }
    });
  }
  private nextAttempt(): ReturnType<Pool['attempt']> | undefined {
    try {
      return this.attempt(
        this.pending[0].weight,
        this.pending[0].expirationMs,
        this.pending[0].options,
      );
    } catch (error) {
      if (!(
        error instanceof InputError ||
        error instanceof CircuitOpenError ||
        error instanceof PoolDrainingError
      )) {
        throw error;
      }
      const entry = this.pending.shift()!;
      entry.cleanup();
      entry.reject(error);
      return undefined;
    }
  }
  private async pump() {
    try {
      while (this.pending.length && !this.closing) {
        if (this.fatal) {
          throw this.fatal;
        }
        this.rejectCircuitWaiters();
        if (!this.pending.length) {
          break;
        }
        const attempt = this.nextAttempt();
        if (!attempt) {
          continue;
        }
        if (attempt.admission) {
          const entry = this.pending.shift()!;
          entry.cleanup();
          entry.resolve(attempt.admission);
          continue;
        }
        const subscription = attempt.subscription!;
        this.waiting = subscription;
        try {
          this.stats.waits++;
          await waitForWake(subscription, attempt.deadline, () => this.onWait?.());
          this.stats.wakes++;
        } finally {
          this.waiting = undefined;
          subscription.close();
        }
      }
    } catch (error) {
      this.fatal = error instanceof Error ? error : new Error(String(error));
      for (const entry of this.pending.splice(0)) {
        entry.cleanup();
        entry.reject(this.fatal);
      }
    }
  }
  release(id: string, outcome: Outcome = { kind: 'neutral' }) {
    // Lease identity and owner make late/duplicate releases harmless. Releasing
    // concurrency never refunds the tokens or spacing spent at admission.
    if (this.closing) {
      throw new Error('pool closed');
    }
    this.locked(() => {
      const row = this.db
        .prepare('SELECT expires FROM leases WHERE id=? AND owner=?')
        .get(id, this.owner);
      const control = readControl(this.db),
        policy = normalizeRecovery(this.config.recovery),
        now = Date.now();
      if (row && row.expires !== null && Number(row.expires) <= now) {
        expireControlAttempt(control, policy, id, now);
      }
      const completed = completeControlAttempt(control, policy, this.owner, id, outcome, now);
      if (!row && !completed) {
        return;
      }
      this.mutate(() => {
        writeControl(this.db, control);
        this.db.prepare('DELETE FROM leases WHERE id=? AND owner=?').run(id, this.owner);
        this.trace('released', id, this.owner);
      });
    });
  }
  acceptOperation(id: string): OperationToken {
    return this.locked(() => {
      const state = readControl(this.db);
      const token = acceptControlOperation(state, this.owner, id);
      this.mutate(() => writeControl(this.db, state));
      return token;
    });
  }
  finishOperation(token: OperationToken): boolean {
    return this.locked(() => {
      const state = readControl(this.db);
      const finished = finishControlOperation(state, this.owner, token);
      if (finished) {
        this.mutate(() => writeControl(this.db, state));
      }
      return finished;
    });
  }
  control(): ControlSnapshot;
  control<C extends ControlCommand>(command: C): ControlResult<C>;
  control(command: ControlCommand = { action: 'status' }) {
    return this.locked(() => {
      const subscription = this.native.subscribe(resolve(this.path, 'notify'));
      try {
        return this.controlUnderGate(command, subscription);
      } finally {
        subscription.close();
      }
    });
  }
  private controlUnderGate<C extends ControlCommand>(command: C, subscription: NativeSubscription) {
    const state = readControl(this.db),
      previous = JSON.stringify(state);
    const owners = this.db.prepare('SELECT id AS owner,pid FROM owners').all() as Array<{
      owner: string;
      pid: number;
    }>;
    const dead = observeOwners(this, owners, subscription);
    const policy = normalizeRecovery(this.config.recovery),
      now = Date.now();
    for (const owner of dead) {
      abandonControlOwner(state, policy, owner, now);
    }
    recoveryAdmission(state.recovery, policy, now);
    administerControl(state, command);
    if (JSON.stringify(state) !== previous) {
      this.mutate(() => writeControl(this.db, state));
    }
    return controlResult(state, configFingerprint(this.config), command);
  }
  waitForDrain(generation: number, signal?: AbortSignal) {
    const task = this.waitUntilDrained(generation, signal);
    this.controlTasks.add(task);
    void task.finally(() => this.controlTasks.delete(task)).catch(() => {});
    return task;
  }
  private async waitUntilDrained(generation: number, signal?: AbortSignal) {
    while (true) {
      if (this.closing) {
        throw new Error('pool closed');
      }
      if (signal?.aborted) {
        throw Object.assign(new Error('Drain wait aborted'), { name: 'AbortError' });
      }
      let subscription: NativeSubscription | undefined;
      const cancel = () => subscription?.cancel();
      try {
        const status = this.locked(() => {
          subscription = this.native.subscribe(resolve(this.path, 'notify'));
          return this.controlUnderGate({ action: 'status' }, subscription);
        });
        if (
          status.maintenance.mode !== 'draining' ||
          status.maintenance.generation !== generation
        ) {
          throw new InputError('Stale maintenance generation');
        }
        if (status.maintenance.settled) {
          return status;
        }
        this.controlWaits.add(subscription!);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) {
          cancel();
        }
        await waitForWake(subscription!, undefined, () => {
          this.stats.waits++;
        });
        this.stats.wakes++;
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (subscription) {
          this.controlWaits.delete(subscription);
          subscription.close();
        }
      }
    }
  }
  stopAdmissions(error: Error) {
    this.fatal = error;
    for (const entry of this.pending.splice(0)) {
      entry.cleanup();
      entry.reject(error);
    }
    if (this.waiting) {
      this.waiting.cancel();
    }
  }
  inspect(): Snapshot {
    return this.locked(() => ({
      reservoir: this.refreshBudget(),
      active: this.count(),
      leases: this.db.prepare('SELECT * FROM leases').all() as unknown as Snapshot['leases'],
      trace: this.db.prepare('SELECT * FROM trace ORDER BY seq').all(),
    }));
  }
  touchForTest() {
    // A writer without a lease: its death must not substitute for file wakeups.
    this.locked(() => this.mutate(() => this.trace('test-marker', '', this.owner)));
  }
  async close() {
    // Cancel and join the native wait before closing borrowed descriptors.
    // Retire ownership under the gate so peers cannot miss the final wakeup.
    if (this.closing) {
      return;
    }
    this.closing = true;
    for (const entry of this.pending.splice(0)) {
      entry.cleanup();
      entry.reject(new Error('pool closed'));
    }
    if (this.waiting) {
      this.waiting.cancel();
    }
    for (const subscription of this.controlWaits) {
      subscription.cancel();
    }
    await Promise.allSettled(this.controlTasks);
    await this.pumping;
    await Promise.allSettled(this.acquisitionTasks);
    retireResources(
      this,
      (operation) => this.mutate(operation),
      (kind, id, owner) => this.trace(kind, id, owner),
    );
  }
}
