import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const redisMode = process.argv.includes('--redis');
const clients = [];
let redis, open;
if (redisMode) {
  const { server } = await import('../redis/harness.mjs');
  redis = await server();
  const { openRedisMessaging } = await import('../../packages/redis/dist/messaging.js');
  open = async (config = {}) => {
    const c = await openRedisMessaging({
      url: redis.url,
      namespace: 'topics',
      store: randomUUID(),
      config,
      onReadinessWarning: () => {},
    });
    clients.push(c);
    return c;
  };
} else {
  const { openMessaging } = await import('../../packages/messaging/dist/src/index.js');
  await mkdir('.tmp/messaging', { recursive: true });
  open = async (config = {}) => {
    const c = await openMessaging({
      path: await mkdtemp(resolve('.tmp/messaging/topics-')),
      config,
    });
    clients.push(c);
    return c;
  };
}
let passed = 0;
const test = async (name, fn) => {
  await fn();
  console.log('PASS ' + name);
  passed++;
};
console.log(
  `backend=${redisMode ? 'redis' : 'sqlite'} runtime=${process.versions.bun ?? process.version} platform=${process.platform}`,
);
try {
  await test('future-only exact filters and dedupe keep the original recipient snapshot', async () => {
    const c = await open();
    await assert.rejects(c.publish({ topic: 'turn', body: 'none' }), (e) => e.code === 'REFUSED');
    const a = await c.subscribe('a', { topics: ['turn', 'question'] }),
      b = await c.subscribe('b', { topics: ['turn'] });
    const sent = await c.publish({ topic: 'turn', body: 'done', dedupeKey: 'once' });
    const later = await c.subscribe('later', { topics: ['turn'] });
    assert.deepEqual(await c.publish({ topic: 'turn', body: 'done', dedupeKey: 'once' }), {
      ...sent,
      deduplicated: true,
    });
    assert.equal((await a.receive()).length, 1);
    assert.equal((await b.receive()).length, 1);
    assert.deepEqual(await later.receive(), []);
    await assert.rejects(
      c.publish({ topic: 'turn.next', body: 'none' }),
      (e) => e.code === 'REFUSED',
    );
  });
  await test('workers sharing a name compete; full fanout refuses without partial delivery', async () => {
    const c = await open({ maxPendingPerRecipient: 1 });
    const a = await c.subscribe('a', { topics: ['t'] }),
      same = await c.subscription('a'),
      b = await c.subscribe('b', { topics: ['t'] });
    await c.publish({ topic: 't', body: 'one' });
    const [d] = await a.receive();
    assert.deepEqual(await same.receive(), []);
    await c.ack(d.receipt);
    await assert.rejects(c.publish({ topic: 't', body: 'two' }), (e) => e.code === 'REFUSED');
    assert.deepEqual(await a.receive(), []);
    const [e] = await b.receive();
    await c.ack(e.receipt);
    await c.publish({ topic: 't', body: 'three' });
    assert.equal((await same.receive()).length, 1);
  });
  await test('direct topic metadata never publishes and reserved queues reject direct sends', async () => {
    const c = await open();
    const sub = await c.subscribe('a', { topics: ['t'] });
    await c.createMailbox('inbox');
    await c.send({ to: 'inbox', topic: 't', body: 'direct' });
    assert.deepEqual(await sub.receive(), []);
    await assert.rejects(
      c.send({ to: sub.info.recipient, body: 'bypass' }),
      (e) => e.code === 'REFUSED',
    );
  });
  await test('retirement cancels claims; a recreated name has a different generation', async () => {
    const c = await open();
    const sub = await c.subscribe('a', { topics: ['t'] });
    await c.publish({ topic: 't', body: 'old' });
    const [old] = await sub.receive();
    await sub.remove();
    assert.equal((await c.ack(old.receipt)).status, 'stale');
    const next = await c.subscribe('a', { topics: ['t'] });
    assert.notEqual(next.info.id, sub.info.id);
    assert.deepEqual(await next.receive(), []);
    await assert.rejects(sub.receive());
    assert.equal((await c.history())[0].deliveries[0].state, 'cancelled');
  });
  await test('inactive expiry fences receipts while an active idle waiter renews its subscription', async () => {
    const c = await open();
    const old = await c.subscribe('expiring', { topics: ['t'], inactivityTtlMs: 80 });
    await c.publish({ topic: 't', body: 'old' });
    const [d] = await old.receive();
    await delay(100);
    assert.equal((await c.ack(d.receipt)).status, 'stale');
    const sub = await c.subscribe('live', { topics: ['new'], inactivityTtlMs: 180 });
    const waiting = sub.wait({ timeoutMs: 2000 });
    await delay(480);
    await c.publish({ topic: 'new', body: 'arrived' });
    const received = await waiting;
    assert.equal(received.message.body, 'arrived');
    await c.ack(received.receipt);
  });
  await test('subscription option drift fails and duplicate topics are invalid', async () => {
    const c = await open();
    await c.subscribe('a', { topics: ['t'] });
    await assert.rejects(c.subscribe('a', { topics: ['u'] }), (e) => e.code === 'CONFIG_MISMATCH');
    await assert.rejects(c.subscribe('bad', { topics: ['t', 't'] }), (e) => e.code === 'INPUT');
  });
  await test('graceful client close renews temporary subscriptions until handlers finish', async () => {
    const c = await open({ claimTtlMs: 200 });
    const sub = await c.subscribe('temporary', { topics: ['t'], inactivityTtlMs: 150 });
    let started;
    const entered = new Promise((r) => (started = r));
    let finished = false;
    sub.listen(async (d, ctx) => {
      started();
      await delay(360);
      assert.equal(ctx.signal.aborted, false);
      finished = true;
    });
    await c.publish({ topic: 't', body: 'work' });
    await entered;
    await c.close();
    assert.equal(finished, true);
  });
  await test('subscription wait includes refresh time and pre-abort performs no refresh', async () => {
    const c = await open(),
      sub = await c.subscribe('temporary', { topics: ['t'] });
    const original = c.subscriptionCommand.bind(c);
    let touches = 0;
    c.subscriptionCommand = async (...args) => {
      if (args[0] === 'subscription-touch') {
        touches++;
        await delay(80);
      }
      return original(...args);
    };
    const started = performance.now();
    const wallTime = Date.now,
      frozenTime = wallTime();
    Date.now = () => frozenTime;
    try {
      assert.equal(await sub.wait({ timeoutMs: 10 }), null);
    } finally {
      Date.now = wallTime;
    }
    assert.ok(performance.now() - started < 65);
    const before = touches,
      abort = new AbortController();
    abort.abort();
    await assert.rejects(sub.wait({ signal: abort.signal }), (e) => e.code === 'ABORTED');
    assert.equal(touches, before);
    c.subscriptionCommand = original;
    await delay(90);
  });
  await test('legal legacy mailbox names remain usable with topic support', async () => {
    const c = await open();
    await c.createMailbox('@subscription:worker');
    await c.send({ to: '@subscription:worker', body: 'legacy' });
    const [d] = await c.receive('@subscription:worker');
    assert.equal((await c.ack(d.receipt)).status, 'acked');
  });
  await test('finishing a wait aborts its queued recurring activity renewal', async () => {
    const c = await open(),
      sub = await c.subscribe('renew', { topics: ['t'], inactivityTtlMs: 300 });
    const original = c.subscriptionCommand.bind(c);
    let touches = 0,
      lateSignal,
      lateDeadline;
    c.subscriptionCommand = (action, args, signal) => {
      if (action === 'subscription-touch' && ++touches > 1) {
        lateSignal = signal;
        lateDeadline = args.deadline;
        return new Promise((resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }),
        );
      }
      return original(action, args, signal);
    };
    try {
      assert.equal(await sub.wait({ timeoutMs: 180 }), null);
      assert.ok(lateDeadline);
      assert.equal(lateSignal.aborted, true);
    } finally {
      c.subscriptionCommand = original;
    }
  });
  await test('failed deliveries cannot be retried into a retired subscription generation', async () => {
    const c = await open({ maxAttempts: 1 });
    const sub = await c.subscribe('retired-retry', { topics: ['retry'] });
    await c.publish({ topic: 'retry', body: 'failed' });
    const delivery = await sub.wait({ timeoutMs: 1000 });
    await c.fail(delivery.receipt, 'failed handler');
    await sub.remove();
    await c.subscribe('retired-retry', { topics: ['retry'] });
    await assert.rejects(c.retry(delivery.id), (error) =>
      ['REFUSED', 'STALE'].includes(error.code),
    );
    assert.equal((await c.history())[0].deliveries[0].state, 'failed');
  });
  console.log(`RESULT ${passed}/${passed} passed`);
} finally {
  await Promise.allSettled(clients.map((c) => c.close()));
  await redis?.close();
}
