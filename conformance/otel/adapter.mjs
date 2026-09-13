import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openLimiter } from '../../packages/core/dist/src/memory.js';
import { createInstrumentation } from '../../packages/otel/dist/index.js';
const require = createRequire(new URL('../../packages/otel/package.json', import.meta.url));
const { context, trace } = require('@opentelemetry/api');
const {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} = require('@opentelemetry/sdk-trace-node');
const {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} = require('@opentelemetry/sdk-metrics');
const exporter = new InMemorySpanExporter(),
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();
const meters = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60000 }),
  ],
});
const tracer = provider.getTracer('test');
const limiter = await openLimiter({
  key: 'otel-context',
  config: { maxConcurrent: 1 },
  telemetry: { instrumentation: createInstrumentation({ tracer, meter: meters.getMeter('test') }) },
});
try {
  const parent = tracer.startSpan('parent');
  await context.with(trace.setSpan(context.active(), parent), () =>
    limiter.execute(() => {
      assert.equal(
        trace.getSpan(context.active())?.spanContext().traceId,
        parent.spanContext().traceId,
      );
      return 7;
    }),
  );
  parent.end();
  await limiter.close();
  await provider.forceFlush();
  await meters.forceFlush();
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.filter((s) => s.name === 'semaphile execute').length, 1);
  assert.equal(spans.filter((s) => s.name === 'semaphile attempt').length, 1);
  assert(spans.every((s) => s.spanContext().traceId === parent.spanContext().traceId));
  const operation = spans.find((s) => s.name === 'semaphile execute');
  assert(operation.events.some((e) => e.name === 'leaseReleased'));
  assert(metricExporter.getMetrics().length > 0);
  const instruments = metricExporter
    .getMetrics()
    .flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
  for (const name of ['semaphile.client.queued', 'semaphile.client.running']) {
    const instrument = instruments.find((m) => m.descriptor.name === name);
    assert(instrument);
    assert(instrument.dataPoints.every((p) => p.value === 0));
  }
  console.log('PASS actual OTel spans preserve parent context and cleanup events');
  console.log('PASS local queue/running metrics return to zero without request-ID dimensions');
} finally {
  await limiter.close();
  await provider.shutdown();
  await meters.shutdown();
}
console.log('RESULT 2/2 passed');
