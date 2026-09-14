import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { suite } from '../typescript/fixtures/cases.mjs';
const require = createRequire(new URL('../../packages/proxy/package.json', import.meta.url));
const { ReadBuffer, Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { test, run } = suite();
await mkdir('.tmp/proxy', { recursive: true });
const root = await mkdtemp(resolve('.tmp/proxy/mcp-cli-'));
const cli = resolve('packages/proxy/dist/mcp-cli.js'),
  raw = resolve('conformance/proxy/fixtures/mcp-raw-server.mjs');
const peers = [],
  transports = [];
const redis =
  process.env.SEMAPHILE_PROXY_BACKEND === 'redis'
    ? await (await import('../redis/harness.mjs')).server()
    : undefined;
async function within(promise, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MCP CLI test deadline')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const pool = redis
  ? {
      backend: 'redis',
      urlEnv: 'MCP_TEST_REDIS_URL',
      pool: root,
      config: { maxConcurrent: 1 },
      ownerTimeoutMs: 3000,
    }
  : { backend: 'sqlite', path: './shared', config: { maxConcurrent: 1 } };
async function config(name, options = {}) {
  const path = resolve(root, name + '.json');
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      pool,
      command: process.execPath,
      args: [raw],
      shutdownGraceMs: 100,
      cancellationGraceMs: 200,
      requestTimeoutMs: 5000,
      ...options,
    }),
  );
  return path;
}
function peer(args, executable = cli, env = {}) {
  const child = spawn(process.execPath, [executable, ...args], {
    env: { ...process.env, ...(redis ? { MCP_TEST_REDIS_URL: redis.url } : {}), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  peers.push(child);
  const frames = [],
    waiters = [],
    buffer = new ReadBuffer();
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  child.stdout.on('data', (data) => {
    buffer.append(data);
    let frame;
    while ((frame = buffer.readMessage()) !== null) {
      const index = waiters.findIndex((waiter) => waiter.match(frame));
      if (index < 0) {
        frames.push(frame);
      } else {
        waiters.splice(index, 1)[0].resolve(frame);
      }
    }
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stderr }));
  });
  return {
    child,
    exited,
    frames,
    send: (message) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'),
    take(match) {
      const index = frames.findIndex(match);
      if (index >= 0) {
        return Promise.resolve(frames.splice(index, 1)[0]);
      }
      return within(
        Promise.race([
          new Promise((resolve) => waiters.push({ match, resolve })),
          exited.then((result) => {
            throw new Error('MCP CLI exited: ' + JSON.stringify(result));
          }),
        ]),
      );
    },
    async close() {
      child.stdin.end();
      const result = await within(exited);
      assert.equal(result.code, 0, result.stderr);
    },
  };
}
const call = (id, name) => ({ id, method: 'tools/call', params: { name } });
const response = (id) => (frame) => frame.id === id && !frame.method;
const started = (id) => (frame) => frame.method === 'fixture/started' && frame.params.id === id;
for (const mode of ['legacy', { pin: '2026-07-28' }]) {
  test(
    'official SDK client/server negotiate ' + JSON.stringify(mode) + ' through the CLI',
    async () => {
      const file = await config('sdk', {
        args: [resolve('conformance/proxy/fixtures/mcp-sdk-server.mjs')],
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cli, '--config', file],
        env: redis ? { MCP_TEST_REDIS_URL: redis.url } : undefined,
        stderr: 'pipe',
      });
      transports.push(transport);
      const client = new Client(
        { name: 'proxy-conformance', version: '1.0.0' },
        { versionNegotiation: { mode } },
      );
      try {
        await within(client.connect(transport));
        assert.equal((await client.listTools()).tools[0].name, 'echo');
        const result = await client.callTool({
          name: 'echo',
          arguments: { text: 'SDK passthrough' },
        });
        assert.equal(result.content[0].text, 'SDK passthrough');
        assert.equal(result._meta.fixture, true);
        assert.equal(client.getServerVersion().name, 'semaphile-sdk-fixture');
      } finally {
        await within(client.close());
      }
    },
  );
}
test(
  'two independent proxy processes share ' +
    (redis ? 'Redis' : 'SQLite') +
    ' and wake after owner SIGKILL',
  async () => {
    const file = await config('shared');
    const a = peer(['--config', file]),
      b = peer(['--config', file]);
    a.send(call(1, 'hold'));
    await a.take(started(1));
    b.send(call(2, 'echo'));
    b.send({ id: 'ping', method: 'ping' });
    await b.take(response('ping'));
    assert.equal(b.frames.some(started(2)), false);
    a.child.kill('SIGKILL');
    assert.equal((await within(a.exited)).signal, 'SIGKILL');
    await b.take(response(2));
    await b.close();
  },
);
test('SIGTERM drain completes a running tool and protocol notifications still flow', async () => {
  const file = await config('drain');
  const p = peer(['--config', file, '--drain']);
  p.send(call(1, 'hold'));
  await p.take(started(1));
  p.child.kill('SIGTERM');
  p.send({ method: 'fixture/release', params: { id: 1 } });
  await p.take(response(1));
  assert.equal((await within(p.exited)).code, 0);
});
test('delegated CLI forwards explicit environment without printing protocol diagnostics', async () => {
  const file = await config('delegated', { env: { MCP_ALLOWED: 'MCP_TEST_VALUE' } });
  const p = peer(
    ['proxy', 'mcp', '--config', file],
    resolve('packages/messaging/dist/src/cli.js'),
    { MCP_TEST_VALUE: 'allowed' },
  );
  p.send({
    id: 1,
    method: 'tools/call',
    params: { name: 'env', arguments: { name: 'MCP_ALLOWED' } },
  });
  assert.equal((await p.take(response(1))).result.content[0].text, 'allowed');
  await p.close();
  assert.equal((await p.exited).stderr, '');
});
test('bad executable and malformed config cannot disclose input secrets', async () => {
  for (const delegated of [false, true]) {
    const file = resolve(root, 'bad.json');
    await writeFile(file, 'SECRET_CONFIG_CONTENT');
    const paths = [
      file,
      await config('bad-executable', { command: '/nonexistent/SECRET_EXECUTABLE' }),
    ];
    for (const path of paths) {
      const p = peer(
        delegated ? ['proxy', 'mcp', '--config', path] : ['--config', path],
        delegated ? resolve('packages/messaging/dist/src/cli.js') : cli,
      );
      const result = await within(p.exited);
      assert.notEqual(result.code, 0);
      assert.ok(!result.stderr.includes('SECRET_'));
      assert.deepEqual(p.frames, []);
    }
  }
});
try {
  await run();
} finally {
  await Promise.allSettled(transports.map((transport) => transport.close()));
  for (const child of peers) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  await redis?.close();
}
