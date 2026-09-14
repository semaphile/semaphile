import type { Readable, Writable } from 'node:stream';
import type { ProxyLimiter } from './types.js';
export type McpProxyOptions = {
  limiter: ProxyLimiter;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stderr?: 'ignore' | 'inherit';
  input?: Readable;
  output?: Writable;
  maxMessageBytes?: number;
  maxBufferedBytes?: number;
  maxPending?: number;
  maxControlPending?: number;
  queueTimeoutMs?: number;
  requestTimeoutMs?: number;
  cancellationGraceMs?: number;
  shutdownGraceMs?: number;
  toolWeights?: Record<string, number>;
};
export type McpProxy = {
  readonly pid: number;
  readonly finished: Promise<void>;
  inspect(): { pending: number; active: number; closing: boolean; error?: string };
  close(options?: { drain?: boolean }): Promise<void>;
};
