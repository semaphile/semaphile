// Establish resources and observe owner lifetimes. Pool serializes calls with
// the gate; watches remain owned by the caller until its wait has returned.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Native, NativeContext, NativeFile, NativeSubscription } from './native.js';
import type { Stage } from './sqlite-types.js';
import type { normalize } from './config.js';
import { initialControlState, abandonControlOwner } from './control-state.js';
import { normalizeRecovery } from './recovery-policy.js';
import { readControl, writeControl } from './sqlite-control.js';
export type LeaseRow = {
  id: string;
  owner: string;
  expires: number | null;
  pid: number;
  weight: number;
};
export function openResources(
  path: string,
  config: ReturnType<typeof normalize>,
  addon: string,
  owner: string,
) {
  const binding: Native = createRequire(import.meta.url)(resolve(addon));
  const native = new binding.NativeContext();
  mkdirSync(join(path, 'owners'), { recursive: true, mode: 0o700 });
  let db: DatabaseSync | undefined;
  let gate: NativeFile | undefined;
  try {
    gate = native.open(join(path, 'coordination.lock'), 'gate');
    const notification = native.open(join(path, 'notify'), 'notification');
    const lifetime = native.open(join(path, 'owners', owner + '.lock'), 'lifetime');
    lifetime.lockLifetime();
    gate.withGate(() => {
      try {
        db = new DatabaseSync(join(path, 'state.sqlite'));
        db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
        notification.pulse();
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS config (singleton INTEGER PRIMARY KEY CHECK(singleton=1), format TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS owners (id TEXT PRIMARY KEY, pid INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER, weight INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS timing (singleton INTEGER PRIMARY KEY CHECK(singleton=1), nextAllowedAt INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS budget (singleton INTEGER PRIMARY KEY CHECK(singleton=1), remaining INTEGER, nextRefreshAt INTEGER);
          CREATE TABLE IF NOT EXISTS control (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS trace (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, lease TEXT NOT NULL, owner TEXT NOT NULL, active INTEGER NOT NULL, at INTEGER NOT NULL);
        `);
        const expected = JSON.stringify(config);
        const stored = db.prepare('SELECT format,value FROM config WHERE singleton=1').get();
        if (stored && (stored.format !== 'semaphile-sqlite-poc/1.4' || stored.value !== expected)) {
          throw new Error('pool config or format mismatch; use a fresh pool directory');
        }
        if (!stored) {
          db.prepare('INSERT INTO config VALUES(1,?,?)').run('semaphile-sqlite-poc/1.4', expected);
          db.prepare('INSERT INTO control VALUES(1,?)').run(JSON.stringify(initialControlState()));
          db.prepare('INSERT INTO timing VALUES(1,0)').run();
          db.prepare('INSERT INTO budget VALUES(1,?,?)').run(
            config.reservoir,
            config.reservoirRefreshInterval === null
              ? null
              : Date.now() + config.reservoirRefreshInterval,
          );
        }
        db.prepare('INSERT INTO owners VALUES(?,?)').run(owner, process.pid);
        db.exec('COMMIT');
      } catch (error) {
        if (db?.isTransaction) {
          db.exec('ROLLBACK');
        }
        db?.close();
        db = undefined;
        throw error;
      }
    });
    return { native, db: db!, gate, notification, lifetime };
  } catch (error) {
    try {
      if (db && gate) {
        gate.withGate(() => db!.close());
      }
    } finally {
      native.close();
    }
    throw error;
  }
}

// Caller holds the gate; its subscription owns all added process watches.
// Closing the subscription covers an exception from either lifetime probe.
export function observeOwners(
  pool: { native: NativeContext; path: string; owner: string },
  rows: Array<{ owner: string; pid: number }>,
  subscription: NativeSubscription,
): Set<string> {
  const dead = new Set<string>();
  for (const row of new Map(rows.map((row) => [row.owner, row])).values()) {
    if (row.owner === pool.owner) {
      continue;
    }
    const path = join(pool.path, 'owners', row.owner + '.lock');
    if (!pool.native.alive(path)) {
      dead.add(row.owner);
      continue;
    }
    let watched = false,
      watchError: unknown;
    try {
      watched = subscription.watchOwner(row.pid);
    } catch (error) {
      watchError = error;
    }
    // If PID disappeared or was reused, the registered owner's lock decides.
    if (!pool.native.alive(path)) {
      dead.add(row.owner);
    } else if (watchError || !watched) {
      throw watchError ?? new Error('live owner cannot be watched');
    }
  }
  return dead;
}

// Retire ownership under the gate even when SQL cleanup fails; peers must
// observe the lifetime lock closing before they can recheck after our signal.
export function retireResources(
  resources: {
    db: DatabaseSync;
    native: NativeContext;
    gate: NativeFile;
    lifetime: NativeFile;
    notification: NativeFile;
    owner: string;
    config: ReturnType<typeof normalize>;
  },
  mutate: (operation: () => void) => void,
  trace: (kind: string, id: string, owner: string) => void,
): void {
  let lifetimeClosed = false;
  try {
    resources.gate.withGate(() => {
      try {
        mutate(() => {
          const control = readControl(resources.db);
          abandonControlOwner(
            control,
            normalizeRecovery(resources.config.recovery),
            resources.owner,
            Date.now(),
          );
          writeControl(resources.db, control);
          for (const row of resources.db
            .prepare('SELECT id FROM leases WHERE owner=?')
            .all(resources.owner)) {
            resources.db.prepare('DELETE FROM leases WHERE id=?').run(row.id);
            trace('released', String(row.id), resources.owner);
          }
          resources.db.prepare('DELETE FROM owners WHERE id=?').run(resources.owner);
        });
      } finally {
        try {
          resources.db.close();
        } finally {
          // The pre-mutation notification must cover owner retirement even
          // when SQL cleanup rolls back. Readers cannot recheck before ownership retires.
          lifetimeClosed = true;
          resources.lifetime.close();
        }
      }
    });
  } finally {
    if (!lifetimeClosed) {
      resources.lifetime.close();
    }
    resources.native.close();
  }
}

// The caller holds the gate throughout notification, commit/rollback and hooks.
export function mutateState(
  resources: { db: DatabaseSync; native: NativeContext; notification: NativeFile },
  stage: (name: Stage) => void,
  operation: () => void,
): void {
  // Caller holds the gate. Signal before changing state so a writer crash
  // cannot commit available capacity without leaving a wakeup for subscribers.
  stage('beforeSignal');
  resources.notification.pulse();
  stage('afterSignal');
  resources.db.exec('BEGIN IMMEDIATE');
  try {
    operation();
    stage('afterMutation');
    stage('beforeCommit');
    resources.db.exec('COMMIT');
  } catch (error) {
    if (resources.db.isTransaction) {
      resources.db.exec('ROLLBACK');
    }
    throw error;
  }
  stage('afterCommit');
  stage('beforeUnlock');
}
