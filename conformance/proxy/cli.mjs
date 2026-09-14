import assert from 'node:assert/strict';
import { once } from 'node:events';
import { nativePath } from '../../packages/core/dist/src/native-path.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { suite, deferred } from '../typescript/fixtures/cases.mjs';
const { test, run } = suite();
await mkdir('.tmp/proxy', { recursive: true });
const root = await mkdtemp(resolve('.tmp/proxy/cli-'));
const entry = resolve('packages/proxy/dist/cli.js');
const children = [];
const redis =
  process.env.SEMAPHILE_PROXY_BACKEND === 'redis'
    ? await (await import('../redis/harness.mjs')).server()
    : undefined;
function launch(args, env = {}, executable = entry) {
  const child = spawn(process.execPath, [executable, ...args], {
    cwd: root,
    env: { ...process.env, ...(redis ? { PROXY_TEST_REDIS_URL: redis.url } : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '',
    stderr = '';
  const ready = deferred();
  child.stdout.on('data', (data) => {
    stdout += data;
    if (stdout.includes('\n')) {
      try {
        ready.resolve(JSON.parse(stdout.split('\n')[0]));
      } catch {
        /* Help output isn't a listener announcement. */
      }
    }
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return {
    child,
    ready: Promise.race([
      ready.promise,
      done.then((output) => {
        throw new Error(JSON.stringify(output));
      }),
    ]),
    done,
  };
}
async function config(name, value) {
  const file = resolve(root, name + '.json');
  await writeFile(file, JSON.stringify(value));
  return file;
}
const firstStarted = deferred(),
  finishFirst = deferred();
let active = 0,
  peak = 0,
  calls = 0;
const upstream = createServer(async (req, res) => {
  active++;
  peak = Math.max(peak, active);
  calls++;
  try {
    if (req.url === '/hold') {
      firstStarted.resolve();
      await finishFirst.promise;
    }
    res.end(req.headers.authorization ?? 'ok');
  } finally {
    active--;
  }
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamUrl = 'http://127.0.0.1:' + upstream.address().port;
const shared = redis
  ? {
      backend: 'redis',
      urlEnv: 'PROXY_TEST_REDIS_URL',
      pool: root,
      ownerTimeoutMs: 3000,
      config: { maxConcurrent: 1 },
    }
  : { backend: 'sqlite', path: './shared-pool', config: { maxConcurrent: 1 } };
test(
  'two CLI processes share a ' +
    (redis ? 'Redis' : 'relative SQLite') +
    ' pool and drain on SIGTERM',
  async () => {
    const file = await config('shared', {
      version: 1,
      port: 0,
      routes: [
        {
          name: 'api',
          upstream: upstreamUrl,
          pool: shared,
          headersEnv: { authorization: 'PROXY_TEST_AUTH' },
        },
      ],
    });
    const a = launch(['--config', file, '--drain'], { PROXY_TEST_AUTH: 'Bearer test-only' });
    const b = launch(['--config', file], { PROXY_TEST_AUTH: 'Bearer test-only' });
    const [aa, bb] = await Promise.all([a.ready, b.ready]);
    const first = fetch(aa.listening + '/api/hold').then((r) => r.text());
    await firstStarted.promise;
    const second = fetch(bb.listening + '/api').then((r) => r.text());
    a.child.kill('SIGTERM');
    finishFirst.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['Bearer test-only', 'Bearer test-only']);
    assert.equal(peak, 1);
    assert.equal(calls, 2);
    assert.equal((await a.done).code, 0);
    b.child.kill('SIGTERM');
    assert.equal((await b.done).code, 0);
    if (!redis) {
      await access(resolve(root, 'shared-pool'));
    }
  },
);
test('invalid config and missing environment fail without leaking values', async () => {
  const secret = 'this-value-must-not-appear';
  for (const value of [
    { version: 2, routes: [], secret },
    {
      version: 1,
      routes: [
        {
          name: 'api',
          upstream: 'http://user:' + secret + '@localhost',
          pool: { backend: 'memory', key: 'bad', config: { maxConcurrent: 1 } },
        },
      ],
    },
    { version: 1, tokenEnv: 'PROXY_MISSING_ENV', routes: [] },
    {
      version: 1,
      routes: [
        { name: 'api', upstream: upstreamUrl, pool: { ...shared, config: { maxConcurrent: 2 } } },
      ],
    },
  ]) {
    const file = await config('invalid', value);
    const child = launch(['--config', file]);
    // This case expects failure rather than a listening record.
    child.ready.catch(() => {});
    const output = await child.done;
    assert.equal(output.code, 1);
    assert.ok(!output.stderr.includes(secret));
    assert.equal(output.stdout, '');
  }
});

test('delegated CLI redacts malformed config input and provides help', async () => {
  const file = resolve(root, 'secret.json');
  await writeFile(file, 'SECRET_THAT_MUST_NOT_APPEAR');
  const delegated = resolve('packages/messaging/dist/src/cli.js');
  const child = launch(['proxy', 'http', '--config', file], {}, delegated);
  child.ready.catch(() => {});
  const output = await child.done;
  assert.equal(output.code, 4);
  assert.ok(!output.stderr.includes('SECRET_THAT'));
  assert.match(output.stderr, /HTTP proxy failed/);
  const help = launch(['proxy', 'http', '--help'], {}, delegated);
  help.ready.catch(() => {});
  assert.match((await help.done).stdout, /--config FILE/);
});
test('SIGTERM retains default termination during blocked SQLite startup', async () => {
  const path = resolve(root, 'blocked');
  await mkdir(path);
  const holder = spawn(
    process.execPath,
    [
      resolve('conformance/typescript/gate-owner.mjs'),
      nativePath(),
      resolve(path, 'coordination.lock'),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  children.push(holder);
  await once(holder.stdout, 'data');
  try {
    const file = await config('blocked', {
      version: 1,
      port: 0,
      routes: [
        {
          name: 'api',
          upstream: upstreamUrl,
          pool: { backend: 'sqlite', path, config: { maxConcurrent: 1 } },
        },
      ],
    });
    const child = launch(['--config', file]);
    child.ready.catch(() => {});
    // Allow the child to reach its blocked native open; this is a one-shot test deadline.
    await new Promise((resolve) => setTimeout(resolve, 500));
    child.child.kill('SIGTERM');
    assert.equal((await child.done).signal, 'SIGTERM');
  } finally {
    const closed = once(holder, 'exit');
    holder.stdin.end('x');
    await closed;
  }
});
test('standalone help and missing config terminate without opening a listener', async () => {
  for (const args of [['--help'], []]) {
    const child = launch(args);
    child.ready.catch(() => {});
    const output = await child.done;
    assert.equal(output.code, args.length ? 0 : 1);
    assert.match(output.stdout + output.stderr, /--config FILE/);
  }
});
try {
  await run();
} finally {
  finishFirst.resolve();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  await redis?.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
