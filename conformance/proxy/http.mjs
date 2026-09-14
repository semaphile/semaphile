import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { suite, deferred } from '../typescript/fixtures/cases.mjs';
import { openLimiter as memory } from '../../packages/core/dist/src/memory.js';
import { openLimiter as sqlite } from '../../packages/core/dist/src/index.js';
import { startHttpProxy } from '../../packages/proxy/dist/index.js';

const { test, run } = suite();
await mkdir('.tmp/proxy', { recursive: true });
const root = await mkdtemp(resolve('.tmp/proxy/http-'));
const redisMode = process.env.SEMAPHILE_PROXY_BACKEND === 'redis';
const redis = redisMode ? await (await import('../redis/harness.mjs')).server() : undefined;
const redisOpen = redisMode
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

async function upstream(handler) {
  const errors = [];
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error) => {
      errors.push(error);
      res.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      assert.deepEqual(errors, []);
    },
  };
}
function request(url, path = '/api', options = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
        agent: false,
        signal: options.signal,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            trailers: response.trailers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error('Test request timeout')));
    req.once('error', reject);
    req.end(options.body);
  });
}
for (const backend of redisMode ? ['redis'] : ['memory', 'sqlite']) {
  function scenario(label, body, config = { maxConcurrent: 1 }) {
    test(backend + ': ' + label, async () => {
      const cleanup = [],
        gates = [];
      const location = root + '/' + randomUUID();
      let queuedCount = 0;
      const queued = [deferred(), deferred(), deferred(), deferred()];
      const telemetry = {
        onEvent: (event) => {
          if (event.kind === 'queued') {
            queued[queuedCount]?.resolve();
            queuedCount += 1;
          }
        },
      };
      const open = () =>
        backend === 'memory'
          ? memory({ key: location, config, telemetry })
          : backend === 'sqlite'
            ? sqlite({ path: location, config, telemetry })
            : redisOpen({
                url: redis.url,
                pool: location,
                config,
                telemetry,
                ownerTimeoutMs: 3000,
              });
      const pool = await open();
      const fixture = {
        pool,
        queued,
        gate() {
          const gate = deferred();
          gates.push(gate);
          return gate;
        },
        async upstream(handler) {
          const value = await upstream(handler);
          cleanup.push(value.close);
          return value;
        },
        async proxy(origin, options = {}, route = {}) {
          const value = await startHttpProxy({
            routes: [
              { name: 'api', upstream: origin, limiter: pool, requestTimeoutMs: 2000, ...route },
            ],
            port: 0,
            ...options,
          });
          cleanup.push(() => value.close());
          return value;
        },
      };
      try {
        await body(fixture);
      } finally {
        for (const gate of gates) {
          gate.resolve();
        }
        for (const close of cleanup.reverse()) {
          await close();
        }
        await pool.close();
      }
    });
  }
  scenario('two listeners share capacity and retain it through streamed bodies', async (f) => {
    const entered = f.gate(),
      finish = f.gate();
    let calls = 0;
    const origin = await f.upstream(async (_req, res) => {
      calls++;
      if (calls === 1) {
        res.write('first');
        entered.resolve();
        await finish.promise;
      }
      res.end('done');
    });
    const a = await f.proxy(origin.url),
      b = await f.proxy(origin.url);
    const first = request(a.url);
    await entered.promise;
    const second = request(b.url);
    await f.queued[1].promise;
    assert.equal(calls, 1);
    assert.equal((await f.pool.inspect()).active, 1);
    finish.resolve();
    assert.equal((await first).body.toString(), 'firstdone');
    assert.equal((await second).body.toString(), 'done');
    assert.equal(calls, 2);
    await Promise.all([a.close({ drain: true }), b.close({ drain: true })]);
    assert.equal((await f.pool.inspect()).active, 0);
    assert.equal(await f.pool.schedule(() => 42), 42, 'borrowed limiter stays open');
  });
  scenario('forwards raw compressed bytes, cookies and base paths', async (f) => {
    const compressed = gzipSync('stream contents');
    const origin = await f.upstream((req, res) => {
      assert.equal(req.url, '/v1/items%2Fpart?q=a%2Bb');
      assert.equal(req.headers['x-drop'], undefined);
      assert.equal(req.headers['x-semaphile-token'], undefined);
      assert.equal(req.headers.authorization, 'Bearer upstream-secret');
      assert(req.headers.via.includes('semaphile'));
      res.writeHead(201, {
        'content-encoding': 'gzip',
        'content-length': compressed.length,
        'set-cookie': ['one=1; Path=/', 'two=2; Path=/'],
        connection: 'x-private',
        'x-private': 'not end-to-end',
      });
      res.end(compressed);
    });
    const proxy = await f.proxy(
      origin.url + '/v1',
      { token: 'private-proxy-token' },
      {
        headers: { Authorization: 'Bearer upstream-secret' },
      },
    );
    const result = await request(proxy.url, '/api/items%2Fpart?q=a%2Bb', {
      headers: {
        'x-semaphile-token': 'private-proxy-token',
        connection: 'x-drop',
        'x-drop': 'hidden',
      },
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, compressed);
    assert.deepEqual(result.headers['set-cookie'], ['one=1; Path=/', 'two=2; Path=/']);
    assert.equal(result.headers['x-private'], undefined);
    assert.equal(result.headers['content-encoding'], 'gzip');
  });
  scenario('streams an upload before the sender ends it', async (f) => {
    const first = f.gate();
    const origin = await f.upstream(async (req, res) => {
      let text = '';
      for await (const chunk of req) {
        text += chunk.toString();
        first.resolve();
      }
      res.end(text);
    });
    const proxy = await f.proxy(origin.url);
    const response = deferred();
    const req = httpRequest(proxy.url + '/api', { method: 'POST', agent: false }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk.toString();
      });
      res.on('end', () => response.resolve(text));
      res.on('error', response.reject);
    });
    req.on('error', response.reject);
    req.write('one');
    await first.promise;
    assert.equal((await f.pool.inspect()).active, 1);
    req.end('two');
    assert.equal(await response.promise, 'onetwo');
  });
  scenario('queued disconnect never becomes an upstream call', async (f) => {
    const release = f.gate(),
      entered = f.gate();
    let calls = 0;
    const held = f.pool.execute(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const origin = await f.upstream((_req, res) => {
      calls++;
      res.end('unexpected');
    });
    const proxy = await f.proxy(origin.url);
    const controller = new AbortController();
    const response = request(proxy.url, '/api', { signal: controller.signal });
    const rejected = assert.rejects(response);
    await f.queued[1].promise;
    controller.abort();
    await rejected;
    await proxy.close({ drain: true });
    release.resolve();
    await held;
    assert.equal(calls, 0);
    assert.equal((await f.pool.inspect()).active, 0);
  });
  scenario('queue cap and queue deadline fail without forwarding', async (f) => {
    const release = f.gate(),
      entered = f.gate();
    let calls = 0;
    const held = f.pool.execute(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const origin = await f.upstream((_req, res) => {
      calls++;
      res.end();
    });
    const proxy = await f.proxy(origin.url, { maxPending: 1 }, { queueTimeoutMs: 100 });
    const waiting = request(proxy.url);
    await f.queued[1].promise;
    const overflow = await request(proxy.url);
    assert.equal(overflow.status, 503);
    assert.equal(JSON.parse(overflow.body).error, 'PROXY_QUEUE_FULL');
    assert.equal((await waiting).status, 504);
    assert.equal(calls, 0);
    await proxy.close();
    release.resolve();
    await held;
  });
  scenario('single-attempt POST reports Retry-After to another client', async (f) => {
    let calls = 0;
    const origin = await f.upstream(async (req, res) => {
      for await (const _chunk of req) {
        /* consume the uploaded request */
      }
      calls++;
      res.writeHead(calls === 1 ? 429 : 200, calls === 1 ? { 'retry-after': '1' } : {});
      res.end(String(calls));
    });
    const a = await f.proxy(origin.url),
      b = await f.proxy(origin.url);
    assert.equal((await request(a.url, '/api', { method: 'POST', body: 'one' })).status, 429);
    const started = performance.now();
    const second = await request(b.url);
    assert(performance.now() - started >= 900);
    assert.equal(second.body.toString(), '2');
    assert.equal(calls, 2, 'no implicit replay');
  });
  scenario('validates host/token/origin/target before admission', async (f) => {
    let calls = 0;
    const origin = await f.upstream((_req, res) => {
      calls++;
      res.end();
    });
    const token = 'private-proxy-token';
    const proxy = await f.proxy(origin.url, { token });
    assert.equal((await request(proxy.url)).status, 401);
    assert.equal(
      (
        await request(proxy.url, '/api', {
          headers: { host: 'evil.invalid', 'x-semaphile-token': token },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(proxy.url, '/api', {
          headers: { origin: 'https://evil.invalid', 'x-semaphile-token': token },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(proxy.url, '/api', {
          headers: { 'sec-fetch-site': 'cross-site', 'x-semaphile-token': token },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(proxy.url, 'http://evil.invalid/api', {
          headers: { 'x-semaphile-token': token },
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(proxy.url, '/missing', { headers: { 'x-semaphile-token': token } })).status,
      404,
    );
    assert.equal(calls, 0);
    assert.equal((await f.pool.inspect()).active, 0);
  });
  scenario('request deadline terminates upstream and reclaims capacity', async (f) => {
    const entered = f.gate(),
      closed = f.gate();
    const origin = await f.upstream((_req, res) => {
      entered.resolve();
      res.on('close', closed.resolve);
    });
    const proxy = await f.proxy(origin.url, {}, { requestTimeoutMs: 150 });
    const response = request(proxy.url);
    await entered.promise;
    assert.equal((await response).status, 504);
    await closed.promise;
    await proxy.close();
    assert.equal((await f.pool.inspect()).active, 0);
    assert.equal((await f.pool.maintenance.status()).maintenance.pending, 0);
  });
  scenario('drain completes accepted work and first close wins', async (f) => {
    const entered = f.gate(),
      release = f.gate();
    const origin = await f.upstream(async (_req, res) => {
      entered.resolve();
      await release.promise;
      res.end('drained');
    });
    const proxy = await f.proxy(origin.url);
    const response = request(proxy.url);
    await entered.promise;
    const closed = proxy.close({ drain: true });
    assert.equal(proxy.close(), closed);
    release.resolve();
    assert.equal((await response).body.toString(), 'drained');
    await closed;
    assert.equal((await f.pool.inspect()).active, 0);
  });
  scenario('upstream disconnect and invalid status return bounded local errors', async (f) => {
    const origin = await f.upstream((req, res) => {
      if (req.url === '/invalid') {
        res.writeHead(999);
        res.end();
      } else {
        req.socket.destroy();
      }
    });
    const proxy = await f.proxy(origin.url);
    for (const path of ['/api', '/api/invalid']) {
      const result = await request(proxy.url, path);
      assert.equal(result.status, 502);
      assert.equal(result.body.toString(), '{"error":"UPSTREAM_FAILURE"}');
    }
  });

  scenario('client disconnect after headers closes upstream before drain finishes', async (f) => {
    const closed = f.gate();
    const origin = await f.upstream((_req, res) => {
      res.once('close', closed.resolve);
      res.write('partial');
    });
    const proxy = await f.proxy(origin.url);
    await new Promise((resolve, reject) => {
      const req = httpRequest(proxy.url + '/api', (response) => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
        response.on('error', () => {});
      });
      req.once('error', reject);
      req.end();
    });
    await closed.promise;
    await proxy.close({ drain: true });
    assert.equal((await f.pool.inspect()).active, 0);
  });
  scenario(
    'truncated response closes the stream without appending a local JSON error',
    async (f) => {
      const release = f.gate();
      const origin = await f.upstream(async (_req, res) => {
        res.writeHead(200, { 'content-length': '100' });
        res.write('partial');
        await release.promise;
        res.destroy();
      });
      const proxy = await f.proxy(origin.url);
      let body = '';
      await new Promise((resolve, reject) => {
        const req = httpRequest(proxy.url + '/api', (response) => {
          response.on('data', (data) => {
            body += data;
            release.resolve();
          });
          response.once('aborted', resolve);
          response.once('error', resolve);
          response.once('end', () => reject(new Error('Truncated response unexpectedly ended')));
        });
        req.once('error', reject);
        req.end();
      });
      assert.equal(body, 'partial');
      await proxy.close();
      assert.equal((await f.pool.inspect()).active, 0);
    },
  );
  scenario(
    'early final response terminates an unfinished upload and redirects are not followed',
    async (f) => {
      let calls = 0;
      const origin = await f.upstream((_req, res) => {
        calls++;
        res.writeHead(307, { location: 'http://unreachable.invalid/' });
        res.end('redirect');
      });
      const proxy = await f.proxy(origin.url);
      await new Promise((resolve, reject) => {
        const req = httpRequest(proxy.url + '/api', { method: 'POST' }, (response) => {
          assert.equal(response.statusCode, 307);
          response.resume();
          response.once('end', resolve);
        });
        req.on('error', reject);
        req.write('unfinished');
      });
      await proxy.close();
      assert.equal(calls, 1);
      assert.equal((await f.pool.inspect()).active, 0);
    },
  );
  scenario('Expect continue is sent only after admission', async (f) => {
    const hold = f.gate(),
      entered = f.gate();
    const holding = f.pool.schedule(async () => {
      entered.resolve();
      await hold.promise;
    });
    await entered.promise;
    const origin = await f.upstream(async (req, res) => {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      res.end(body);
    });
    const proxy = await f.proxy(origin.url);
    let continued = false;
    const response = new Promise((resolve, reject) => {
      const req = httpRequest(
        proxy.url + '/api',
        { method: 'POST', headers: { expect: '100-continue' } },
        (res) => {
          let body = '';
          res.on('data', (data) => {
            body += data;
          });
          res.once('end', () => resolve(body));
        },
      );
      req.once('continue', () => {
        continued = true;
        req.end('body');
      });
      req.once('error', reject);
      req.flushHeaders();
    });
    await f.queued[1].promise;
    assert.equal(continued, false);
    hold.resolve();
    assert.equal(await response, 'body');
    await holding;
  });

  scenario('rejected CONNECT and upgrades cannot retain half-open sockets', async (f) => {
    const origin = await f.upstream((_req, res) => res.end());
    for (const requestLine of ['CONNECT example.com:443 HTTP/1.1', 'GET /api HTTP/1.1']) {
      const proxy = await f.proxy(origin.url);
      const socket = connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true });
      const response = new Promise((resolve, reject) => {
        let body = '';
        socket.on('data', (data) => {
          body += data;
        });
        socket.once('end', () => resolve(body));
        socket.once('error', reject);
      });
      socket.write(
        requestLine + '\r\nHost: example.com\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n',
      );
      try {
        assert.match(await response, /405/);
        await proxy.close();
      } finally {
        socket.destroy();
      }
    }
  });
  scenario('GET and DELETE chunked bodies receive explicit upstream framing', async (f) => {
    const origin = await f.upstream(async (req, res) => {
      assert.equal(req.headers['transfer-encoding'], 'chunked');
      let body = '';
      for await (const chunk of req) body += chunk;
      res.end(body);
    });
    const proxy = await f.proxy(origin.url);
    for (const method of ['GET', 'DELETE']) {
      const response = await request(proxy.url, '/api', {
        method,
        headers: { 'transfer-encoding': 'chunked' },
        body: 'framed',
      });
      assert.equal(response.body.toString(), 'framed');
    }
  });
  scenario('truncated throttled response retains shared Retry-After guidance', async (f) => {
    const release = f.gate();
    const origin = await f.upstream(async (_req, res) => {
      res.writeHead(429, { 'retry-after': '60', 'content-length': '100' });
      res.write('partial');
      await release.promise;
      res.destroy();
    });
    const proxy = await f.proxy(origin.url);
    await new Promise((resolve, reject) => {
      const req = httpRequest(proxy.url + '/api', (res) => {
        res.on('data', () => release.resolve());
        res.once('aborted', resolve);
        res.once('error', resolve);
      });
      req.once('error', reject);
      req.end();
    });
    await proxy.close({ drain: true });
    assert.ok((await f.pool.maintenance.status()).recovery.cooldownUntil > Date.now() + 50000);
  });

  scenario('Connection-nominated length is replaced with valid body framing', async (f) => {
    const origin = await f.upstream(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      assert.equal(req.headers['transfer-encoding'], 'chunked');
      res.end(body);
    });
    const proxy = await f.proxy(origin.url);
    const response = await request(proxy.url, '/api', {
      method: 'GET',
      headers: { 'content-length': '4', connection: 'content-length' },
      body: 'test',
    });
    assert.equal(response.body.toString(), 'test');
  });
  scenario('request and response trailers honor original Connection exclusions', async (f) => {
    const origin = await f.upstream(async (req, res) => {
      for await (const _chunk of req) {
        /* Drain the upload before inspecting its trailers. */
      }
      assert.equal(req.trailers['x-private'], undefined);
      assert.equal(req.trailers['x-visible'], 'request');
      res.writeHead(200, { connection: 'x-private', trailer: 'x-private, x-visible' });
      res.write('body');
      res.addTrailers({ 'x-private': 'secret', 'x-visible': 'response' });
      res.end();
    });
    const proxy = await f.proxy(origin.url);
    await new Promise((resolve, reject) => {
      const req = httpRequest(
        proxy.url + '/api',
        { method: 'POST', headers: { connection: 'x-private', trailer: 'x-private, x-visible' } },
        (res) => {
          res.resume();
          res.once('end', () => {
            try {
              assert.equal(res.trailers['x-private'], undefined);
              assert.equal(res.trailers['x-visible'], 'response');
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.once('error', reject);
      req.write('body');
      req.addTrailers({ 'x-private': 'secret', 'x-visible': 'request' });
      req.end();
    });
  });
  scenario('route root preserves its configured path with and without a query', async (f) => {
    const origin = await f.upstream((req, res) => res.end(req.url));
    for (const base of ['/v1', '/v1/']) {
      const proxy = await f.proxy(origin.url + base);
      assert.equal((await request(proxy.url, '/api')).body.toString(), base);
      assert.equal((await request(proxy.url, '/api?x=1')).body.toString(), base + '?x=1');
      assert.equal((await request(proxy.url, '/api/more?x=1')).body.toString(), '/v1/more?x=1');
    }
  });
  scenario('startup validation and occupied ports preserve caller-owned limiter', async (f) => {
    const origin = await f.upstream((_req, res) => res.end());
    const routes = [{ name: 'api', upstream: origin.url, limiter: f.pool }];
    await assert.rejects(startHttpProxy({ routes, host: '0.0.0.0', port: 0 }), /token/);
    await assert.rejects(
      startHttpProxy({ routes: [{ ...routes[0], upstream: 'http://user:secret@host/' }], port: 0 }),
      /without credentials/,
    );
    await assert.rejects(
      startHttpProxy({ routes: [{ ...routes[0], headers: { 'Content-Length': '3' } }], port: 0 }),
      /framing/,
    );
    await assert.rejects(startHttpProxy({ routes, port: new URL(origin.url).port * 1 }));
    assert.equal(await f.pool.schedule(() => 42), 42);
  });
}
try {
  await run();
} finally {
  await redis?.close();
}
