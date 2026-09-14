// All exporter retry timers and network handles live here, so a shutdown deadline
// can terminate them without patching SDK internals or changing normal timeouts.
import { parentPort, workerData } from 'node:worker_threads';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { unpackSpan, unpackResource, type packSpan, type packResource } from './export-wire.js';
const traces = new OTLPTraceExporter({ timeoutMillis: workerData.timeoutMs });
const metrics = new OTLPMetricExporter({ timeoutMillis: workerData.timeoutMs });
type Message = { id: number } & (
  | { kind: 'traces'; data: ReturnType<typeof packSpan>[] }
  | {
      kind: 'metrics';
      data: Omit<ResourceMetrics, 'resource'> & { resource: ReturnType<typeof packResource> };
    }
);
parentPort!.on('message', (message: Message) => {
  const done = (result: { code: number }) =>
    parentPort!.postMessage({ id: message.id, code: result.code });
  try {
    if (message.kind === 'traces') {
      traces.export(message.data.map(unpackSpan), done);
    } else {
      metrics.export({ ...message.data, resource: unpackResource(message.data.resource) }, done);
    }
  } catch {
    done({ code: 1 });
  }
});
parentPort!.postMessage({ ready: true });
