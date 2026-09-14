import type { ScheduledLimiter } from '@semaphile/core/client';

export type ProxyLimiter = Pick<ScheduledLimiter, 'startExecution'>;
export type HttpRoute = {
  /** First URL path segment; for example, notion serves /notion/v1/pages. */
  name: string;
  upstream: string;
  limiter: ProxyLimiter;
  headers?: Record<string, string>;
  weight?: number;
  queueTimeoutMs?: number;
  requestTimeoutMs?: number;
};
export type HttpProxyOptions = {
  routes: HttpRoute[];
  host?: string;
  port?: number;
  /** Full Host authorities accepted in addition to the loopback listener names. */
  allowedHosts?: string[];
  /** Presented in X-Semaphile-Token, never in upstream Authorization. */
  token?: string;
  maxPending?: number;
  maxConnections?: number;
};
export type HttpProxy = {
  readonly url: string;
  readonly port: number;
  inspect(): { pending: number; closing: boolean };
  close(options?: { drain?: boolean }): Promise<void>;
};
