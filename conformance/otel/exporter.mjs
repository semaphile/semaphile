import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const payloads = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    payloads.push({ path: request.url, body: Buffer.concat(chunks) });
    response.writeHead(200, { 'content-type': 'application/x-protobuf' });
    response.end();
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const code = `import {startTelemetry} from './packages/otel/dist/sdk.js';
 import {openLimiter} from './packages/core/dist/src/memory.js';
 const { createRequire } = await import('node:module');
 const { propagation, ROOT_CONTEXT, defaultTextMapGetter, defaultTextMapSetter } = createRequire(new URL('./packages/otel/package.json', import.meta.url))('@opentelemetry/api');
 const sdk=await startTelemetry();
 const ctx = propagation.extract(ROOT_CONTEXT, { baggage: 'secret=private-value' }, defaultTextMapGetter);
 const carrier = {}; propagation.inject(ctx, carrier, defaultTextMapSetter);
 if (carrier.baggage) throw Error('Default baggage leaked');

 const limiter=await openLimiter({key:'export',config:{maxConcurrent:1},telemetry:{instrumentation:sdk.instrumentation}});
 await limiter.schedule(()=>42);await limiter.close();await sdk.shutdown();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const [status] = await once(child, 'exit');
  assert.equal(status, 0);
  assert(
    payloads.some(
      (p) => p.path === '/v1/traces' && p.body.includes(Buffer.from('semaphile schedule')),
    ),
  );
  assert(
    payloads.some(
      (p) => p.path === '/v1/metrics' && p.body.includes(Buffer.from('semaphile.client.events')),
    ),
  );
  console.log('PASS standalone SDK exports real OTLP protobuf traces and metrics');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log('RESULT 1/1 passed');
