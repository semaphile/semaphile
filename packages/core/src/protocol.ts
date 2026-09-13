import type { Snapshot } from './client.js';
import type {
  AttemptOptions,
  ControlCommand,
  ControlSnapshot,
  ControlResult,
} from './control-state.js';
import type { OperationToken } from './maintenance-state.js';
import type { Outcome } from './recovery-state.js';

export type Admission = Readonly<{
  leaseId: string;
  leaseGrantedAt: number;
  expiresAt: number | null;
  weight: number;
}>;

export type Operations = {
  acquire: {
    input: { weight: number; expirationMs: number | null } & AttemptOptions;
    output: Admission;
  };
  release: { input: { lease: string; outcome?: Outcome }; output: null };
  accept: { input: { operationId: string }; output: OperationToken };
  finish: { input: { operation: OperationToken }; output: boolean };
  control: { input: { command: ControlCommand }; output: ControlResult };
  waitDrain: { input: { generation: number }; output: ControlSnapshot };
  inspect: { input: Record<string, never>; output: Snapshot };
  close: { input: Record<string, never>; output: null };
  reservoir: { input: Record<string, never>; output: number | null };
  increment: { input: { amount: number }; output: number };
};
export type Command =
  | {
      [K in keyof Operations]: { id: number; action: K } & Operations[K]['input'];
    }[keyof Operations]
  | { action: 'abort'; target: number };
export type Reply = {
  id?: number;
  event?: string;
  value?: unknown;
  error?: string;
  aborted?: boolean;
  recoverable?: boolean;
  errorName?: string;
  generation?: number;
  notBefore?: number | null;
};
