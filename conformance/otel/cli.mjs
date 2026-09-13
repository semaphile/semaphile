import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openLimiter } from '../../packages/core/dist/src/index.js';
await mkdir('.tmp/otel', { recursive: true });
const root = await mkdtemp(resolve('.tmp/otel/cli-'));
const pools = await Promise.all(
  ['api-a', 'api-b'].map((name) =>
    openLimiter({ path: join(root, name), config: { maxConcurrent: 1 } }),
  ),
);
const children = [];
function launch(args = []) {
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      'packages/messaging/dist/src/cli.js',
      'telemetry',
      'collect',
      '--root',
      root,
      '--port',
      '0',
      ...args,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const record = { child, output: '', errors: '', exited: once(child, 'exit') };
  children.push(record);
  child.stderr.on('data', (data) => {
    record.errors = (record.errors + data).slice(-32000);
  });
  record.ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Collector CLI startup timed out')), 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(Error(record.errors));
    });
    child.stdout.on('data', (data) => {
      record.output += data;
      if (record.output.includes('\n')) {
        clearTimeout(timeout);
        resolve(JSON.parse(record.output.split('\n')[0]));
      }
    });
  });
  void record.ready.catch(() => {});
  return record;
}
async function stop(record, signal = 'SIGTERM') {
  if (record.child.exitCode === null && record.child.signalCode === null) {
    record.child.kill(signal);
    await record.exited;
  }
}
try {
  const first = launch(['--include', 'api-a']),
    ready = await first.ready;
  const conflict = launch();
  const [code] = await conflict.exited;
  assert.equal(code, 4);
  assert(conflict.errors.includes(ready.collectorId));
  assert(conflict.errors.includes('api-a'));
  const other = launch(['--include', 'api-b']);
  await other.ready;
  await stop(other);
  console.log('PASS CLI reports conflicting ownership and releases partial startup registrations');
  const overlap = launch([
    '--include',
    'api-*',
    '--include',
    'unmatched',
    '--exclude',
    'api-b',
    '--allow-overlap',
  ]);
  const info = await overlap.ready;
  assert(overlap.errors.includes('duplicate shared metrics'));
  const response = await fetch(`http://127.0.0.1:${info.address.port}/metrics`);
  assert.equal(response.status, 200);
  const metrics = await response.text();
  assert(metrics.includes('api-a'));
  assert(!metrics.includes('api-b'));
  await stop(first, 'SIGKILL');
  await stop(overlap);
  const recovered = launch(['--pool', 'api-a']);
  await recovered.ready;
  await stop(recovered);
  console.log(
    'PASS CLI override exports selected metrics; SIGKILL releases local collector ownership',
  );
} finally {
  await Promise.allSettled(children.map((child) => stop(child)));
  await Promise.all(pools.map((pool) => pool.close()));
}
console.log('RESULT 2/2 passed');
