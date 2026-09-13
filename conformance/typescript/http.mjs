import { deferred } from './fixtures/cases.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { openLimiter as memoryOpen } from '../../packages/core/dist/src/memory.js';
import { retryAfter } from '../../packages/core/dist/src/http-policy.js';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
const redis =
  process.env.SEMAPHILE_HTTP_BACKEND === 'redis'
    ? await (await import('../redis/harness.mjs')).server()
    : undefined;
const redisOpen = redis
  ? (await import('../../packages/redis/dist/index.js')).openLimiter
  : undefined;
const sqliteOpen =
  process.env.SEMAPHILE_HTTP_BACKEND === 'sqlite'
    ? (await import('../../packages/core/dist/src/index.js')).openLimiter
    : undefined;
let sqliteRoot;
if (sqliteOpen) {
  await mkdir('.tmp/http-sqlite', { recursive: true });
  sqliteRoot = resolve(await mkdtemp('.tmp/http-sqlite/run-'));
}
const openLimiter = (options) =>
  redis
    ? redisOpen({ url: redis.url, pool: options.key, config: options.config })
    : sqliteOpen
      ? sqliteOpen({ path: join(sqliteRoot, options.key), config: options.config })
      : memoryOpen(options);
const endpoints = new Map();
const server = createServer((request, response) => {
  const handler = endpoints.get(request.url);
  if (!handler) {
    response.writeHead(404).end();
    return;
  }
  Promise.resolve(handler(request, response)).catch(() => response.destroy());
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = (handler) => {
  const path = `/${randomUUID()}`;
  endpoints.set(path, handler);
  return `http://127.0.0.1:${server.address().port}${path}`;
};
function scenario(name, task, recovery = {}) {
  test(name, async () => {
    const options = {
      key: randomUUID(),
      config: {
        maxConcurrent: 1,
        reservoir: 20,
        recovery: { retry: { baseDelayMs: 10, maxDelayMs: 20, jitter: 0 }, ...recovery },
      },
    };
    const a = await openLimiter(options),
      b = await openLimiter(options);
    const releases = [];
    const gate = () => {
      const item = deferred();
      releases.push(item.resolve);
      return item;
    };
    try {
      await task(a, b, gate);
    } finally {
      for (const release of releases) {
        release();
      }
      await Promise.allSettled([a.close(), b.close()]);
    }
  });
}
test('Retry-After parses seconds and HTTP dates and ignores malformed guidance', () => {
  const now = Date.UTC(2026, 8, 12, 12);
  assert.equal(retryAfter('12', now), 12000);
  assert.equal(retryAfter(new Date(now + 3000).toUTCString(), now), 3000);
  assert.equal(retryAfter(new Date(now - 3000).toUTCString(), now), 0);
  assert.equal(retryAfter('Sunday, 06-Nov-94 08:49:37 GMT', now), 0);
  for (const value of [null, '', '1.5', '-1', 'tomorrow', '99999999999999999999']) {
    assert.equal(retryAfter(value, now), undefined);
  }
});
scenario(
  'fetch returns headers while retaining capacity through streamed body completion',
  async (a, b, gate) => {
    const finish = gate();
    const url = endpoint(async (_request, response) => {
      response.writeHead(200);
      response.write('first');
      await finish.promise;
      response.end('last');
    });
    const response = await a.http.fetch(url);
    assert.equal(response.url, url);
    assert.equal((await b.inspect()).active, 1);
    assert.equal((await b.maintenance.status()).maintenance.pending, 1);
    const peer = b.schedule(() => 'peer');
    const text = response.text();
    finish.resolve();
    assert.equal(await text, 'firstlast');
    assert.equal(await peer, 'peer');
  },
);
scenario(
  'body cancellation releases capacity even when the caller owns its reader',
  async (a, b, gate) => {
    const finish = gate();
    const url = endpoint(async (_request, response) => {
      response.writeHead(200);
      response.write('first');
      await finish.promise;
      response.end();
    });
    const response = await a.http.fetch(url),
      reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await a.close();
    assert.equal((await b.inspect()).active, 0);
  },
);
scenario(
  'scoped request retains capacity after body EOF until application callback completes',
  async (a, b, gate) => {
    const entered = gate(),
      finish = gate();
    const url = endpoint((_request, response) => response.end('payload'));
    const job = a.http.request(url, async (response) => {
      assert.equal(await response.text(), 'payload');
      entered.resolve();
      await finish.promise;
      return 42;
    });
    await entered.promise;
    assert.equal((await b.inspect()).active, 1);
    finish.resolve();
    assert.equal(await job, 42);
    assert.equal((await b.inspect()).active, 0);
  },
);
scenario('safe HTTP retries classify upstream 503 and debit each attempt', async (a) => {
  let requests = 0;
  const url = endpoint((_request, response) => {
    requests++;
    response.writeHead(requests < 3 ? 503 : 200).end(String(requests));
  });
  const response = await a.http.fetch(url, { retrySafety: 'safe' });
  assert.equal(await response.text(), '3');
  await a.close();
  assert.equal(requests, 3);
});
scenario('unsafe HTTP response is delivered once, with no automatic replay', async (a) => {
  let requests = 0;
  const url = endpoint((_request, response) => {
    requests++;
    response.writeHead(503).end('unavailable');
  });
  const response = await a.http.fetch(url);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'unavailable');
  await a.close();
  assert.equal(requests, 1);
});
scenario(
  'application exceptions are never retried or counted as service failures',
  async (a, b) => {
    let requests = 0;
    const url = endpoint((_request, response) => {
      requests++;
      response.end('ok');
    });
    const failure = Object.assign(new Error('application defect'), { code: 'ECONNRESET' });
    const result = await a.http
      .request(
        url,
        () => {
          throw failure;
        },
        { retrySafety: 'safe' },
      )
      .catch((error) => error);
    assert.equal(result, failure);
    assert.equal(requests, 1);
    assert.equal((await b.maintenance.status()).recovery.failures, 0);
  },
);
scenario('reproducible POST bodies repeat exactly across safe retries', async (a) => {
  const bodies = [];
  const url = endpoint(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    bodies.push(body);
    response.writeHead(bodies.length === 1 ? 503 : 200).end('ok');
  });
  const result = await a.http.request(url, (response) => response.text(), {
    retrySafety: 'safe',
    request: { method: 'POST', body: 'same payload' },
  });
  assert.equal(result, 'ok');
  assert.deepEqual(bodies, ['same payload', 'same payload']);
});
scenario('stream replay requires an explicit factory before accepting any operation', async (a) => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('body'));
      controller.close();
    },
  });
  await assert.rejects(
    a.http.fetch('http://127.0.0.1:1', {
      retrySafety: 'safe',
      request: { method: 'POST', body: stream, duplex: 'half' },
    }),
    /reproducible/,
  );
  assert.equal((await a.maintenance.status()).maintenance.pending, 0);
  assert.equal(await a.currentReservoir(), 20);
});
scenario('body factories create a fresh request stream for each safe retry', async (a) => {
  let requests = 0,
    factories = 0;
  const url = endpoint(async (request, response) => {
    for await (const _chunk of request) {
    }
    requests++;
    response.writeHead(requests === 1 ? 503 : 200).end('ok');
  });
  const text = await a.http.request(url, (response) => response.text(), {
    retrySafety: 'safe',
    request: { method: 'POST', duplex: 'half' },
    bodyFactory: () => {
      factories++;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('body'));
          controller.close();
        },
      });
    },
  });
  assert.equal(text, 'ok');
  assert.equal(factories, 2);
});
scenario('abort after header delivery errors the body and never replays', async (a, b, gate) => {
  let requests = 0;
  const finish = gate(),
    controller = new AbortController();
  const url = endpoint(async (_request, response) => {
    requests++;
    response.writeHead(200);
    response.write('first');
    await finish.promise;
    response.end();
  });
  const response = await a.http.fetch(url, { retrySafety: 'safe', signal: controller.signal });
  const body = response.text().catch((error) => error);
  controller.abort();
  assert.equal((await body).name, 'AbortError');
  await a.close();
  assert.equal(requests, 1);
  assert.equal((await b.inspect()).active, 0);
});
scenario(
  'attempt deadline covers a returned response body and releases after cancellation',
  async (a, b, gate) => {
    const finish = gate();
    const url = endpoint(async (_request, response) => {
      response.writeHead(200);
      response.write('first');
      await finish.promise;
      response.end();
    });
    const response = await a.http.fetch(url, { policy: { attemptTimeoutMs: 100 } });
    await assert.rejects(response.text(), { name: 'AttemptTimeoutError' });
    await a.close();
    assert.equal((await b.inspect()).active, 0);
  },
);
scenario('Retry-After remains a floor beyond the configured exponential cap', async (a) => {
  const starts = [];
  const url = endpoint((_request, response) => {
    starts.push(Date.now());
    response
      .writeHead(starts.length === 1 ? 429 : 200, starts.length === 1 ? { 'retry-after': '1' } : {})
      .end('ok');
  });
  assert.equal(
    await a.http.request(url, (response) => response.text(), { retrySafety: 'safe' }),
    'ok',
  );
  assert.ok(starts[1] - starts[0] >= 1000);
});
scenario('retry waits for error response cancellation to actually finish', async (a, b, gate) => {
  const started = gate(),
    cancelled = gate();
  let requests = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests++;
    return requests === 1
      ? new Response(
          new ReadableStream({
            cancel() {
              started.resolve();
              return cancelled.promise;
            },
          }),
          { status: 503 },
        )
      : new Response('ok');
  };
  try {
    const result = a.http.request('http://service.invalid', (response) => response.text(), {
      retrySafety: 'safe',
    });
    await started.promise;
    assert.equal((await b.inspect()).active, 1);
    assert.equal(requests, 1);
    cancelled.resolve();
    assert.equal(await result, 'ok');
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = fetch;
  }
});

