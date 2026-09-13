// One authoritative admission attempt, called while Pool holds the gate.
// Register watches before reading state; notifications only authorize rechecking.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NativeContext, NativeSubscription } from './native.js';
import { InputError, type normalize } from './config.js';
import type { Admission } from './protocol.js';
import { budgetAt, writeBudget } from './budget.js';
import { observeOwners, type LeaseRow } from './sqlite-resources.js';
import { normalizeRecovery } from './recovery-policy.js';
import { readControl, writeControl } from './sqlite-control.js';
import {
  abandonControlOwner,
  controlEligibility,
  expireControlAttempt,
  startControlAttempt,
  type AttemptOptions,
} from './control-state.js';
type AdmissionContext = {
  db: DatabaseSync;
  native: NativeContext;
  path: string;
  owner: string;
  config: ReturnType<typeof normalize>;
  mutate: (operation: () => void) => void;
  trace: (kind: string, id: string, owner: string, at?: number) => void;
};
export function attemptAdmission(
  context: AdmissionContext,
  weight: number,
  expirationMs: number | null,
  options: AttemptOptions = {},
): { admission?: Admission; subscription?: NativeSubscription; deadline?: number } {
  // Fresh subscription, then final state check under the same gate as writers.
  const subscription = context.native.subscribe(join(context.path, 'notify'));
  try {
    const rows = context.db
      .prepare('SELECT leases.*, owners.pid FROM leases JOIN owners ON owners.id=leases.owner')
      .all() as unknown as LeaseRow[];
    const owners = context.db.prepare('SELECT id AS owner,pid FROM owners').all() as Array<{
      owner: string;
      pid: number;
    }>;
    const dead = observeOwners(context, owners, subscription);
    const now = Date.now();
    const control = readControl(context.db),
      previousControl = JSON.stringify(control);
    const policy = normalizeRecovery(context.config.recovery);
    for (const owner of dead) {
      abandonControlOwner(control, policy, owner, now);
    }
    const retired = rows.filter(
      (row) => dead.has(row.owner) || (row.expires !== null && row.expires <= now),
    );
    const active = rows
      .filter((row) => !retired.includes(row))
      .reduce((sum, row) => sum + row.weight, 0);
    for (const row of retired) {
      expireControlAttempt(control, policy, row.id, now);
    }
    let recovery;
    try {
      recovery = controlEligibility(control, policy, context.owner, options, now);
    } catch (error) {
      // A refused request may still discover dead owners or an expired probe.
      if (JSON.stringify(control) !== previousControl) {
        context.mutate(() => writeControl(context.db, control));
      }
      throw error;
    }
    const nextAllowedAt = Number(
      context.db.prepare('SELECT nextAllowedAt FROM timing WHERE singleton=1').get()!.nextAllowedAt,
    );
    const budget = budgetAt(context.db, context.config, now);
    if (context.config.maxConcurrent === null && active > Number.MAX_SAFE_INTEGER - weight) {
      throw new InputError('Capacity accounting overflow');
    }
    const available =
      context.config.maxConcurrent === null || weight <= context.config.maxConcurrent - active;
    const allowed =
      recovery.allowed &&
      available &&
      now >= nextAllowedAt &&
      (budget.remaining === null || weight <= budget.remaining);
    let admission: Admission | undefined;
    if (
      retired.length ||
      dead.size ||
      allowed ||
      budget.refreshed ||
      JSON.stringify(control) !== previousControl
    ) {
      context.mutate(() => {
        for (const row of retired) {
          context.db.prepare('DELETE FROM leases WHERE id=?').run(row.id);
          context.trace(dead.has(row.owner) ? 'reclaimed' : 'expired', row.id, row.owner);
        }
        for (const owner of dead) {
          context.db.prepare('DELETE FROM owners WHERE id=?').run(owner);
        }
        if (budget.refreshed) {
          if (!allowed) {
            writeBudget(context.db, budget);
          }
          context.trace('refreshed', '', context.owner);
        }
        if (allowed) {
          const id = randomUUID(),
            expiresAt = expirationMs === null ? null : now + expirationMs;
          startControlAttempt(control, policy, context.owner, id, options, now);
          context.db
            .prepare('INSERT INTO leases VALUES(?,?,?,?)')
            .run(id, context.owner, expiresAt, weight);
          if (budget.remaining !== null) {
            writeBudget(context.db, { ...budget, remaining: budget.remaining - weight });
          }
          context.db
            .prepare('UPDATE timing SET nextAllowedAt=? WHERE singleton=1')
            .run(now + context.config.minTime);
          context.trace('admitted', id, context.owner, now);
          admission = { leaseId: id, leaseGrantedAt: now, expiresAt, weight };
        }
        writeControl(context.db, control);
      });
    }
    if (admission) {
      subscription.close();
      return { admission };
    }
    const deadlines = rows
      .filter((row) => !retired.includes(row) && row.expires !== null)
      .map((row) => row.expires!);
    if (recovery.notBefore !== null) {
      deadlines.push(recovery.notBefore);
    }
    if (nextAllowedAt > now) {
      deadlines.push(nextAllowedAt);
    }
    if (
      budget.remaining !== null &&
      budget.remaining < weight &&
      budget.nextRefreshAt !== null &&
      context.config.reservoirRefreshAmount! >= weight
    ) {
      deadlines.push(budget.nextRefreshAt);
    }
    return { subscription, deadline: deadlines.length ? Math.min(...deadlines) : undefined };
  } catch (error) {
    subscription.close();
    throw error;
  }
}
