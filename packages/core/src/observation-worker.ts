// Collector registration and read-only pool projection. Never hold a collector
// gate and the pool gate together; every acquisition is a single nonblocking try.
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, opendirSync, realpathSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { nativePath } from './native-path.js';
import type { Native, NativeContext, NativeFile } from './native.js';
import type { PoolMeasurement } from './observation.js';
import { normalize } from './config.js';
import { normalizeRecovery } from './recovery-policy.js';
import { budgetAt } from './budget.js';
import { readControl } from './sqlite-control.js';
import { abandonControlOwner, expireControlAttempt, controlSnapshot } from './control-state.js';
import { recoveryAdmission } from './recovery-state.js';
let native: NativeContext | undefined,
  gate: NativeFile,
  registrationGate: NativeFile,
  lifetime: NativeFile;
let path: string, registrations: string, identity: string;
const id = String(workerData.collectorId);
let registered = false;
function inode(): string {
  const value = statSync(path, { bigint: true });
  return `${value.dev}:${value.ino}`;
}
function scanRegistrations(): string[] {
  const result: string[] = [];
  const directory = opendirSync(registrations);
  try {
    let seen = 0;
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++seen > 4096) {
        throw new Error('Collector registration scan exceeds bound');
      }
      const name = entry.name;
      if (!/^[a-f0-9-]{36}\.lock$/.test(name)) {
        continue;
      }
      if (native!.alive(join(registrations, name))) {
        result.push(name.slice(0, -5));
      } else {
        unlinkSync(join(registrations, name));
      }
      if (result.length > 1024) {
        throw new Error('Too many collector registrations');
      }
    }
    return result.sort();
  } finally {
    directory.closeSync();
  }
}
function owners(): string[] {
  return registrationGate.tryWithGate(scanRegistrations);
}
function open(): void {
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error('Invalid collector identity');
  }
  path = realpathSync(String(workerData.path));
  identity = inode();
  if (!existsSync(join(path, 'state.sqlite')) || !existsSync(join(path, 'coordination.lock'))) {
    throw new Error('Pool does not exist');
  }
  native = new (createRequire(import.meta.url)(nativePath()) as Native).NativeContext();
  gate = native.open(join(path, 'coordination.lock'), 'gate');
  // Validate before leaving any collector metadata in a non-pool directory.
  read();
  registrations = join(path, '.telemetry', 'collectors-v1');
  mkdirSync(registrations, { recursive: true, mode: 0o700 });
  registrationGate = native.open(join(registrations, 'gate'), 'gate');
  registrationGate.tryWithGate(() => {
    const conflicts = scanRegistrations();
    if (conflicts.includes(id) || (conflicts.length && !workerData.allowOverlap)) {
      throw Object.assign(new Error('Collector conflict'), { owners: conflicts });
    }
    lifetime = native!.open(join(registrations, `${id}.lock`), 'lifetime');
    lifetime.lockLifetime();
    registered = true;
  });
}
function read(): PoolMeasurement {
  if (inode() !== identity) {
    throw new Error('Pool directory identity changed');
  }
  return gate.tryWithGate(() => {
    const db = new DatabaseSync(join(path, 'state.sqlite'), { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout=0;');
      const row = db.prepare('SELECT format,value FROM config WHERE singleton=1').get();
      if (row?.format !== 'semaphile-sqlite-poc/1.4') {
        throw new Error('Unsupported limiter format');
      }
      const config = normalize(JSON.parse(String(row.value)));
      const now = Date.now(),
        control = readControl(db),
        policy = normalizeRecovery(config.recovery);
      const ownerRows = db.prepare('SELECT id FROM owners LIMIT 1025').all();
      if (ownerRows.length > 1024) {
        throw new Error('Pool exceeds observation owner bound');
      }
      const alive = new Set<string>();
      for (const owner of ownerRows) {
        const ownerId = String(owner.id);
        if (native!.alive(join(path, 'owners', `${ownerId}.lock`))) {
          alive.add(ownerId);
        } else {
          abandonControlOwner(control, policy, ownerId, now);
        }
      }
      let active = 0;
      const leases = db.prepare('SELECT id,owner,expires,weight FROM leases LIMIT 10001').all();
      if (leases.length > 10000) {
        throw new Error('Pool exceeds observation lease bound');
      }
      for (const lease of leases) {
        if (
          alive.has(String(lease.owner)) &&
          (lease.expires === null || Number(lease.expires) > now)
        ) {
          active += Number(lease.weight);
        } else {
          expireControlAttempt(control, policy, String(lease.id), now);
        }
      }
      recoveryAdmission(control.recovery, policy, now);
      const snapshot = controlSnapshot(control, '');
      return {
        at: now,
        active,
        maxConcurrent: config.maxConcurrent,
        reservoir: budgetAt(db, config, now).remaining,
        pending: snapshot.maintenance.pending,
        unconfirmed: snapshot.maintenance.unconfirmed,
        maintenance: snapshot.maintenance.mode,
        circuit: snapshot.recovery.circuit,
        cooldownUntil: snapshot.recovery.cooldownUntil,
        openUntil: snapshot.recovery.openUntil,
      };
    } finally {
      db.close();
    }
  });
}
function close(): void {
  // Closing the lifetime descriptor is sufficient even if a busy registration
  // gate prevents metadata cleanup. A future observation removes the stale file.
  if (registered) {
    lifetime.close();
    registered = false;
    try {
      registrationGate.tryWithGate(() => unlinkSync(join(registrations, `${id}.lock`)));
    } catch {
      /* Future bounded scan removes a stale file. */
    }
  }
  native?.close();
  native = undefined;
}
parentPort!.on('message', (request: { id: number; action: string }) => {
  try {
    let value: unknown;
    if (request.action === 'open') {
      open();
      value = null;
    } else if (request.action === 'sample') {
      if (!registered) {
        throw new Error('Collector is not registered');
      }
      value = read();
    } else if (request.action === 'owners') {
      value = owners();
    } else if (request.action === 'close') {
      close();
      value = null;
    } else {
      throw new Error('Unknown observation action');
    }
    parentPort!.postMessage({ id: request.id, value });
  } catch (error) {
    if (request.action === 'open') {
      close();
    }
    parentPort!.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Observation failed',
      owners: (error as { owners?: string[] }).owners,
    });
  }
});