for (const mode of ['fetch', 'request']) {
  scenario(
    `${mode}: close during a discarded transient response settles the caller`,
    async (a, _b, gate) => {
      const entered = gate(),
        response = gate(),
        fetch = globalThis.fetch;
      globalThis.fetch = () => {
        entered.resolve();
        return response.promise;
      };
      try {
        const result = (
          mode === 'fetch'
            ? a.http.fetch('http://service.invalid', { retrySafety: 'safe' })
            : a.http.request('http://service.invalid', () => assert.fail('handler ran'), {
                retrySafety: 'safe',
              })
        ).catch((error) => error);
        await entered.promise;
        const closing = a.close();
        response.resolve(new Response('busy', { status: 503 }));
        assert.match((await result).message, /stopped before response delivery/);
        await closing;
      } finally {
        globalThis.fetch = fetch;
      }
    },
  );
  scenario(
    `${mode}: abort between fetch settlement and delivery never invokes application code`,
    async (a, _b, gate) => {
      const entered = gate(),
        response = gate(),
        fetch = globalThis.fetch,
        controller = new AbortController();
      globalThis.fetch = () => {
        entered.resolve();
        return response.promise;
      };
      try {
        const result = (
          mode === 'fetch'
            ? a.http.fetch('http://service.invalid', { signal: controller.signal })
            : a.http.request('http://service.invalid', () => assert.fail('handler ran'), {
                signal: controller.signal,
              })
        ).catch((error) => error);
        await entered.promise;
        response.resolve(new Response('ok'));
        controller.abort();
        assert.equal((await result).name, 'AbortError');
        await a.close();
      } finally {
        globalThis.fetch = fetch;
      }
    },
  );
  scenario(`${mode}: overdue attempt deadline is checked before response delivery`, async (a) => {
    const fetch = globalThis.fetch;
    globalThis.fetch = async () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      return new Response('late');
    };
    try {
      const result =
        mode === 'fetch'
          ? a.http.fetch('http://service.invalid', { policy: { attemptTimeoutMs: 10 } })
          : a.http.request('http://service.invalid', () => assert.fail('handler ran'), {
              policy: { attemptTimeoutMs: 10 },
            });
      await assert.rejects(result, { name: 'AttemptTimeoutError' });
      await a.close();
    } finally {
      globalThis.fetch = fetch;
    }
  });
  scenario(
    `${mode}: cancelling an unfinished probe body cannot establish recovery`,
    async (a, b) => {
      const fetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = async () =>
        ++requests === 1
          ? new Response('busy', { status: 503 })
          : new Response(new ReadableStream());
      try {
        await a.http.request('http://service.invalid', (response) => response.text());
        assert.equal((await b.maintenance.status()).recovery.circuit, 'open');
        if (mode === 'fetch') {
          const response = await a.http.fetch('http://service.invalid');
          await response.body.cancel();
        } else {
          assert.equal(await a.http.request('http://service.invalid', () => 'headers'), 'headers');
        }
        await a.close();
        assert.equal((await b.maintenance.status()).recovery.circuit, 'open');
      } finally {
        globalThis.fetch = fetch;
      }
    },
    { breaker: { failureThreshold: 1, initialPauseMs: 5, maxPauseMs: 10 } },
  );
}
scenario(
  'scoped cleanup failure reports a failed probe body instead of success',
  async (a, b) => {
    const fetch = globalThis.fetch;
    let requests = 0,
      source;
    const error = Object.assign(new Error('broken body'), { code: 'ECONNRESET' });
    globalThis.fetch = async () =>
      ++requests === 1
        ? new Response('busy', { status: 503 })
        : new Response(
            new ReadableStream({
              start(controller) {
                source = controller;
              },
            }),
          );
    try {
      await a.http.request('http://service.invalid', (response) => response.text());
      const result = await a.http
        .request('http://service.invalid', () => {
          source.error(error);
          return 'headers';
        })
        .catch((failure) => failure);
      assert.equal(result, error);
      assert.equal((await b.maintenance.status()).recovery.circuit, 'open');
    } finally {
      globalThis.fetch = fetch;
    }
  },
  { breaker: { failureThreshold: 1, initialPauseMs: 5, maxPauseMs: 10 } },
);
scenario(
  'unread transport failure releases capacity without waiting for a disabled deadline',
  async (a, b) => {
    const fetch = globalThis.fetch;
    let source;
    const error = Object.assign(new Error('unread body failed'), { code: 'ECONNRESET' });
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            source = controller;
          },
        }),
      );
    try {
      const response = await a.http.fetch('http://service.invalid', {
        policy: { deadlineMs: null, attemptTimeoutMs: null },
      });
      source.error(error);
      await a.close();
      assert.equal((await b.inspect()).active, 0);
      await assert.rejects(response.text(), (failure) => failure === error);
    } finally {
      globalThis.fetch = fetch;
    }
  },
);
test('Retry-After rejects normalized nonexistent calendar dates and invalid clock fields', () => {
  const now = Date.UTC(2026, 8, 12, 12);
  for (const value of [
    'Fri, 31 Feb 2027 00:00:00 GMT',
    'Tue, 29 Feb 2027 00:00:00 GMT',
    'Sat, 12 Sep 2026 24:00:00 GMT',
    'Sat, 12 Sep 2026 12:61:00 GMT',
    'Sun, 12 Sep 2026 12:00:03 GMT',
  ]) {
    assert.equal(retryAfter(value, now), undefined);
  }
  assert.equal(retryAfter('Sat Sep 12 12:00:03 2026', now), 3000);
  assert.equal(
    retryAfter(new Date(Date.UTC(2028, 1, 29)).toUTCString(), now),
    Date.UTC(2028, 1, 29) - now,
  );
});
scenario('unread empty EOF completes without a deadline or eager body reads', async (a, b) => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.close();
        },
      }),
    );
  try {
    const response = await a.http.fetch('http://service.invalid', {
      policy: { deadlineMs: null, attemptTimeoutMs: null },
    });
    await a.close();
    assert.equal((await b.inspect()).active, 0);
    assert.equal(await response.text(), '');
  } finally {
    globalThis.fetch = fetch;
  }
});
for (const mode of ['fetch', 'request']) {
  scenario(
    `${mode}: body failure preserves known throttle and Retry-After guidance`,
    async (a, b) => {
      const fetch = globalThis.fetch;
      let source;
      const error = Object.assign(new Error('body failed'), { code: 'ECONNRESET' });
      globalThis.fetch = async () =>
        new Response(
          new ReadableStream({
            start(c) {
              source = c;
            },
          }),
          { status: 429, headers: { 'retry-after': '120' } },
        );
      const before = Date.now();
      try {
        if (mode === 'fetch') {
          const response = await a.http.fetch('http://service.invalid');
          source.error(error);
          await assert.rejects(response.text(), (e) => e === error);
        } else {
          await assert.rejects(
            a.http.request('http://service.invalid', async (response) => {
              source.error(error);
              return response.text();
            }),
            (e) => e === error,
          );
        }
        await a.close();
        assert.ok((await b.maintenance.status()).recovery.cooldownUntil >= before + 120000);
      } finally {
        globalThis.fetch = fetch;
      }
    },
  );
}
try {
  await run();
} finally {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  await redis?.close();
}
