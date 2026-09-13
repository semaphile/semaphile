// Explicit standalone SDK. Importing the library adapter never creates global
// providers, network exporters, timers, or an HTTP listener.
import { metrics } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes, detectResources, envDetector } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { createInstrumentation } from './index.js';
export async function startTelemetry(
  options: { serviceName?: string; intervalMs?: number; shutdownTimeoutMs?: number } = {},
) {
  if (process.env.OTEL_SDK_DISABLED === 'true') {
    return { instrumentation: { start: () => ({}) }, meter: undefined, shutdown: async () => {} };
  }
  for (const suffix of ['', '_TRACES', '_METRICS']) {
    const protocol = process.env[`OTEL_EXPORTER_OTLP${suffix}_PROTOCOL`];
    if (protocol && protocol !== 'http/protobuf') {
      throw new Error('Semaphile CLI supports OTLP http/protobuf');
    }
  }
  const intervalMs = options.intervalMs ?? 15000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1000;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1000 ||
    intervalMs > 2147483647 ||
    !Number.isSafeInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs < 1 ||
    shutdownTimeoutMs > 30000
  ) {
    throw new Error('Invalid telemetry interval or shutdown timeout');
  }
  const resource = detectResources({ detectors: [envDetector] }).merge(
    resourceFromAttributes({
      ...(options.instanceId ? { 'service.instance.id': options.instanceId } : {}),
      'service.name': options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'semaphile',
    }),
  );
  const tracer = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ timeoutMillis: shutdownTimeoutMs })),
    ],
  });
  const meter = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ timeoutMillis: shutdownTimeoutMs }),
        exportIntervalMillis: intervalMs,
        exportTimeoutMillis: Math.min(intervalMs, shutdownTimeoutMs),
      }),
    ],
  });
  tracer.register();
  metrics.setGlobalMeterProvider(meter);
  let stopped: Promise<void> | undefined;
  return {
    instrumentation: createInstrumentation({
      tracer: tracer.getTracer('@semaphile/otel'),
      meter: meter.getMeter('@semaphile/otel'),
    }),
    meter: meter.getMeter('@semaphile/otel'),
    shutdown(): Promise<void> {
      return (stopped ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([tracer.shutdown(), meter.shutdown()]),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, shutdownTimeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      })());
    },
  };
}
