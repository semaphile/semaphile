import { Worker } from 'node:worker_threads';
import type { ExportResult } from '@opentelemetry/core';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-node';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { packSpan, packResource } from './export-wire.js';
/** Keep provider batching local, but isolate exporter-owned retries and sockets. */
export async function startExportBridge(timeoutMs: number) {
  const worker = new Worker(new URL('./export-worker.js', import.meta.url), {
    workerData: { timeoutMs },
    execArgv: [],
  });
  const pending = new Map<
    number,
    { callback: (result: ExportResult) => void; done: () => void; finished: Promise<void> }
  >();
  let next = 0,
    stopped = false;
  let closing: Promise<void> | undefined;
  const fail = () => {
    stopped = true;
    for (const entry of pending.values()) {
      entry.callback({ code: 1, error: new Error('Telemetry export stopped') });
      entry.done();
    }
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', fail);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Telemetry exporter startup timed out')),
        5000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        worker.removeListener('message', ready);
        worker.removeListener('error', errorEvent);
        worker.removeListener('exit', exit);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const ready = (message: { ready?: boolean }) => {
        if (message.ready) {
          finish();
        }
      };
      const errorEvent = () => finish(new Error('Telemetry exporter startup failed'));
      const exit = () => finish(new Error('Telemetry exporter exited during startup'));
      worker.on('message', ready);
      worker.once('error', errorEvent);
      worker.once('exit', exit);
    });
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  worker.unref();
  worker.on('message', (message: { id: number; code: number }) => {
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    entry.callback(
      message.code === 0 ? { code: 0 } : { code: 1, error: new Error('Telemetry export failed') },
    );
    entry.done();
    if (!pending.size) {
      worker.unref();
    }
  });
  const send = (kind: string, data: () => unknown, callback: (result: ExportResult) => void) => {
    if (stopped || pending.size >= 64) {
      callback({ code: 1, error: new Error('Telemetry exporter unavailable') });
      return;
    }
    const id = ++next;
    let done!: () => void;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    pending.set(id, { callback, done, finished });
    worker.ref();
    try {
      worker.postMessage({ id, kind, data: data() });
    } catch {
      pending.delete(id);
      callback({ code: 1, error: new Error('Telemetry export serialization failed') });
      done();
      if (!pending.size) {
        worker.unref();
      }
    }
  };
  const flush = async () => {
    await Promise.all([...pending.values()].map((entry) => entry.finished));
  };
  const selector = new OTLPMetricExporter({ timeoutMillis: timeoutMs });
  const traces: SpanExporter = {
    export: (spans: ReadableSpan[], callback) =>
      send('traces', () => spans.map(packSpan), callback),
    shutdown: flush,
    forceFlush: flush,
  };
  const metrics: PushMetricExporter = {
    export: (data: ResourceMetrics, callback) =>
      send('metrics', () => ({ ...data, resource: packResource(data.resource) }), callback),
    shutdown: flush,
    forceFlush: flush,
    selectAggregation: (type) => selector.selectAggregation(type),
    selectAggregationTemporality: (type) => selector.selectAggregationTemporality(type),
  };
  return {
    traces,
    metrics,
    close: () =>
      (closing ??= (async () => {
        fail();
        await worker.terminate();
        await selector.shutdown();
      })()),
  };
}
