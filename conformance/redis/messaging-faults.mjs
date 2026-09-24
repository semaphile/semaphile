import assert from 'node:assert/strict';
import { createServer, connect as tcpConnect } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { server, connect } from './harness.mjs';
import { openRedisMessaging, messagingKey } from '../../packages/redis/dist/messaging.js';
const redis = await server(),
  admin = await connect(redis.url),
  connections = new Set(),
  clients = [];
let offline = false,
  dropAction,
  silentAction,
  silenceAll = false,
  offlineAfterDrop = false;
const target = new URL(redis.url);
const proxy = createServer((front) => {
  if (offline) {
    front.destroy();
    return;
  }
  const back = tcpConnect({ host: target.hostname, port: Number(target.port) });
  connections.add(front);
  connections.add(back);
  front.on('error', () => {});
  back.on('error', () => front.destroy());
  front.on('close', () => {
    connections.delete(front);
    back.destroy();
  });
  back.on('close', () => {
    connections.delete(back);
    front.destroy();
  });
  let request = '',
    drop = false,
    silent = false;
  front.on('data', (chunk) => {
    request = (request + chunk.toString()).slice(-65536);
    if (dropAction && request.includes(`"action":"${dropAction}"`)) {
      drop = true;
      dropAction = undefined;
      if (offlineAfterDrop) {
        offline = true;
        offlineAfterDrop = false;
      }
      request = '';
    }
    if (silentAction && request.includes(`"action":"${silentAction}"`)) {
      silent = true;
      silentAction = undefined;
    }
    back.write(chunk);
  });
  back.on('data', (chunk) => {
    if (silent || silenceAll) {
      return;
    }
    if (drop) {
      front.destroy();
      back.destroy();
    } else {
      front.write(chunk);
    }
  });
});
proxy.listen(0, '127.0.0.1');
await once(proxy, 'listening');
const url = `redis://127.0.0.1:${proxy.address().port}`,
  namespace = 'faults';
