import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { server } from './harness.mjs';
const redis = await server();
await mkdir('.tmp/redis', { recursive: true });
const root = await mkdtemp(resolve('.tmp/redis/cli-'));
const cli = resolve('packages/messaging/dist/src/cli.js'),
  store = randomUUID();
const selectors = [
  '--redis-url-env',
  'SEMAPHILE_REDIS_TEST',
  '--namespace',
  'cli',
  '--messaging-store',
  store,
];
const run = (args, stdin = '', explicit = true) =>
  new Promise((yes, no) => {
    const child = spawn(
      process.execPath,
      ['--no-warnings', cli, ...args, ...(explicit ? selectors : [])],
      {
        cwd: root,
        env: { ...process.env, SEMAPHILE_REDIS_TEST: redis.url },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.once('error', no);
    child.once('exit', (code) => yes({ code, out, err }));
    child.stdin.end(stdin);
  });
const ok = async (args, stdin, explicit) => {
  const r = await run(args, stdin, explicit);
  assert.equal(r.code, 0, r.err);
  return r.out ? JSON.parse(r.out) : null;
};
try {
  await ok(['message', 'create', '--name', 'q']);
  await ok(['message', 'send', '--to', 'q', '--body-file', '-'], 'stdin body');
  const d = await ok(['message', 'wait', '--as', 'q', '--timeout', '1000']);
  assert.equal(d.message.body, 'stdin body');
  assert.equal(
    (await ok(['message', 'ack', '--receipt-file', '-'], JSON.stringify(d))).status,
    'acked',
  );
  console.log('PASS explicit Redis selectors, body stdin, and receipt stdin cross CLI processes');
  await ok(['message', 'subscribe', '--name', 'relay', '--topics', 'question,turn']);
  await ok(['message', 'publish', '--topic', 'question', '--body', 'question']);
  const td = await ok(['message', 'wait', '--subscription', 'relay', '--timeout', '1000']);
  assert.equal(td.message.body, 'question');
  await ok(['message', 'ack', '--receipt-file', '-'], JSON.stringify(td));
  assert.equal((await ok(['message', 'subscriptions'])).length, 1);
  console.log('PASS topic subscribe publish wait and ack operate through the CLI');
  assert.equal((await run(['message', 'agents', '--store', 'local'])).code, 5);
  assert.equal((await run(['message', 'upgrade'])).code, 5);
  console.log('PASS mixed backend selectors and Redis offline upgrades are refused');
  await writeFile(
    join(root, 'semaphile.json'),
    JSON.stringify({
      version: 1,
      messaging: {
        backend: 'redis',
        redis: { urlEnv: 'SEMAPHILE_REDIS_TEST', namespace: 'cli', store },
      },
    }),
  );
  await ok(['message', 'send', '--to', 'q', '--body', 'configured'], '', false);
  const info = await ok(['info'], '', false);
  assert.equal(info.stores[0].backend, 'redis');
  await ok(['init'], '', false);
  assert.deepEqual(await readdir(root), ['semaphile.json']);
  console.log(
    'PASS Redis-only config supports discovery info and init without creating local storage',
  );
  await writeFile(
    join(root, 'semaphile.json'),
    JSON.stringify({
      version: 1,
      messaging: {
        backend: 'redis',
        redis: { urlEnv: 'SEMAPHILE_REDIS_TEST', namespace: 'cli', store },
        config: { maxAttempts: 99 },
        clientDefaults: { configMismatch: 'error' },
      },
    }),
  );
  const drift = await ok(['info'], '', false);
  assert.deepEqual(drift.stores[0].differences, [
    { field: 'maxAttempts', expected: 99, actual: 5 },
  ]);
  assert.equal((await run(['message', 'agents'], '', false)).code, 4);
  assert.equal((await ok(['info'])).config.maxAttempts, 5);
  console.log('PASS inspection reports strict config drift without changing the Redis store');
  console.log('RESULT 5/5 passed');
} finally {
  await redis.close();
}
