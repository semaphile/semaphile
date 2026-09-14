import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Exporter test deadline')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const idle = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import { startTelemetry } from './packages/otel/dist/sdk.js'; await startTelemetry(); console.log('idle');",
  ],
  { encoding: 'utf8', timeout: 2500 },
);
assert.equal(idle.status, 0, idle.stdout + idle.stderr + String(idle.error ?? ''));
assert.match(idle.stdout, /idle/);
console.log('PASS an idle exporter worker does not retain the process');
let retrying = false,
  retryChild,
  sawRetry;
const retryReceived = new Promise((resolve) => {
  sawRetry = resolve;
});
const completed = new Set();
let allDone;
const delivered = new Promise((resolve) => {
  allDone = resolve;
});
const timers = new Set();
const server = createServer((request, response) => {
  request.resume();
  request.once('end', () => {
    if (retrying) {
      response.writeHead(503, { 'retry-after': '3' });
      response.end();
      sawRetry();
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!response.destroyed) {
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end();
        completed.add(request.url);
        if (completed.has('/v1/traces') && completed.has('/v1/metrics')) {
          allDone();
        }
      }
    }, 1500);
    timers.add(timer);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const code = `
import { startTelemetry } from './packages/otel/dist/sdk.js';
import { openLimiter } from './packages/core/dist/src/memory.js';
const sdk = await startTelemetry({ intervalMs: 2000, shutdownTimeoutMs: 100 });
const limiter = await openLimiter({ key: 'slow-export', config: { maxConcurrent: 1 }, telemetry: { instrumentation: sdk.instrumentation } });
await limiter.schedule(() => 42); await limiter.close();
await new Promise(resolve => process.stdin.once('data', resolve));
process.stdin.destroy(); await sdk.shutdown();
`;
const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
  env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:' + server.address().port },
  stdio: ['pipe', 'inherit', 'inherit'],
});
const exited = once(child, 'exit');
let timeout;
try {
  await Promise.race([
    delivered,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Slow exporter did not deliver both signals')),
        12000,
      );
    }),
    exited.then(() => {
      throw new Error('Exporter exited before delivery');
    }),
  ]);
  console.log(
    'PASS trace and metric exports survive 1.5-second latency despite 100ms shutdown grace',
  );
  const start = performance.now();
  child.stdin.end('stop');
  const [status] = await within(exited, 1500);
  assert.equal(status, 0);
  assert.ok(performance.now() - start < 1500);
  console.log('PASS bounded shutdown closes outstanding exporter sockets');
  retrying = true;
  retryChild = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:' + server.address().port,
    },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const retryExit = once(retryChild, 'exit');
  await within(
    Promise.race([
      retryReceived,
      retryExit.then(() => {
        throw new Error('Retry exporter exited before receipt');
      }),
    ]),
    12000,
  );
  const beforeRetryClose = performance.now();
  retryChild.stdin.end('stop');
  assert.equal((await within(retryExit, 1500))[0], 0);
  assert.ok(performance.now() - beforeRetryClose < 1500);
  console.log('PASS shutdown terminates SDK Retry-After timers before the child exits');
} finally {
  clearTimeout(timeout);
  for (const timer of timers) {
    clearTimeout(timer);
  }
  if (retryChild?.exitCode === null) {
    retryChild.kill('SIGKILL');
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log('RESULT 4/4 passed');
