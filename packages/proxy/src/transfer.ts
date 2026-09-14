// Own both HTTP legs until they finish or close. Caller cancellation is handled
// separately by core; returning here permits core to release the actual lease.
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Outcome } from '@semaphile/core/client';
import { responseOutcome, transportOutcome } from '@semaphile/core/http-policy';
import { cleanHeaders } from './headers.js';
import { ProxyError, errorResponse, localError } from './errors.js';

export async function transfer(
  incoming: IncomingMessage,
  downstream: ServerResponse,
  target: URL,
  path: string,
  overrides: Record<string, string>,
  signal: AbortSignal,
  expectContinue: boolean,
): Promise<Outcome> {
  if (signal.aborted) {
    errorResponse(downstream, localError(signal.reason));
    return { kind: 'neutral' };
  }
  const headers = { ...cleanHeaders(incoming.headers, true), ...overrides };
  headers.via = headers.via ? String(headers.via) + ', 1.1 semaphile' : '1.1 semaphile';
  const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)({
    protocol: target.protocol,
    hostname: target.hostname.replace(/^\[|\]$/g, ''),
    port: target.port || undefined,
    method: incoming.method,
    path,
    headers,
    agent: false,
  });
  let outcome: Outcome = { kind: 'neutral' };
  let upstream: IncomingMessage | undefined;
  let upstreamClosed: Promise<void> | undefined;
  const requestClosed = new Promise<void>((resolve) => request.once('close', resolve));
  let endDownstream!: () => void;
  const downstreamDone = new Promise<void>((resolve) => {
    endDownstream = resolve;
  });
  const done = () => endDownstream();
  const failure = (error: unknown) => {
    outcome = signal.aborted ? { kind: 'neutral' } : transportOutcome(error, signal);
    errorResponse(downstream, new ProxyError(502, 'UPSTREAM_FAILURE'));
    request.destroy();
    upstream?.destroy();
  };
  const aborted = () => {
    outcome = { kind: 'neutral' };
    errorResponse(downstream, localError(signal.reason));
    request.destroy();
    upstream?.destroy();
  };
  const trailers = () => request.addTrailers(cleanHeaders(incoming.trailers, true));
  downstream.once('finish', done);
  downstream.once('close', done);
  downstream.on('error', done);
  incoming.on('error', failure);
  incoming.once('end', trailers);
  request.on('error', failure);
  request.on('upgrade', (_response, socket) => {
    socket.destroy();
    failure(new Error('Unsupported upstream upgrade'));
  });
  request.once('response', (response) => {
    upstream = response;
    upstreamClosed = new Promise<void>((resolve) => response.once('close', resolve));
    if (signal.aborted || downstream.destroyed || downstream.writableEnded) {
      response.destroy();
      request.destroy();
      return;
    }
    const status = response.statusCode ?? 502;
    if (status < 200 || status > 599) {
      failure(new Error('Invalid upstream status'));
      return;
    }
    outcome = responseOutcome(
      new Response(null, {
        status,
        headers:
          response.headers['retry-after'] === undefined
            ? undefined
            : { 'retry-after': String(response.headers['retry-after']) },
      }),
    );
    response.on('error', failure);
    response.once('aborted', () =>
      failure(Object.assign(new Error('Truncated upstream'), { code: 'ECONNRESET' })),
    );
    response.once('end', () => {
      if (!downstream.destroyed) {
        downstream.addTrailers(cleanHeaders(response.trailers, false));
      }
    });
    const outgoing = cleanHeaders(response.headers, false);
    outgoing.via = outgoing.via ? String(outgoing.via) + ', 1.1 semaphile' : '1.1 semaphile';
    // An early final response must close an unfinished downstream upload.
    if (!incoming.complete) {
      outgoing.connection = 'close';
    }
    downstream.writeHead(status, outgoing);
    downstream.flushHeaders();
    response.pipe(downstream);
  });
  signal.addEventListener('abort', aborted, { once: true });
  try {
    if (expectContinue) {
      downstream.writeContinue();
    }
    incoming.pipe(request);
    if (signal.aborted) {
      aborted();
    }
    await downstreamDone;
  } finally {
    incoming.unpipe(request);
    incoming.removeListener('error', failure);
    incoming.removeListener('end', trailers);
    signal.removeEventListener('abort', aborted);
    request.destroy();
    upstream?.destroy();
    await Promise.all([requestClosed, upstreamClosed]);
    downstream.removeListener('finish', done);
    downstream.removeListener('close', done);
    downstream.removeListener('error', done);
  }
  return outcome;
}
