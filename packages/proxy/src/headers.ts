import { ProxyInputError } from './errors.js';
import { validateHeaderName, validateHeaderValue, type IncomingHttpHeaders } from 'node:http';

const hop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
export const privateHeaders = new Set([
  ...hop,
  'host',
  'expect',
  'x-semaphile-token',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);
export function cleanHeaders(
  input: IncomingHttpHeaders,
  request: boolean,
  connection?: string,
): Record<string, string | string[]> {
  const blocked = new Set(request ? privateHeaders : hop);
  // Connection can nominate otherwise ordinary fields as hop-by-hop.
  for (const name of (String(input.connection ?? '') + ',' + (connection ?? '')).split(',')) {
    blocked.add(name.trim().toLowerCase());
  }
  const output: Record<string, string | string[]> = Object.create(null);
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined && !blocked.has(name.toLowerCase())) {
      output[name.toLowerCase()] = Array.isArray(value) ? [...value] : value;
    }
  }
  return output;
}
export function overrideHeaders(input: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProxyInputError('Route headers must be an object');
  }
  const output: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(input)) {
    const normalized = name.toLowerCase();
    if (privateHeaders.has(normalized) || normalized === 'content-length') {
      throw new ProxyInputError('Route headers cannot override routing or framing');
    }
    if (typeof value !== 'string') {
      throw new ProxyInputError('Route header values must be strings');
    }
    // Keep invalid secret values out of diagnostics from Node's validators.
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch {
      throw new ProxyInputError('Invalid route header');
    }
    if (Object.hasOwn(output, normalized)) {
      throw new ProxyInputError('Duplicate route header');
    }
    output[normalized] = value;
  }
  return output;
}

export function cleanTrailers(
  input: IncomingHttpHeaders,
  request: boolean,
  original: IncomingHttpHeaders,
) {
  const result = cleanHeaders(input, request, original.connection);
  for (const name of ['content-length', 'host', 'authorization']) {
    delete result[name];
  }
  return result;
}
