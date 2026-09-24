import type { createClient } from '@redis/client';
export type Connection = ReturnType<typeof createClient<{}, {}, {}, 2>>;
export interface MessagingWireOptions {
  url: string;
  key: string;
  operationTimeoutMs: number;
  maxPending: number;
  sessionTimeoutMs: number;
  readiness: 'warn' | 'strict';
  onWarning?: (issues: readonly string[]) => void;
}
export interface MessagingWireReply<T = unknown> {
  value: T;
  now: number;
  sent: number;
  received: number;
}
export interface Job {
  action: string;
  input: object;
  deadline: number;
  priority: boolean;
  resolve: (value: MessagingWireReply) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  dispatched: boolean;
  detach?: () => void;
}
