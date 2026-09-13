// Enforce the same bounded baggage policy on extraction and injection. Never
// let an SDK's default propagator silently opt application secrets into export.
import {
  propagation,
  diag,
  type Context,
  type TextMapPropagator,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator, W3CBaggagePropagator } from '@opentelemetry/core';
export function createPropagator(allowlist: readonly string[] = []): TextMapPropagator {
  if (
    !Array.isArray(allowlist) ||
    allowlist.length > 64 ||
    allowlist.some((key) => typeof key !== 'string' || !key || key.length > 128)
  ) {
    throw new Error('Invalid baggage allowlist');
  }
  const allowed = new Set(allowlist),
    trace = new W3CTraceContextPropagator(),
    baggage = new W3CBaggagePropagator();
  const filter = (ctx: Context) => {
    const entries: Record<string, { value: string }> = {};
    let size = 0;
    for (const [key, entry] of propagation.getBaggage(ctx)?.getAllEntries() ?? []) {
      if (!allowed.has(key)) {
        continue;
      }
      let bytes: number;
      try {
        if (typeof entry.value !== 'string') {
          continue;
        }
        bytes =
          Buffer.byteLength(encodeURIComponent(key) + '=' + encodeURIComponent(entry.value)) + 1;
      } catch {
        try {
          diag.warn('Semaphile dropped invalid baggage');
        } catch {
          /* Diagnostics are isolated. */
        }
        continue;
      }
      if (bytes > 1024 || size + bytes > 4096) {
        continue;
      }
      size += bytes;
      entries[key] = { value: entry.value };
    }
    return propagation.setBaggage(ctx, propagation.createBaggage(entries));
  };
  return {
    fields: () => ['traceparent', 'tracestate', 'baggage'],
    inject<C>(ctx: Context, carrier: C, setter: TextMapSetter<C>) {
      trace.inject(ctx, carrier, setter);
      baggage.inject(filter(ctx), carrier, setter);
    },
    extract<C>(ctx: Context, carrier: C, getter: TextMapGetter<C>) {
      const safeGetter: TextMapGetter<C> = {
        keys: (value) => getter.keys(value),
        get: (value, key) => {
          const raw = getter.get(value, key);
          const text = Array.isArray(raw) ? raw.join(',') : raw;
          const limit = key === 'baggage' ? 4096 : key === 'tracestate' ? 512 : 256;
          return text && Buffer.byteLength(text) <= limit ? text : undefined;
        },
      };
      return filter(baggage.extract(trace.extract(ctx, carrier, safeGetter), carrier, safeGetter));
    },
  };
}
