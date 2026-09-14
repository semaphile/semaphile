import type { ServerResponse } from 'node:http';

export class ProxyInputError extends TypeError {}

export class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ProxyError';
  }
}
export function localError(error: unknown): ProxyError {
  if (error instanceof ProxyError) {
    return error;
  }
  const name = error instanceof Error ? error.name : '';
  if (['QueueTimeoutError', 'ExecutionTimeoutError', 'AttemptTimeoutError'].includes(name)) {
    return new ProxyError(504, 'PROXY_TIMEOUT');
  }
  return new ProxyError(503, 'PROXY_UNAVAILABLE');
}
export function errorResponse(response: ServerResponse, error: ProxyError): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(error.status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(JSON.stringify({ error: error.code }));
}
