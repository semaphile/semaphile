import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { createPropagator } from '../../packages/otel/dist/propagation.js';
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
  const { propagation, ROOT_CONTEXT, defaultTextMapSetter, defaultTextMapGetter } = createRequire(
    new URL('../../packages/otel/package.json', import.meta.url),
  )('@opentelemetry/api');
  const propagator = createPropagator(['tenant']);
  const bad = propagation.setBaggage(
    ROOT_CONTEXT,
    propagation.createBaggage({ tenant: { value: '\ud800' }, secret: { value: 'private' } }),
  );
  const carrier = {};
  assert.doesNotThrow(() => propagator.inject(bad, carrier, defaultTextMapSetter));
  assert.equal(carrier.baggage, undefined);
  const allowed = propagator.extract(
    ROOT_CONTEXT,
    { baggage: 'tenant=example,secret=private' },
    defaultTextMapGetter,
  );
  propagator.inject(allowed, carrier, defaultTextMapSetter);
  assert.equal(carrier.baggage, 'tenant=example');
  console.log(
    'PASS baggage policy drops malformed and unlisted values on injection and extraction',
  );
  await mkdir('.tmp/otel', { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/otel/sdk-config-'));
  const pool = await openLimiter({
    path: join(directory, 'pools/api'),
    config: { maxConcurrent: 1 },
  });
  await pool.close();
  await writeFile(
    join(directory, 'semaphile.json'),
    JSON.stringify({
      version: 1,
      directory: '.',
      telemetry: {
        enabled: true,
        serviceName: 'configured-observer',
        baggageAllowlist: ['tenant'],
        collector: { port: 0 },
      },
    }),
  );
  const collector = spawn(
    process.execPath,
    [resolve('packages/messaging/dist/src/cli.js'), 'telemetry', 'collect'],
    {
      cwd: directory,
      env: {
        ...process.env,
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const exited = once(collector, 'exit');
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Collector startup timeout')), 5000);
      collector.stdout.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      collector.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Collector exited before startup'));
      });
    });
    collector.kill('SIGTERM');
    assert.equal((await exited)[0], 0);
    assert(payloads.some((p) => p.body.includes(Buffer.from('configured-observer'))));
  } finally {
    if (collector.exitCode === null) {
      collector.kill('SIGKILL');
      await exited;
    }
  }
  console.log('PASS collector CLI forwards project service identity to its real OTLP exporter');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log('RESULT 3/3 passed');
