import { deferred } from './fixtures/cases.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openLimiter, QueueTimeoutError } from '../../packages/core/dist/src/memory.js';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
const key = () => `memory-test:${randomUUID()}`;

test('same-key clients share weighted capacity and callback results', async () => {
  const options = { key: key(), config: { maxConcurrent: 5 } };
  const clients = await Promise.all([openLimiter(options), openLimiter(options)]);
  let active = 0,
    peak = 0;
  try {
    const values = await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const weight = index % 3 ? 2 : 1;
        return clients[index % 2].schedule(
          async () => {
            active += weight;
            peak = Math.max(peak, active);
            await delay(3);
            active -= weight;
            return index;
          },
          { weight },
        );
      }),
    );
    assert.equal(peak, 5);
    assert.deepEqual(
      values,
      Array.from({ length: 20 }, (_, i) => i),
    );
    assert.equal((await clients[0].inspect()).active, 0);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }
});

test('last-client close preserves budget and rejects later config drift', async () => {
  const options = { key: key(), config: { maxConcurrent: 1, reservoir: 3 } };
  const first = await openLimiter(options);
  await first.schedule(() => true);
  await first.close();
  const second = await openLimiter({
    ...options,
    config: { ...options.config, minTime: 0, expirationMs: null },
  });
  try {
    assert.equal(await second.currentReservoir(), 2);
    await assert.rejects(
      openLimiter({ ...options, config: { ...options.config, expirationMs: 50 } }),
      /config mismatch/,
    );
    assert.equal(await second.currentReservoir(), 2);
  } finally {
    await second.close();
  }
});

