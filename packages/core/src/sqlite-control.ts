// Caller holds the pool gate. The JSON record is written only inside the same
// SQLite transaction that changes its associated leases or owner records.
import type { DatabaseSync } from 'node:sqlite';
import type { ControlState } from './control-state.js';
export function readControl(db: DatabaseSync): ControlState {
  return JSON.parse(
    String(db.prepare('SELECT value FROM control WHERE singleton=1').get()!.value),
  ) as ControlState;
}
export function writeControl(db: DatabaseSync, state: ControlState): void {
  db.prepare('UPDATE control SET value=? WHERE singleton=1').run(JSON.stringify(state));
}
