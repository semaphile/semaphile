import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { server, connect } from './harness.mjs';
import { openRedisMessaging, messagingKey } from '../../packages/redis/dist/messaging.js';
const redis = await server(),
  clients = [];
let passed = 0;
const open = async (extra = {}, store = randomUUID()) => {
  const c = await openRedisMessaging({
    url: redis.url,
    namespace: 'conformance',
    store,
    onReadinessWarning: () => {},
    ...extra,
  });
  clients.push(c);
  return c;
};
const test = async (name, fn) => {
  await fn();
  console.log('PASS ' + name);
  passed++;
};
try {
  await test('direct delivery survives independent clients; ack is fenced and idempotent', async () => {
    const store = randomUUID(),
      a = await open({}, store),
      b = await open({}, store);
    await a.createMailbox('inbox');
    const sent = await a.send({ to: 'inbox', body: 'hello', dedupeKey: 'id' });
    assert.equal((await a.send({ to: 'inbox', body: 'hello', dedupeKey: 'id' })).id, sent.id);
    const [d] = await b.receive('inbox');
    assert.equal(d.message.body, 'hello');
    assert.equal((await a.ack({ ...d.receipt, claimId: 'wrong' })).status, 'stale');
    assert.equal((await b.ack(d.receipt)).status, 'acked');
    assert.equal((await a.ack(d.receipt)).status, 'acked');
    assert.deepEqual(await a.receive('inbox'), []);
    const [h] = await a.history();
    assert.equal(h.deliveries[0].state, 'acked');
    assert.ok(h.createdAt > 1e12);
  });
  await test('wait wakes on publication and cancellation leaves capacity intact', async () => {
    const c = await open();
    await c.createMailbox('q');
    const ctrl = new AbortController();
    const waiting = c.wait('q', { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(waiting, (e) => e.code === 'ABORTED');
    const wake = c.wait('q', { timeoutMs: 15000 });
    await c.send({ to: 'q', body: 'wake' });
    const d = await wake;
    assert.ok(d);
    await c.ack(d.receipt);
    assert.equal(await c.wait('q', { timeoutMs: 150 }), null);
    assert.equal(await c.wait('q', { timeoutMs: 0 }), null);
  });
  await test('claim expiry retries and an old receipt cannot acknowledge its replacement', async () => {
    const c = await open({ config: { claimTtlMs: 40, retryDelayMs: 1 } });
    await c.createMailbox('q');
    await c.send({ to: 'q', body: 'retry' });
    const [old] = await c.receive('q');
    await delay(60);
    const next = await c.wait('q', { timeoutMs: 500 });
    assert.equal(next.attempt, 2);
    assert.equal((await c.ack(old.receipt)).status, 'stale');
    assert.equal((await c.ack(next.receipt)).status, 'acked');
  });
  await test('broadcast takes one delivery per online mailbox and fails atomically when full', async () => {
    const c = await open({ config: { maxPendingPerRecipient: 1 } });
    for (const q of ['a', 'b']) {
      await c.createMailbox(q);
    }
    await c.register('a');
    await assert.rejects(c.register('a'), (e) => e.code === 'REFUSED');
    await c.register('b');
    await c.send({ to: 'b', body: 'full' });
    await assert.rejects(c.send({ to: '*', body: 'broadcast' }), (e) => e.code === 'REFUSED');
    assert.deepEqual(await c.receive('a'), []);
    const [b] = await c.receive('b');
    await c.ack(b.receipt);
    const r = await c.send({ to: '*', body: 'both' });
    assert.deepEqual(r.recipients, ['a', 'b']);
  });
  await test('config error and strict readiness refuse startup without creating a store', async () => {
    const store = randomUUID();
    await open({}, store);
    await assert.rejects(
      open({ config: { maxAttempts: 2 }, configMismatch: 'error' }, store),
      (e) => e.code === 'CONFIG_MISMATCH',
    );
    const bad = randomUUID();
    await assert.rejects(open({ readiness: 'strict' }, bad), (e) => e.code === 'READINESS');
    const admin = await connect(redis.url);
    try {
      assert.equal(await admin.exists(messagingKey('conformance', bad)), 0);
    } finally {
      admin.destroy();
    }
  });
  await test('listener renews a remote claim through the shared lifecycle', async () => {
    const c = await open({ config: { claimTtlMs: 120, maxHandlingMs: 2000 } });
    await c.createMailbox('q');
    let done;
    const completed = new Promise((r) => (done = r));
    const listener = c.listen('q', async (d, ctx) => {
      await delay(280);
      assert.equal(ctx.signal.aborted, false);
      done();
    });
    try {
      await c.send({ to: 'q', body: 'long' });
      await completed;
    } finally {
      await listener.close();
    }
    assert.equal((await c.history())[0].deliveries[0].state, 'acked');
  });
  console.log(`RESULT ${passed}/${passed} passed`);
} finally {
  await Promise.allSettled(clients.map((c) => c.close()));
  await redis.close();
}
