import { ProxyInputError } from './errors.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { httpClassifierId } from '@semaphile/core/http-policy';
import type { Outcome } from '@semaphile/core/client';
import type { HttpProxy, HttpProxyOptions, HttpRoute } from './types.js';
import { overrideHeaders } from './headers.js';
import { errorResponse, localError, ProxyError } from './errors.js';
import { transfer } from './transfer.js';
export type { HttpProxy, HttpProxyOptions, HttpRoute, ProxyLimiter } from './types.js';

export function integer(value: number, name: string, minimum = 1, maximum = 2147483647): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProxyInputError('Invalid ' + name);
  }
  return value;
}
type Route = Omit<HttpRoute, 'upstream' | 'headers'> & {
  upstream: URL;
  headers: Record<string, string>;
  queueTimeoutMs: number;
  requestTimeoutMs: number;
  weight: number;
};
function prepareRoutes(input: HttpRoute[]): Map<string, Route> {
  if (!Array.isArray(input) || input.length < 1 || input.length > 256) {
    throw new ProxyInputError('Proxy requires between one and 256 routes');
  }
  const routes = new Map<string, Route>();
  for (const route of input) {
    if (
      !route ||
      typeof route.name !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(route.name)
    ) {
      throw new ProxyInputError('Invalid route name');
    }
    if (routes.has(route.name)) {
      throw new ProxyInputError('Duplicate proxy route');
    }
    let upstream: URL;
    try {
      upstream = new URL(route.upstream);
    } catch {
      throw new ProxyInputError('Invalid upstream URL');
    }
    if (
      !['http:', 'https:'].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.hash ||
      upstream.search
    ) {
      throw new ProxyInputError(
        'Upstream must be an HTTP(S) base URL without credentials, query or fragment',
      );
    }
    if (typeof route.limiter?.startExecution !== 'function') {
      throw new ProxyInputError('Route requires a compatible limiter');
    }
    routes.set(route.name, {
      ...route,
      upstream,
      headers: overrideHeaders(route.headers),
      weight: integer(route.weight ?? 1, 'route weight'),
      queueTimeoutMs: integer(route.queueTimeoutMs ?? 30000, 'queueTimeoutMs'),
      requestTimeoutMs: integer(route.requestTimeoutMs ?? 300000, 'requestTimeoutMs'),
    });
  }
  return routes;
}
function authority(value: string): string {
  if (typeof value !== 'string' || !value || /[\s/@?#\\]/.test(value)) {
    throw new ProxyInputError('Invalid allowed Host authority');
  }
  let url: URL;
  try {
    url = new URL('http://' + value);
  } catch {
    throw new ProxyInputError('Invalid allowed Host authority');
  }
  return url.host.toLowerCase();
}

/** Borrow route limiters. The operator, not each requesting agent, starts this listener. */
export async function startHttpProxy(options: HttpProxyOptions): Promise<HttpProxy> {
  const routes = prepareRoutes(options.routes);
  const host = options.host ?? '127.0.0.1';
  if (typeof host !== 'string' || !host || /[\s/@?#]/.test(host)) {
    throw new ProxyInputError('Invalid proxy host');
  }
  const port = integer(options.port ?? 9470, 'port', 0, 65535);
  const maxPending = integer(options.maxPending ?? 1024, 'maxPending', 1, 100000);
  const maxConnections = integer(options.maxConnections ?? 2048, 'maxConnections', 1, 100000);
  const local = ['127.0.0.1', '::1', 'localhost'].includes(host);
  if (
    options.token !== undefined &&
    (typeof options.token !== 'string' ||
      options.token.length < 16 ||
      options.token.length > 4096 ||
      /[\r\n]/.test(options.token))
  ) {
    throw new ProxyInputError('Proxy token must contain between 16 and 4096 characters');
  }
  const token =
    options.token === undefined ? undefined : createHash('sha256').update(options.token).digest();
  const allowedHosts = new Set((options.allowedHosts ?? []).map(authority));
  if (!local && (!token || !allowedHosts.size)) {
    throw new ProxyInputError('Non-loopback proxy requires a token and allowedHosts');
  }
  let closing: Promise<void> | undefined;
  let stopping = false;
  const pending = new Map<AbortController, Promise<void>>();
  const accept = (request: IncomingMessage, response: ServerResponse, expectContinue = false) => {
    const reject = (status: number, code: string) =>
      errorResponse(response, new ProxyError(status, code));
    if (stopping) {
      reject(503, 'PROXY_CLOSING');
      return;
    }
    let requestedHost: string;
    try {
      requestedHost = authority(request.headers.host ?? '');
    } catch {
      reject(400, 'INVALID_HOST');
      return;
    }
    if (!allowedHosts.has(requestedHost)) {
      reject(403, 'INVALID_HOST');
      return;
    }
    if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined) {
      reject(403, 'BROWSER_ORIGIN_DENIED');
      return;
    }
    if (token) {
      const supplied = request.headers['x-semaphile-token'];
      if (
        typeof supplied !== 'string' ||
        !timingSafeEqual(token, createHash('sha256').update(supplied).digest())
      ) {
        reject(401, 'PROXY_AUTH_REQUIRED');
        return;
      }
    }
    const raw = request.url ?? '';
    if (invalidTarget(raw)) {
      reject(400, 'INVALID_TARGET');
      return;
    }
    const query = raw.indexOf('?');
    const pathname = query < 0 ? raw : raw.slice(0, query);
    const name = pathname.slice(1).split('/')[0];
    const route = routes.get(name);
    if (!route) {
      reject(404, 'UNKNOWN_ROUTE');
      return;
    }
    if (pending.size >= maxPending) {
      reject(503, 'PROXY_QUEUE_FULL');
      return;
    }
    request.pause();
    const controller = new AbortController();
    const disconnected = () => {
      if (!response.writableFinished) {
        controller.abort(new ProxyError(499, 'CLIENT_DISCONNECTED'));
      }
    };
    const requestError = () => controller.abort(new ProxyError(499, 'CLIENT_DISCONNECTED'));
    let responseDone!: () => void;
    const ended = new Promise<void>((resolve) => {
      responseDone = resolve;
    });
    const endedResponse = () => {
      disconnected();
      responseDone();
    };
    response.once('finish', responseDone);
    response.once('close', endedResponse);
    response.once('error', endedResponse);
    request.once('aborted', requestError);
    request.on('error', requestError);
    const work = (async () => {
      try {
        const remainder = raw.slice(name.length + 1);
        const base = route.upstream.pathname.replace(/\/$/, '');
        const path = base + (remainder.startsWith('?') ? '/' + remainder : remainder) || '/';
        const execution = route.limiter.startExecution(
          ({ signal }) =>
            transfer(
              request,
              response,
              route.upstream,
              path,
              route.headers,
              signal,
              expectContinue,
            ),
          {
            signal: controller.signal,
            weight: route.weight,
            queueTimeoutMs: route.queueTimeoutMs,
            retrySafety: 'unsafe',
            policy: {
              classifierId: httpClassifierId,
              retry: { maxAttempts: 1 },
              deadlineMs: route.requestTimeoutMs,
              attemptTimeoutMs: null,
            },
            classifier: {
              id: httpClassifierId,
              classify: (result): Outcome =>
                result.status === 'fulfilled' ? result.value : { kind: 'neutral' },
            },
          },
        );
        try {
          await execution.result;
        } catch (error) {
          errorResponse(response, localError(error));
        } finally {
          await execution.finished;
        }
      } catch (error) {
        errorResponse(response, localError(error));
      } finally {
        if (!response.writableFinished && !response.destroyed) {
          await ended;
        }
        request.removeListener('aborted', requestError);
        request.removeListener('error', requestError);
        response.removeListener('finish', responseDone);
        response.removeListener('close', endedResponse);
        response.removeListener('error', endedResponse);
      }
    })();
    const tracked = work.finally(() => pending.delete(controller));
    pending.set(controller, tracked);
    void tracked.catch(() => {});
  };
  const server = createServer({ maxHeaderSize: 16384 }, accept);
  server.maxConnections = maxConnections;
  server.headersTimeout = 10000;
  server.requestTimeout = 0; // Accepted requests use the computed execution deadline.
  server.on('checkContinue', (request, response) => accept(request, response, true));
  for (const event of ['connect', 'upgrade'] as const) {
    server.on(event, (_request, socket) => {
      socket.end(
        'HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    });
  }
  const close = (closeOptions: { drain?: boolean } = {}): Promise<void> => {
    if (closing) {
      return closing;
    }
    stopping = true;
    const stopped = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    void stopped.catch(() => {});
    if (!closeOptions.drain) {
      for (const controller of pending.keys()) {
        controller.abort(new ProxyError(503, 'PROXY_CLOSING'));
      }
    }
    closing = (async () => {
      try {
        await Promise.all(pending.values());
      } finally {
        server.closeAllConnections();
        await stopped;
      }
    })();
    return closing;
  };
  await new Promise<void>((resolve, reject) => {
    const failure = (error: Error) => {
      server.removeListener('listening', ready);
      reject(error);
    };
    const ready = () => {
      server.removeListener('error', failure);
      resolve();
    };
    server.once('error', failure);
    server.once('listening', ready);
    server.listen(port, host);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Proxy failed to bind');
  }
  const authorityHost = host.includes(':') ? '[' + host + ']' : host;
  if (local) {
    for (const value of ['127.0.0.1', 'localhost', '[::1]']) {
      allowedHosts.add(authority(value + ':' + address.port));
    }
  }
  server.on('error', () => {
    void close().catch(() => {});
  });
  return {
    url: 'http://' + authorityHost + ':' + address.port,
    port: address.port,
    inspect: () => ({ pending: pending.size, closing: stopping }),
    close,
  };
}

function invalidTarget(value: string): boolean {
  if (!value.startsWith('/') || /[#\\]/.test(value)) {
    return true;
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) {
      return true;
    }
  }
  return false;
}
