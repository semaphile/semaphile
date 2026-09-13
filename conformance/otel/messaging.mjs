import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openMessaging, commandHandler } from '../../packages/messaging/dist/src/index.js';
import { createMessagingInstrumentation } from '../../packages/otel/dist/messaging.js';
const require = createRequire(new URL('../../packages/otel/package.json', import.meta.url));
const { context, trace, propagation, SpanStatusCode } = require('@opentelemetry/api');
const {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} = require('@opentelemetry/sdk-trace-node');
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();
const tracer = provider.getTracer('test');
await mkdir('.tmp/otel', { recursive: true });
const root = await mkdtemp(resolve('.tmp/otel/messaging-'));
const telemetry = {
  baggageAllowlist: ['tenant'],
  instrumentation: createMessagingInstrumentation({ tracer, baggageAllowlist: ['tenant'] }),
};
const client = await openMessaging({
  path: join(root, 'store'),
  config: { retryDelayMs: 1 },
  telemetry,
});
let listener;
try {
  await client.createMailbox('worker');
  const parent = tracer.startSpan('sender');
  const ctx = propagation.setBaggage(
    trace.setSpan(context.active(), parent),
    propagation.createBaggage({ tenant: { value: 'public' }, secret: { value: 'private' } }),
  );
  await context.with(ctx, () =>
    client.send({
      to: 'worker',
      body: 'do not record me',
      dedupeKey: 'key',
      ackMode: 'handler-success',
      correlationId: 'conversation',
    }),
  );
  parent.end();
  const ambient = tracer.startSpan('listener-parent');
  let handled;
  const done = new Promise((resolve) => {
    handled = resolve;
  });
  listener = context.with(trace.setSpan(context.active(), ambient), () =>
    client.listen(
      'worker',
      async (delivery) => {
        const current = trace.getSpan(context.active());
        assert(current);
        assert.equal(current.spanContext().traceId, ambient.spanContext().traceId);
        assert.equal(propagation.getBaggage(context.active()).getEntry('tenant').value, 'public');
        assert.equal(propagation.getBaggage(context.active()).getEntry('secret'), undefined);
        if (delivery.attempt === 1) {
          throw Error('first attempt');
        }
        handled();
      },
      { onError: () => {} },
    ),
  );
  await done;
  await listener.close();
  listener = undefined;
  ambient.end();
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  const sender = spans.find((s) => s.name === 'semaphile message send');
  const processing = spans.filter((s) => s.name === 'semaphile message process');
  assert.equal(processing.length, 2);
  assert.equal(processing[0].status.code, SpanStatusCode.ERROR);
  for (const span of processing) {
    assert.equal(span.parentSpanContext.spanId, ambient.spanContext().spanId);
    assert.equal(span.links[0].context.spanId, sender.spanContext().spanId);
  }
  assert.equal(spans.filter((s) => s.name === 'semaphile message ack').length, 1);
  assert(
    !JSON.stringify(spans.map((s) => ({ attributes: s.attributes, events: s.events }))).includes(
      'do not record me',
    ),
  );
  console.log(
    'PASS redelivered handlers get distinct linked spans with ambient parents and isolated baggage',
  );
  const script = join(root, 'handler.mjs'),
    output = join(root, 'environment.json');
  await writeFile(
    script,
    `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({traceparent:process.env.TRACEPARENT,tracestate:process.env.TRACESTATE,baggage:process.env.BAGGAGE}));`,
  );
  process.env.TRACEPARENT = 'stale';
  process.env.TRACESTATE = 'stale';
  process.env.BAGGAGE = 'secret=stale';
  await client.send({ to: 'worker', body: 'child', ackMode: 'handler-success' });
  const received = await client.wait('worker', { ackMode: 'handler-success', timeoutMs: 1000 });
  await client.processDelivery(received, () =>
    commandHandler([process.execPath, script, output])(received, {
      signal: new AbortController().signal,
      ack: () => client.ack(received.receipt),
      release: () => client.release(received.receipt),
    }),
  );
  const carrier = JSON.parse(await readFile(output, 'utf8'));
  assert.match(carrier.traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  assert.equal(carrier.tracestate, undefined);
  assert.equal(carrier.baggage, undefined);
  await commandHandler([process.execPath, script, output])(received, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {});
  await client.ack(received.receipt);
  console.log(
    'PASS handler subprocess receives current processing context and clears stale inherited fields',
  );
  await client.createMailbox('loss');
  const lostMessage = await client.send({
    to: 'loss',
    body: 'renewal loss',
    ackMode: 'handler-success',
  });
  const originalRenew = client.renew;
  client.renew = async () => ({ status: 'stale' });
  let abortObserved;
  const aborted = new Promise((resolve) => {
    abortObserved = resolve;
  });
  listener = client.listen(
    'loss',
    async (_delivery, { signal }) => {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      abortObserved();
    },
    { claimTtlMs: 300, onError: () => {} },
  );
  await aborted;
  await listener.close();
  listener = undefined;
  client.renew = originalRenew;
  await provider.forceFlush();
  const lostSpan = exporter
    .getFinishedSpans()
    .find(
      (span) =>
        span.name === 'semaphile message process' &&
        span.attributes['messaging.message.id'] === lostMessage.id,
    );
  assert.equal(lostSpan.status.code, SpanStatusCode.ERROR);
  console.log('PASS renewal claim loss remains an error when the handler returns after abort');
} finally {
  await listener?.close({ cancel: true });
  await client.close();
  await provider.shutdown();
}
console.log('RESULT 3/3 passed');
