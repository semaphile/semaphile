import {
  createMessagingInstrumentation,
  withMessageContext,
  type TraceCarrier,
} from './messaging.js';
// Explicit standalone SDK. Importing the library adapter never creates global
// providers, network exporters, timers, or an HTTP listener.
import { Socket } from 'node:net';
import type { Agent } from 'node:http';
import { metrics } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes, detectResources, envDetector } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { createPropagator } from './propagation.js';
import { createInstrumentation } from './index.js';
export async function startTelemetry(
  options: {
    serviceName?: string;
    instanceId?: string;
    baggageAllowlist?: string[];
    intervalMs?: number;
    shutdownTimeoutMs?: number;
    exportTimeoutMs?: number;
  } = {},
) {
  if (process.env.OTEL_SDK_DISABLED === 'true') {
    return {
      instrumentation: { start: () => ({}) },
      messagingInstrumentation: { start: () => ({}) },
      withMessageContext: <T>(_carrier: TraceCarrier, callback: () => T): T => callback(),
      meter: undefined,
      shutdown: async () => {},
    };
  }
  for (const suffix of ['', '_TRACES', '_METRICS']) {
    const protocol = process.env[`OTEL_EXPORTER_OTLP${suffix}_PROTOCOL`];
    if (protocol && protocol !== 'http/protobuf') {
      throw new Error('Semaphile CLI supports OTLP http/protobuf');
    }
  }
  const intervalMs = options.intervalMs ?? 15000;
  const exportTimeoutMs = options.exportTimeoutMs ?? 10000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1000;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1000 ||
    intervalMs > 2147483647 ||
    !Number.isSafeInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs < 1 ||
    shutdownTimeoutMs > 30000 ||
    !Number.isSafeInteger(exportTimeoutMs) ||
    exportTimeoutMs < 1 ||
    exportTimeoutMs > 300000
  ) {
    throw new Error('Invalid telemetry interval or timeout');
  }
  const resource = detectResources({ detectors: [envDetector] }).merge(
    resourceFromAttributes({
      ...(options.instanceId ? { 'service.instance.id': options.instanceId } : {}),
      'service.name': options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'semaphile',
    }),
  );
  // Export latency and shutdown grace are independent. Own the agents so the
  // shutdown deadline can close outstanding requests without shortening normal exports.
  const agents = new Map<string, Agent>();
  let exportsStopped = false;
  const httpAgentOptions = async (protocol: string): Promise<Agent> => {
    if (exportsStopped) {
      throw new Error('Telemetry exporter stopped');
    }
    let agent = agents.get(protocol);
    if (!agent) {
      const implementation =
        protocol === 'http:' ? await import('node:http') : await import('node:https');
      if (exportsStopped) {
        throw new Error('Telemetry exporter stopped');
      }
      agent = agents.get(protocol) ?? new implementation.Agent({ keepAlive: true });
      const connect = agent.createConnection.bind(agent);
      agent.createConnection = (connectionOptions, callback) => {
        if (exportsStopped) {
          queueMicrotask(() =>
            callback?.(new Error('Telemetry exporter stopped'), new Socket().destroy()),
          );
          return undefined;
        }
        return connect(connectionOptions, callback);
      };
      agents.set(protocol, agent);
    }
    return agent;
  };
  const tracer = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ timeoutMillis: exportTimeoutMs, httpAgentOptions }),
      ),
    ],
  });
  const meter = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ timeoutMillis: exportTimeoutMs, httpAgentOptions }),
        exportIntervalMillis: intervalMs,
        exportTimeoutMillis: Math.min(intervalMs, exportTimeoutMs),
      }),
    ],
  });
  tracer.register({ propagator: createPropagator(options.baggageAllowlist) });
  metrics.setGlobalMeterProvider(meter);
  let stopped: Promise<void> | undefined;
  return {
    instrumentation: createInstrumentation({
      tracer: tracer.getTracer('@semaphile/otel'),
      meter: meter.getMeter('@semaphile/otel'),
    }),
    messagingInstrumentation: createMessagingInstrumentation({
      tracer: tracer.getTracer('@semaphile/otel'),
      meter: meter.getMeter('@semaphile/otel'),
      baggageAllowlist: options.baggageAllowlist,
    }),
    withMessageContext: <T>(carrier: TraceCarrier, callback: () => T): T =>
      withMessageContext(carrier, callback, options.baggageAllowlist),
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
          exportsStopped = true;
          for (const agent of agents.values()) {
            for (const sockets of Object.values(agent.sockets)) {
              for (const socket of sockets ?? []) {
                socket.destroy(new Error('Telemetry exporter stopped'));
              }
            }
            agent.destroy();
          }
        }
      })());
    },
  };
}
