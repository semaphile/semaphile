// Wire validation is independent of OTel. Trace data is optional metadata,
// never application content or deduplication identity.
import { MessagingError } from './config.js';
export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}
export function validateTrace(value: unknown): TraceCarrier | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new MessagingError('INPUT', 'Invalid trace carrier');
  }
  const result: TraceCarrier = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !['traceparent', 'tracestate', 'baggage'].includes(key) ||
      typeof entry !== 'string' ||
      /[\r\n\0]/.test(entry)
    ) {
      throw new MessagingError('INPUT', 'Invalid trace carrier');
    }
    const limit = key === 'traceparent' ? 256 : key === 'tracestate' ? 512 : 4096;
    if (Buffer.byteLength(entry) > limit) {
      throw new MessagingError('INPUT', 'Trace carrier exceeds bound');
    }
    if (
      key === 'traceparent' &&
      (!/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/.test(entry) ||
        /^00-0{32}-/.test(entry) ||
        /^00-[a-f0-9]{32}-0{16}-/.test(entry))
    ) {
      throw new MessagingError('INPUT', 'Invalid traceparent');
    }
    result[key as keyof TraceCarrier] = entry;
  }
  return Object.keys(result).length ? result : undefined;
}
/** Filter baggage at the client boundary as well as in an OTel propagator. */
export function filterTrace(
  value: TraceCarrier | undefined,
  allowlist: readonly string[] = [],
): TraceCarrier | undefined {
  const result = validateTrace(value);
  if (!result) {
    return undefined;
  }
  if (result.baggage) {
    const allowed = new Set(allowlist);
    const entries = result.baggage.split(',').filter((item) => {
      const key = item.split('=', 1)[0]?.trim();
      return key && allowed.has(key) && item.includes('=');
    });
    if (entries.length) {
      result.baggage = entries.join(',');
    } else {
      delete result.baggage;
    }
  }
  return result;
}
