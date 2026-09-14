import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const completed = new Set();
let allDone;
const delivered = new Promise((resolve) => {
  allDone = resolve;
});
const timers = new Set();
const server = createServer((request, response) => {
  request.resume();
  request.once('end', () => {
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
  const [status] = await exited;
  assert.equal(status, 0);
  assert.ok(performance.now() - start < 1500);
  console.log('PASS bounded shutdown closes outstanding exporter sockets');
} finally {
  clearTimeout(timeout);
  for (const timer of timers) {
    clearTimeout(timer);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log('RESULT 2/2 passed');
