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
