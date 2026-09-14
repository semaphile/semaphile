import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { suite, deferred } from '../typescript/fixtures/cases.mjs';
import { openLimiter as memory } from '../../packages/core/dist/src/memory.js';
import { openLimiter as sqlite } from '../../packages/core/dist/src/index.js';
import { startMcpProxy } from '../../packages/proxy/dist/mcp.js';
const require = createRequire(new URL('../../packages/proxy/package.json', import.meta.url));
const { ReadBuffer } = require('@modelcontextprotocol/client');
const { test, run } = suite();
await mkdir('.tmp/proxy', { recursive: true });
const root = await mkdtemp(resolve('.tmp/proxy/mcp-'));
const redis =
  process.env.SEMAPHILE_PROXY_BACKEND === 'redis'
    ? await (await import('../redis/harness.mjs')).server()
    : undefined;
const redisOpen = redis
  ? (await import('../../packages/redis/dist/index.js')).openLimiter
  : undefined;
console.log(
  'platform=' +
    process.platform +
    ' node=' +
    process.version +
    ' bun=' +
    (process.versions.bun ?? '-') +
    ' store=' +
    root,
);
async function within(promise, ms = 7000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MCP test deadline')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function connection(pool, options = {}) {
  const input = new PassThrough(),
    output = new PassThrough();
  const frames = [],
    waiters = [];
  const buffer = new ReadBuffer();
  output.on('data', (chunk) => {
    buffer.append(chunk);
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
  const proxy = await startMcpProxy({
    limiter: pool,
    command: process.execPath,
    args: [resolve('conformance/proxy/fixtures/mcp-raw-server.mjs')],
    input,
    output,
    shutdownGraceMs: 100,
    cancellationGraceMs: 200,
    requestTimeoutMs: 3000,
    ...options,
  });
  return {
    proxy,
    input,
    output,
    frames,
    send: (message) => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'),
    take(match) {
      const index = frames.findIndex(match);
      if (index >= 0) {
        return Promise.resolve(frames.splice(index, 1)[0]);
      }
      return within(new Promise((resolve) => waiters.push({ match, resolve })));
    },
    async close() {
      await within(proxy.close());
      input.destroy();
      output.destroy();
    },
  };
}
const request = (id, name, args = {}) => ({
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});
const response = (id) => (frame) => frame.id === id && !frame.method;
const started = (id) => (frame) => frame.method === 'fixture/started' && frame.params.id === id;
for (const backend of redis ? ['redis'] : ['memory', 'sqlite']) {
  function scenario(name, body, config = { maxConcurrent: 1 }) {
    test(backend + ': ' + name, async () => {
      const location = root + '/' + randomUUID();
      const queued = [deferred(), deferred(), deferred(), deferred()];
      let count = 0;
      const telemetry = {
        onEvent(event) {
          if (event.kind === 'queued') {
            queued[count]?.resolve();
            count += 1;
          }
        },
      };
      const pool = await (backend === 'memory'
        ? memory({ key: location, config, telemetry })
        : backend === 'sqlite'
          ? sqlite({ path: location, config, telemetry })
          : redisOpen({ url: redis.url, pool: location, config, telemetry, ownerTimeoutMs: 3000 }));
      const connections = [];
      const fixture = {
        pool,
        queued,
        async connect(options) {
          const value = await connection(pool, options);
          connections.push(value);
          return value;
        },
      };
      try {
        await within(body(fixture), 15000);
      } finally {
        for (const connection of connections.reverse()) {
          await connection.close();
        }
        await pool.close();
      }
    });
  }
  scenario(
    'two owned MCP children share admission and control requests bypass queued tools',
    async (f) => {
      const a = await f.connect(),
        b = await f.connect();
      a.send(request('first', 'hold'));
      await a.take(started('first'));
      b.send(request(0, 'echo', { text: 'second' }));
      await f.queued[1].promise;
      assert.equal((await f.pool.inspect()).active, 1);
      b.send({ id: 'control', method: 'ping', params: { marker: 'unchanged' } });
      assert.deepEqual((await b.take(response('control'))).result, {
        echo: { marker: 'unchanged' },
      });
      assert.equal(b.frames.some(started(0)), false);
      a.send({ method: 'fixture/release', params: { id: 'first' } });
      await a.take(response('first'));
      assert.equal((await b.take(response(0))).result.content[0].text, '{"text":"second"}');
    },
  );
  scenario('queued cancellation never reaches the upstream', async (f) => {
    const c = await f.connect();
    c.send(request(1, 'hold'));
    await c.take(started(1));
    c.send(request(2, 'echo'));
    await f.queued[1].promise;
    c.send({ method: 'notifications/cancelled', params: { requestId: 2 } });
    assert.equal((await c.take(response(2))).error.message, 'MCP_REQUEST_CANCELLED');
    c.send({ method: 'fixture/release', params: { id: 1 } });
    await c.take(response(1));
    await c.proxy.close({ drain: true });
    assert.equal(c.frames.some(started(2)), false);
  });
  scenario('running cancellation keeps capacity until a cooperative response', async (f) => {
    const c = await f.connect();
    c.send(request(1, 'hold'));
    await c.take(started(1));
    c.send({ method: 'notifications/cancelled', params: { requestId: 1, reason: 'test' } });
    await c.take((frame) => frame.method === 'fixture/cancelled');
    assert.equal((await f.pool.inspect()).active, 1);
    c.send({ method: 'fixture/release', params: { id: 1 } });
    await c.take(response(1));
    await c.proxy.close({ drain: true });
    assert.equal((await f.pool.inspect()).active, 0);
  });
  scenario(
    'uncooperative cancellation waits for actual SIGKILL exit before releasing',
    async (f) => {
      const c = await f.connect({
        args: [resolve('conformance/proxy/fixtures/mcp-raw-server.mjs'), '--ignore-term'],
      });
      c.send(request(1, 'ignore'));
      await c.take(started(1));
      c.send({ method: 'notifications/cancelled', params: { requestId: 1 } });
      await c.take((frame) => frame.method === 'fixture/cancelled');
      assert.equal((await f.pool.inspect()).active, 1);
      await within(c.proxy.finished);
      assert.throws(() => process.kill(c.proxy.pid, 0), { code: 'ESRCH' });
      assert.equal((await f.pool.inspect()).active, 0);
    },
  );
  scenario('server callbacks reuse the opposite-direction ID and progress survives', async (f) => {
    const c = await f.connect();
    c.send(request(7, 'callback'));
    const callback = await c.take((frame) => frame.method === 'fixture/client');
    assert.equal(callback.id, 7);
    c.send({ id: 7, result: { answer: 42 } });
    assert.equal((await c.take(response(7))).result.content[0].text, '{"answer":42}');
    c.send({
      ...request('next', 'echo', { value: 9 }),
      params: { name: 'echo', arguments: { value: 9 }, _meta: { progressToken: 'stable-token' } },
    });
    assert.equal(
      (await c.take((frame) => frame.method === 'notifications/progress')).params.progressToken,
      'stable-token',
    );
    assert.deepEqual((await c.take(response('next'))).result._meta, { fixture: true });
  });
  scenario(
    'default close terminates work while drain accepts responses and first close wins',
    async (f) => {
      const c = await f.connect();
      c.send(request(1, 'hold'));
      await c.take(started(1));
      const closing = c.proxy.close({ drain: true });
      assert.equal(c.proxy.close(), closing);
      c.send({ method: 'fixture/release', params: { id: 1 } });
      await c.take(response(1));
      await within(closing);
      assert.equal((await f.pool.inspect()).active, 0);
      assert.equal(await f.pool.schedule(() => 'borrowed'), 'borrowed');
    },
  );
  scenario('request deadline and upstream crash reclaim running work', async (f) => {
    for (const name of ['ignore', 'exit']) {
      const c = await f.connect({ requestTimeoutMs: 500 });
      c.send({ id: 'ready', method: 'ping' });
      await c.take(response('ready'));
      c.send(request(1, name));
      if (name !== 'exit') {
        await c.take(started(1));
      }
      await within(c.proxy.finished);
      assert.equal((await f.pool.inspect()).active, 0);
      assert.throws(() => process.kill(c.proxy.pid, 0), { code: 'ESRCH' });
    }
  });
  scenario('queue cap and queued deadline refuse without late forwarding', async (f) => {
    const c = await f.connect({ maxPending: 2, queueTimeoutMs: 100 });
    c.send(request(1, 'hold'));
    await c.take(started(1));
    c.send(request(2, 'echo'));
    c.send(request(3, 'echo'));
    assert.equal((await c.take(response(3))).error.message, 'MCP_QUEUE_FULL');
    assert.equal((await c.take(response(2))).error.message, 'MCP_REQUEST_TIMEOUT');
    c.send({ method: 'fixture/release', params: { id: 1 } });
    await c.take(response(1));
    await c.proxy.close({ drain: true });
    assert.equal(c.frames.some(started(2)), false);
    assert.equal(c.frames.some(started(3)), false);
  });
  scenario(
    'duplicate IDs and invalid or oversized frames terminate the owned session',
    async (f) => {
      for (const frame of ['{"bad":true}\n', 'x'.repeat(2048), 'duplicate']) {
        const c = await f.connect({ maxMessageBytes: 1024 });
        c.send(request(1, 'hold'));
        await c.take(started(1));
        if (frame === 'duplicate') {
          c.send(request(1, 'echo'));
        } else {
          c.input.write(frame);
        }
        await within(c.proxy.finished);
        assert.equal((await f.pool.inspect()).active, 0);
      }
    },
  );

  scenario('startup validation and immediate child exit preserve borrowed resources', async (f) => {
    const output = new PassThrough();
    output.destroy();
    await assert.rejects(
      startMcpProxy({ limiter: f.pool, command: '/missing', output }),
      /open output/,
    );
    await assert.rejects(
      startMcpProxy({ limiter: f.pool, command: '/missing', args: [7] }),
      /argument/,
    );
    await assert.rejects(
      startMcpProxy({ limiter: f.pool, command: '/missing' }),
      /Unable to start/,
    );
    const c = await f.connect({ args: ['-e', 'process.exit(0)'] });
    await within(c.proxy.finished);
    assert.equal(c.input.listenerCount('data'), 0);
    assert.equal(c.output.listenerCount('close'), 0);
    assert.equal(await f.pool.schedule(() => 'usable'), 'usable');
  });
  scenario('EOF cleans up and child environment inherits only explicit values', async (f) => {
    process.env.SEMAPHILE_MCP_TEST_SECRET = 'not-inherited';
    try {
      const c = await f.connect({ env: { MCP_ALLOWED: 'yes' } });
      c.send(request(1, 'env', { name: 'SEMAPHILE_MCP_TEST_SECRET' }));
      assert.equal((await c.take(response(1))).result.content[0].text, 'unset');
      c.send(request(2, 'env', { name: 'MCP_ALLOWED' }));
      assert.equal((await c.take(response(2))).result.content[0].text, 'yes');
      c.input.end();
      await within(c.proxy.finished);
      assert.equal((await f.pool.inspect()).active, 0);
    } finally {
      delete process.env.SEMAPHILE_MCP_TEST_SECRET;
    }
  });

  scenario('destroyed downstream streams promptly stop the owned child', async (f) => {
    for (const leg of ['input', 'output']) {
      const c = await f.connect();
      c.send(request(1, 'hold'));
      await c.take(started(1));
      c[leg].destroy();
      await within(c.proxy.finished, 1000);
      assert.equal((await f.pool.inspect()).active, 0);
    }
  });
  scenario(
    'per-tool weights share weighted capacity without blocking control messages',
    async (f) => {
      const c = await f.connect({ toolWeights: { hold: 2, ignore: 1 } });
      c.send(request(1, 'hold'));
      await c.take(started(1));
      c.send(request(2, 'ignore'));
      await c.take(started(2));
      c.send(request(3, 'hold'));
      await f.queued[2].promise;
      assert.equal((await f.pool.inspect()).active, 3);
      c.send({ method: 'fixture/release', params: { id: 1 } });
      await c.take(started(3));
      assert.equal((await f.pool.inspect()).active, 3);
      for (const id of [2, 3]) {
        c.send({ method: 'fixture/release', params: { id } });
      }
      await c.proxy.close({ drain: true });
      assert.equal((await f.pool.inspect()).active, 0);
    },
    { maxConcurrent: 3 },
  );
  scenario('control requests and retained queued bytes have independent bounds', async (f) => {
    const c = await f.connect({ maxControlPending: 1, requestTimeoutMs: 150 });
    c.send({ id: 1, method: 'fixture/hang' });
    c.send({ id: 2, method: 'ping' });
    assert.equal((await c.take(response(2))).error.message, 'MCP_QUEUE_FULL');
    assert.equal((await c.take(response(1))).error.message, 'MCP_REQUEST_TIMEOUT');
    await within(c.proxy.finished);
    const b = await f.connect({ maxBufferedBytes: 1024, maxMessageBytes: 4096 });
    b.send(request(1, 'hold'));
    await b.take(started(1));
    b.send(request(2, 'echo', { large: 'x'.repeat(1100) }));
    assert.equal((await b.take(response(2))).error.message, 'MCP_QUEUE_FULL');
    b.send({ method: 'fixture/release', params: { id: 1 } });
    await b.take(response(1));
    await b.proxy.close({ drain: true });
    assert.equal(b.frames.some(started(2)), false);
  });
  scenario(
    'oversized upstream output is bounded and transport cleanup retains no lease',
    async (f) => {
      const c = await f.connect({ maxMessageBytes: 1024 });
      c.send(request(1, 'huge'));
      await within(c.proxy.finished);
      assert.equal((await f.pool.inspect()).active, 0);
    },
  );
  scenario('blocked downstream writes do not prevent bounded child shutdown', async (f) => {
    const output = new Writable({ write(_chunk, _encoding, _callback) {} });
    output.on('error', () => {});
    const c = await f.connect({ output, maxBufferedBytes: 512 });
    c.send(request(1, 'echo', { text: 'x'.repeat(400) }));
    await within(c.proxy.finished);
    assert.equal((await f.pool.inspect()).active, 0);
    output.destroy();
  });
}
try {
  await run();
} finally {
  await redis?.close();
}
