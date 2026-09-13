// Internal SQLite queue and crash-fixture types; no runtime imports.
import type { Admission } from './protocol.js';
import type { AttemptOptions } from './control-state.js';
export type Pending = {
  weight: number;
  expirationMs: number | null;
  options: AttemptOptions;
  resolve: (admission: Admission) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  cleanup: () => void;
};
export type Stage =
  | 'beforeSignal'
  | 'afterSignal'
  | 'afterMutation'
  | 'beforeCommit'
  | 'afterCommit'
  | 'beforeUnlock';