const open = async (extra = {}, store = randomUUID()) => {
  const c = await openRedisMessaging({
    url,
    namespace,
    store,
    operationTimeoutMs: 1500,
    sessionTimeoutMs: 300,
    onReadinessWarning: () => {},
    ...extra,
  });
  clients.push(c);
  return c;
};
let passed = 0;
const test = async (name, fn) => {
  await fn();
  // Earlier cases must not create a reconnect storm during the next outage.
  await Promise.all(clients.splice(0).map((client) => client.close()));
  passed++;
  console.log('PASS ' + name);
};
try {
  await test('a lost send reply reports uncertainty; explicit dedupe resolves without duplicate delivery', async () => {
    const c = await open();
    await c.createMailbox('q');
    dropAction = 'send';
    await assert.rejects(
      c.send({ to: 'q', body: 'once', dedupeKey: 'stable' }),
      (e) => e.code === 'UNCERTAIN',
    );
    const retry = await c.send({ to: 'q', body: 'once', dedupeKey: 'stable' });
    assert.equal(retry.deduplicated, true);
    assert.equal((await c.history()).length, 1);
    const [d] = await c.receive('q');
    await c.ack(d.receipt);
  });
  await test('a lost claim reply retains ownership until its committed deadline', async () => {
    const c = await open({ config: { claimTtlMs: 1000, retryDelayMs: 1 } });
    await c.createMailbox('q');
    await c.send({ to: 'q', body: 'claim' });
    dropAction = 'receive';
    await assert.rejects(c.receive('q'), (e) => e.code === 'UNCERTAIN');
    assert.equal((await c.history())[0].deliveries[0].state, 'claimed');
    const d = await c.wait('q', { timeoutMs: 4000 });
    assert.equal(d.attempt, 2);
    await c.ack(d.receipt);
  });
  await test('outage queues are bounded, undispatched calls expire, and cancellation closes promptly', async () => {
    const c = await open({ operationTimeoutMs: 120, maxPendingOperations: 2 });
    await c.createMailbox('q');
    offline = true;
    for (const socket of connections) {
      socket.destroy();
    }
    await delay(20);
    const ctrl = new AbortController(),
      waiting = c.wait('q', { signal: ctrl.signal });
    await delay(5);
    ctrl.abort();
    await assert.rejects(waiting, (e) => e.code === 'ABORTED');
    const results = await Promise.allSettled([
      c.send({ to: 'q', body: 'one' }),
      c.send({ to: 'q', body: 'two' }),
      c.send({ to: 'q', body: 'three' }),
      c.send({ to: 'q', body: 'four' }),
    ]);
    assert.ok(results.some((r) => r.status === 'rejected' && r.reason.code === 'QUEUE_FULL'));
    assert.ok(results.some((r) => r.status === 'rejected' && r.reason.code === 'TIMEOUT'));
    await c.close();
    offline = false;
  });
  await test('an idle wait resumes after reconnect and rechecks durable state', async () => {
    const store = randomUUID(),
      c = await open({}, store);
    const peer = await openRedisMessaging({
      url: redis.url,
      namespace,
      store,
      onReadinessWarning: () => {},
    });
    clients.push(peer);
    await c.createMailbox('q');
    const waiting = c.wait('q', { timeoutMs: 4000 });
    await delay(30);
    offline = true;
    for (const socket of connections) {
      socket.destroy();
    }
    await peer.send({ to: 'q', body: 'during outage' });
    await delay(100);
    offline = false;
    const d = await waiting;
    assert.equal(d.message.body, 'during outage');
    await c.ack(d.receipt);
  });
  await test('missing store is terminal and cannot be recreated by reconnect', async () => {
    const store = randomUUID(),
      c = await open({}, store);
    await c.createMailbox('q');
    await admin.del(messagingKey(namespace, store));
    await assert.rejects(c.send({ to: 'q', body: 'lost' }), (e) => e.code === 'STATE_LOST');
    await assert.rejects(c.createMailbox('new'), (e) => e.code === 'STATE_LOST');
    assert.equal(await admin.exists(messagingKey(namespace, store)), 0);
  });
  await test('server deadlines remain conservative when the local wall clock is skewed', async () => {
    const c = await open({ config: { claimTtlMs: 120, maxHandlingMs: 500 } });
    await c.createMailbox('q');
    const original = Date.now;
    Date.now = () => original() + 86400000;
    try {
      let done;
      const finished = new Promise((r) => (done = r));
      const listener = c.listen('q', async (d, ctx) => {
        await delay(260);
        assert.equal(ctx.signal.aborted, false);
        done();
      });
      try {
        await c.send({ to: 'q', body: 'skew' });
        await finished;
      } finally {
        await listener.close();
      }
      assert.equal((await c.history())[0].deliveries[0].state, 'acked');
    } finally {
      Date.now = original;
    }
  });
  await test('silent dispatched replies time out independently of the driver and do not wedge close', async () => {
    const c = await open({ operationTimeoutMs: 200 });
    await c.createMailbox('q');
    silentAction = 'send';
    const started = performance.now();
    await assert.rejects(
      c.send({ to: 'q', body: 'silent', dedupeKey: 'silent' }),
      (e) => e.code === 'UNCERTAIN',
    );
    assert.ok(performance.now() - started < 1500);
    assert.equal(
      (await c.send({ to: 'q', body: 'silent', dedupeKey: 'silent' })).deduplicated,
      true,
    );
    await c.close();
  });
  await test('silent startup handshake has an independent response deadline', async () => {
    silenceAll = true;
    const started = performance.now();
    try {
      await assert.rejects(open({ operationTimeoutMs: 120 }));
      assert.ok(performance.now() - started < 1500);
    } finally {
      silenceAll = false;
      offlineAfterDrop = false;
    }
  });
  await test('uncertain renewal cannot extend the handler watchdog', async () => {
    const c = await open({
      operationTimeoutMs: 300,
      config: { claimTtlMs: 160, maxHandlingMs: 2000 },
    });
    await c.createMailbox('q');
    let completed;
    const done = new Promise((r) => (completed = r));
    let elapsed;
    const listener = c.listen(
      'q',
      async (d, ctx) => {
        const started = performance.now();
        silentAction = 'renew';
        await new Promise((r) => ctx.signal.addEventListener('abort', r, { once: true }));
        elapsed = performance.now() - started;
        completed();
      },
      { onError: () => {} },
    );
    try {
      await c.send({ to: 'q', body: 'renew' });
      await done;
      assert.ok(elapsed < 500);
    } finally {
      await listener.close();
    }
  });
  await test('ACL refusal before index writes leaves the entire send unchanged', async () => {
    const store = randomUUID(),
      c = await open({}, store);
    await c.createMailbox('q');
    const name = 'review-' + randomUUID(),
      password = randomUUID();
    const key = messagingKey(namespace, store),
      before = await admin.hGet(key, 'meta');
    await admin.sendCommand([
      'ACL',
      'SETUSER',
      name,
      'on',
      '>' + password,
      '~*',
      '&*',
      '+@all',
      '-zadd',
    ]);
    try {
      const restricted = new URL(redis.url);
      restricted.username = name;
      restricted.password = password;
      const other = await openRedisMessaging({
        url: restricted.href,
        namespace,
        store,
        onReadinessWarning: () => {},
      });
      clients.push(other);
      await assert.rejects(other.send({ to: 'q', body: 'denied' }), (e) => e.code === 'ACCESS');
      assert.equal(await admin.hLen(key + ':messages'), 0);
      assert.equal(await admin.hLen(key + ':deliveries'), 0);
      assert.equal(await admin.hGet(key, 'meta'), before);
      await other.close();
    } finally {
      await admin.sendCommand(['ACL', 'DELUSER', name]);
    }
  });
  await test('an immediately lost renewal preserves the last confirmed claim lifetime', async () => {
    const c = await open({
      operationTimeoutMs: 700,
      config: { claimTtlMs: 300, maxHandlingMs: 2000 },
    });
    await c.createMailbox('q');
    let completed;
    const done = new Promise((r) => (completed = r));
    let elapsed;
    const listener = c.listen(
      'q',
      async (d, ctx) => {
        const started = performance.now();
        dropAction = 'renew';
        offlineAfterDrop = true;
        await new Promise((r) => ctx.signal.addEventListener('abort', r, { once: true }));
        elapsed = performance.now() - started;
        offline = false;
        completed();
      },
      { onError: () => {} },
    );
    try {
      await c.send({ to: 'q', body: 'confirmed' });
      await done;
      assert.ok(elapsed >= 230, `cancelled at ${elapsed}`);
      assert.ok(elapsed < 600);
    } finally {
      offline = false;
      offlineAfterDrop = false;
      await listener.close();
    }
  });
  await test('admission continues measured expiry cleanup beyond the first batch', async () => {
    const c = await open({ config: { maxPendingPerRecipient: 1 } });
    for (let i = 0; i < 270; i++) {
      await c.subscribe('old-' + i, { topics: ['old'] });
    }
    await c.createMailbox('target');
    await c.send({ to: 'target', body: 'expires later', expiresInMs: 1500 });
    await c.publish({ topic: 'old', body: 'old', expiresInMs: 50 });
    await delay(1550);
    await c.send({ to: 'target', body: 'replacement' });
    const [d] = await c.receive('target');
    assert.equal(d.message.body, 'replacement');
    await c.ack(d.receipt);
  });
  await test('a listener survives an outage longer than operation timeout without cancelling another claim', async () => {
    const store = randomUUID();
    const c = await open({ operationTimeoutMs: 120, config: { claimTtlMs: 3000 } }, store);
    const peer = await openRedisMessaging({
      url: redis.url,
      namespace,
      store,
      onReadinessWarning: () => {},
    });
    clients.push(peer);
    await c.createMailbox('q');
    let started, release, received, activeSignal;
    const active = new Promise((resolve) => {
      started = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const resumed = new Promise((resolve) => {
      received = resolve;
    });
    const errors = [];
    const listener = c.listen(
      'q',
      async (delivery, context) => {
        if (delivery.message.body === 'held') {
          activeSignal = context.signal;
          started();
          await held;
        } else {
          received();
        }
      },
      { concurrency: 2, onError: (error) => errors.push(error) },
    );
    try {
      await peer.send({ to: 'q', body: 'held' });
      await active;
      await delay(30);
      offline = true;
      for (const socket of connections) {
        socket.destroy();
      }
      await peer.send({ to: 'q', body: 'after-recovery' });
      await delay(400);
      assert.equal(activeSignal.aborted, false, 'idle slot timeout cancelled a confirmed claim');
      offline = false;
      await Promise.race([
        resumed,
        delay(2500).then(() => {
          throw new Error('Listener did not recover');
        }),
      ]);
      assert.equal(activeSignal.aborted, false);
      assert.deepEqual(errors, []);
    } finally {
      offline = false;
      release();
      await listener.close();
    }
  });
  await test('lost cleanup reply does not misclassify an undispatched send as uncertain', async () => {
    const c = await open();
    await c.createMailbox('q');
    dropAction = 'sweep';
    await c.send({ to: 'q', body: 'after cleanup' });
    const deliveries = await c.receive('q');
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].message.body, 'after cleanup');
    await c.ack(deliveries[0].receipt);
  });
  await test('escaped terminal error text fits the reserved delivery budget', async () => {
    const c = await open({ config: { maxAttempts: 1, maxContentBytes: 20000 } });
    await c.createMailbox('q');
    await c.send({ to: 'q', body: 'small' });
    const [delivery] = await c.receive('q');
    assert.equal((await c.fail(delivery.receipt, '\0'.repeat(4096))).status, 'released');
    const history = await c.history();
    assert.equal(history[0].deliveries[0].state, 'failed');
    assert.equal(history[0].deliveries[0].error, '\0'.repeat(4096));
  });
  await test('wrong-type or malformed store metadata is terminal instead of uncertain', async () => {
    for (const corruption of ['wrong-type', 'malformed']) {
      const store = randomUUID();
      const c = await open({}, store);
      const root = messagingKey(namespace, store);
      if (corruption === 'wrong-type') {
        await admin.del(root);
        await admin.set(root, 'replacement');
      } else {
        await admin.hSet(root, 'meta', '{invalid');
      }
      await assert.rejects(c.agents(), (error) => error.code === 'STATE_LOST');
      await assert.rejects(
        c.send({ to: 'q', body: 'no recreation' }),
        (error) => error.code === 'STATE_LOST',
      );
      await c.close();
    }
  });
  await test('subscription waits and confirmed inactivity survive transient refresh failures', async () => {
    const store = randomUUID();
    const c = await open({ operationTimeoutMs: 100, config: { claimTtlMs: 3000 } }, store);
    const peer = await openRedisMessaging({
      url: redis.url,
      namespace,
      store,
      onReadinessWarning: () => {},
    });
    clients.push(peer);
    const durable = await c.subscribe('durable-outage', { topics: ['durable-outage'] });
    const temporary = await c.subscribe('temporary-outage', {
      topics: ['temporary-outage'],
      inactivityTtlMs: 2400,
    });
    let started, release, activeSignal;
    const active = new Promise((resolve) => {
      started = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const listener = temporary.listen(
      async (_delivery, context) => {
        activeSignal = context.signal;
        started();
        await held;
      },
      { onError: () => {} },
    );
    try {
      await peer.publish({ topic: 'temporary-outage', body: 'held' });
      await active;
      offline = true;
      for (const socket of connections) {
        socket.destroy();
      }
      const waiting = durable.wait({ timeoutMs: 4000 });
      await peer.publish({ topic: 'durable-outage', body: 'retained' });
      await delay(1100);
      assert.equal(
        activeSignal.aborted,
        false,
        'refresh error shortened confirmed subscription lifetime',
      );
      offline = false;
      const delivery = await waiting;
      assert.equal(delivery.message.body, 'retained');
      await peer.ack(delivery.receipt);
      assert.equal(activeSignal.aborted, false);
    } finally {
      offline = false;
      release();
      await listener.close();
    }
  });
  await test('an uncertain listener claim is explicit and stays fenced until expiry', async () => {
    const store = randomUUID();
    const c = await open({ config: { claimTtlMs: 1000, retryDelayMs: 1 } }, store);
    const peer = await openRedisMessaging({
      url: redis.url,
      namespace,
      store,
      onReadinessWarning: () => {},
    });
    clients.push(peer);
    await c.createMailbox('q');
    await c.send({ to: 'q', body: 'lost-claim' });
    const errors = [];
    let calls = 0;
    dropAction = 'receive';
    const stopped = c.listen('q', () => calls++, { onError: (error) => errors.push(error) });
    await assert.rejects(
      stopped.done,
      (error) => error instanceof AggregateError && error.errors[0].code === 'UNCERTAIN',
    );
    assert.equal(calls, 0);
    assert.equal(errors.length, 1);
    assert.deepEqual(await peer.receive('q'), [], 'an uncertain claim was immediately stolen');
    await peer.send({ to: 'q', body: 'fresh' });
    const deliveries = [];
    let received;
    const completed = new Promise((resolve) => {
      received = resolve;
    });
    const restarted = peer.listen('q', (delivery) => {
      deliveries.push([delivery.message.body, delivery.attempt]);
      if (deliveries.length === 2) {
        received();
      }
    });
    try {
      await Promise.race([
        completed,
        delay(3000).then(() => {
          throw new Error('Explicit listener restart did not recover both deliveries');
        }),
      ]);
      assert.deepEqual(deliveries, [
        ['fresh', 1],
        ['lost-claim', 2],
      ]);
    } finally {
      await restarted.close();
    }
  });
  await test('an old subscription snapshot cannot turn transport uncertainty into retirement', async () => {
    const store = randomUUID();
    const c = await open({}, store);
    const peer = await openRedisMessaging({
      url: redis.url,
      namespace,
      store,
      onReadinessWarning: () => {},
    });
    clients.push(peer);
    const old = await c.subscribe('kept-alive', {
      topics: ['kept-alive'],
      inactivityTtlMs: 1800,
    });
    const fresh = await peer.subscription('kept-alive');
    const keeper = fresh.listen(() => {});
    try {
      await delay(2000);
      assert.ok(old.info.expiresAt < Date.now());
      assert.ok((await peer.subscription('kept-alive')).info.expiresAt > Date.now());
    } finally {
      await keeper.close();
    }
    dropAction = 'subscription-touch';
    await assert.rejects(old.wait({ timeoutMs: 3000 }), (error) => error.code === 'UNCERTAIN');
    await c.info();
    await peer.publish({ topic: 'kept-alive', body: 'still-live' });
    const delivery = await old.wait({ timeoutMs: 3000 });
    assert.equal(delivery.message.body, 'still-live');
    await peer.ack(delivery.receipt);
  });
  await test('event retention trims oldest records without scanning history on info', async () => {
    const c = await open({ config: { maxEvents: 3 } });
    for (let i = 0; i < 8; i++) {
      await c.append({ kind: 'audit', payload: String(i) });
    }
    assert.deepEqual(
      (await c.events()).map((event) => event.payload),
      ['5', '6', '7'],
    );
    const calls = async () =>
      Number(
        (await admin.info('commandstats')).match(/cmdstat_zrangebyscore:calls=(\d+)/)?.[1] ?? 0,
      );
    const before = await calls();
    await c.info();
    assert.equal(await calls(), before, 'read-only info scanned retained event history');
  });
  console.log(`RESULT ${passed}/${passed} passed`);
} finally {
  offline = false;
  await Promise.allSettled(clients.map((c) => c.close()));
  for (const socket of connections) {
    socket.destroy();
  }
  await new Promise((r) => proxy.close(r));
  admin.destroy();
  await redis.close();
}