test('distinct keys have independent budgets', async () => {
  const a = await openLimiter({ key: key(), config: { maxConcurrent: 1, reservoir: 0 } });
  const b = await openLimiter({ key: key(), config: { maxConcurrent: 1, reservoir: 1 } });
  try {
    assert.equal(await b.schedule(() => 'independent'), 'independent');
    assert.equal(await a.currentReservoir(), 0);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('peer adjustment wakes exhausted budget and cancellation spends no tokens', async () => {
  const options = { key: key(), config: { maxConcurrent: 2, reservoir: 0 } };
  const a = await openLimiter(options),
    b = await openLimiter(options);
  const controller = new AbortController();
  try {
    const cancelled = a.schedule(() => assert.fail('cancelled work started'), {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    const queued = a.schedule(() => 42, { queueTimeoutMs: 1000 });
    assert.equal(await b.incrementReservoir(1), 1);
    assert.equal(await queued, 42);
    assert.equal(await b.currentReservoir(), 0);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('refills reset missed windows and preserve creation phase across close', async () => {
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const options = {
    key: key(),
    config: {
      maxConcurrent: 1,
      reservoir: 0,
      reservoirRefreshAmount: 4,
      reservoirRefreshInterval: 100,
    },
  };
  let client;
  try {
    client = await openLimiter(options);
    now = 1250;
    assert.equal(await client.currentReservoir(), 4, 'missed windows do not accumulate');
    await client.incrementReservoir(-4);
    await client.close();
    client = await openLimiter(options);
    now = 1299;
    assert.equal(await client.currentReservoir(), 0);
    now = 1300;
    assert.equal(await client.currentReservoir(), 4);
  } finally {
    Date.now = realNow;
    await client?.close();
  }
});

test('a useful computed refill deadline admits a queued job', async () => {
  const client = await openLimiter({
    key: key(),
    config: {
      maxConcurrent: 1,
      reservoir: 0,
      reservoirRefreshAmount: 1,
      reservoirRefreshInterval: 20,
    },
  });
  try {
    assert.equal(await client.schedule(() => 'refilled', { queueTimeoutMs: 1000 }), 'refilled');
  } finally {
    await client.close();
  }
});

test('an insufficient refill creates no periodic timer', async () => {
  const client = await openLimiter({
    key: key(),
    config: {
      maxConcurrent: 2,
      reservoir: 0,
      reservoirRefreshAmount: 1,
      reservoirRefreshInterval: 10,
    },
  });
  const original = globalThis.setTimeout,
    controller = new AbortController();
  let timers = 0;
  globalThis.setTimeout = (...args) => {
    timers++;
    return original(...args);
  };
  try {
    const queued = client.schedule(() => assert.fail('insufficient budget'), {
      weight: 2,
      signal: controller.signal,
    });
    await delay(40);
    assert.equal(timers, 0);
    controller.abort();
    await assert.rejects(queued, { name: 'AbortError' });
  } finally {
    globalThis.setTimeout = original;
    controller.abort();
    await client.close();
  }
});

test('same-key clients share minimum admission spacing across reopen', async () => {
  const options = { key: key(), config: { maxConcurrent: 3, minTime: 20 } };
  const a = await openLimiter(options),
    b = await openLimiter(options);
  let c;
  try {
    const stamps = await Promise.all(
      [a, b].map((client) => client.schedule((admission) => admission.leaseGrantedAt)),
    );
    assert.ok(stamps[1] - stamps[0] >= 20);
    await Promise.all([a.close(), b.close()]);
    c = await openLimiter(options);
    const next = await c.schedule((admission) => admission.leaseGrantedAt);
    assert.ok(next - stamps[1] >= 20);
  } finally {
    await Promise.all([a.close(), b.close(), c?.close()]);
  }
});

test('expiry frees capacity while late release preserves a live replacement', async () => {
  const client = await openLimiter({ key: key(), config: { maxConcurrent: 1, reservoir: 3 } });
  const started = deferred(),
    oldFinish = deferred(),
    replacementStarted = deferred(),
    replacementFinish = deferred();
  const old = client.schedule(
    async () => {
      started.resolve();
      await oldFinish.promise;
    },
    { expirationMs: 20 },
  );
  let replacement;
  try {
    await started.promise;
    replacement = client.schedule(
      async () => {
        replacementStarted.resolve();
        await replacementFinish.promise;
      },
      { queueTimeoutMs: 1000 },
    );
    await replacementStarted.promise;
    oldFinish.resolve();
    await old;
    const state = await client.inspect();
    assert.equal(state.active, 1);
    assert.equal(state.reservoir, 1);
  } finally {
    oldFinish.resolve();
    replacementFinish.resolve();
    await Promise.all([old, replacement]);
    await client.close();
  }
});

test('close is client-local and drain finishes accepted callbacks', async () => {
  const options = { key: key(), config: { maxConcurrent: 1 } };
  const a = await openLimiter(options),
    b = await openLimiter(options);
  const started = deferred(),
    finish = deferred();
  const held = a.schedule(async () => {
    started.resolve();
    await finish.promise;
  });
  try {
    await started.promise;
    const rejected = a.schedule(() => assert.fail('closing client started queued work'));
    const rejectedCheck = assert.rejects(rejected, /closing/);
    const survivor = b.schedule(() => 42);
    const closingA = a.close(),
      closingB = b.close({ drain: true });
    assert.equal(a.close({ drain: true }), closingA);
    await rejectedCheck;
    finish.resolve();
    await held;
    assert.equal(await survivor, 42);
    await Promise.all([closingA, closingB]);
  } finally {
    finish.resolve();
    await held;
    await Promise.all([a.close(), b.close()]);
  }
});

test('callback failures spend tokens but release capacity and preserve falsy reasons', async () => {
  const client = await openLimiter({ key: key(), config: { maxConcurrent: 1, reservoir: 3 } });
  try {
    for (const reason of [undefined, false, 0]) {
      await client
        .schedule(() => Promise.reject(reason))
        .then(
          () => assert.fail('expected rejection'),
          (error) => assert.equal(error, reason),
        );
    }
    assert.equal((await client.inspect()).active, 0);
    assert.equal(await client.currentReservoir(), 0);
  } finally {
    await client.close();
  }
});

test('queue deadline leaves an exhausted pool usable for later requests', async () => {
  const client = await openLimiter({ key: key(), config: { maxConcurrent: 1, reservoir: 0 } });
  try {
    await assert.rejects(
      client.schedule(() => assert.fail('timed-out work started'), { queueTimeoutMs: 15 }),
      QueueTimeoutError,
    );
    await client.incrementReservoir(1);
    assert.equal(await client.schedule(() => 'next'), 'next');
  } finally {
    await client.close();
  }
});

test('invalid input and unlimited accounting overflow do not poison the pool', async () => {
  await assert.rejects(openLimiter({ key: '', config: { maxConcurrent: 1 } }), /key/);
  const client = await openLimiter({ key: key(), config: { maxConcurrent: null } });
  const started = deferred(),
    finish = deferred();
  const held = client.schedule(
    async () => {
      started.resolve();
      await finish.promise;
    },
    { weight: Number.MAX_SAFE_INTEGER },
  );
  try {
    await started.promise;
    await assert.rejects(
      client.schedule(() => true),
      /accounting overflow/,
    );
    await assert.rejects(
      client.schedule(() => true, { weight: 0 }),
      /weight/,
    );
    finish.resolve();
    await held;
    assert.equal(await client.schedule(() => 'usable'), 'usable');
    assert.equal(await client.incrementReservoir(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    await assert.rejects(client.incrementReservoir(1), /overflow/);
    assert.equal(await client.currentReservoir(), Number.MAX_SAFE_INTEGER);
  } finally {
    finish.resolve();
    await held;
    await client.close();
  }
});

test('duplicate module imports share the versioned memory pool registry', async () => {
  const options = { key: key(), config: { maxConcurrent: 1, reservoir: 1 } };
  const a = await openLimiter(options);
  const base = fileURLToPath(new URL('../../.tmp/memory-module/', import.meta.url));
  await mkdir(base, { recursive: true });
  const copy = await mkdtemp(join(base, 'run-'));
  await writeFile(join(copy, 'package.json'), '{"type":"module"}');
  for (const name of [
    'memory',
    'memory-backend',
    'memory-control',
    'control-state',
    'maintenance-state',
    'recovery-state',
    'client',
    'telemetry',
    'client-errors',
    'deadline',
    'execution',
    'administration',
    'http',
    'http-policy',
    'response-lifetime',
    'config',
    'recovery-policy',
  ]) {
    await cp(
      new URL(`../../packages/core/dist/src/${name}.js`, import.meta.url),
      join(copy, `${name}.js`),
    );
  }
  const other = await import(pathToFileURL(join(copy, 'memory.js')).href);
  const b = await other.openLimiter(options);
  try {
    await a.schedule(() => 1);
    assert.equal(await b.currentReservoir(), 0);
    await assert.rejects(
      other.openLimiter({ ...options, config: { maxConcurrent: 2, reservoir: 1 } }),
      /config mismatch/,
    );
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('a finite maximum weight waits for capacity without overflowing accounting', async () => {
  const client = await openLimiter({
    key: key(),
    config: { maxConcurrent: Number.MAX_SAFE_INTEGER },
  });
  const started = deferred(),
    finish = deferred();
  const held = client.schedule(async () => {
    started.resolve();
    await finish.promise;
  });
  let queued;
  try {
    await started.promise;
    queued = client.schedule(() => 'full capacity', {
      weight: Number.MAX_SAFE_INTEGER,
      queueTimeoutMs: 1000,
    });
    finish.resolve();
    await held;
    assert.equal(await queued, 'full capacity');
    assert.equal((await client.inspect()).active, 0);
  } finally {
    finish.resolve();
    await Promise.allSettled([held, queued]);
    await client.close();
  }
});

await run();
