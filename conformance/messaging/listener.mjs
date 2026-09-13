import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openMessaging, commandHandler } from '../../packages/messaging/dist/src/index.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/listener-');
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const deferred = () => {
  let resolveValue;
  const promise = new Promise((r) => {
    resolveValue = r;
  });
  return { promise, resolve: resolveValue };
};
let passed = 0;
async function scenario(label, run) {
  const c = await openMessaging({
    path: resolve(directory, String(passed)),
    config: { claimTtlMs: 150, maxHandlingMs: 1500, retryDelayMs: 5 },
  });
  try {
    await c.createMailbox('a');
    await run(c);
    console.log('PASS ' + label);
    passed++;
  } finally {
    await c.close();
  }
}
await scenario('listener automatically acknowledges durable handoff', async (c) => {
  const handled = deferred();
  const listener = c.listen('a', (d) => {
    assert.equal(d.message.body, 'x');
    handled.resolve();
  });
  await c.send({ to: 'a', body: 'x' });
  await handled.promise;
  await listener.close();
  assert.equal((await c.history())[0].deliveries[0].state, 'acked');
});
await scenario('renewal preserves claim beyond original deadline', async (c) => {
  const handled = deferred(),
    finish = deferred();
  let receipt;
  const listener = c.listen('a', async (d) => {
    receipt = d.receipt;
    handled.resolve();
    await finish.promise;
  });
  await c.send({ to: 'a', body: 'x' });
  await handled.promise;
  await pause(400);
  assert.deepEqual(await c.receive('a'), []);
  assert.equal((await c.renew(receipt)).status, 'renewed');
  finish.resolve();
  await listener.close();
  assert.equal((await c.history())[0].deliveries[0].state, 'acked');
});
await scenario('manual acknowledgment may follow handler return', async (c) => {
  const handled = deferred();
  const listener = c.listen('a', (d) => handled.resolve(d), { ackMode: 'manual' });
  await c.send({ to: 'a', body: 'x', ackMode: 'manual' });
  const d = await handled.promise;
  await listener.close();
  assert.equal((await c.history())[0].deliveries[0].state, 'claimed');
  await c.ack(d.receipt);
});
await scenario('handler failures retry with the same delivery identity', async (c) => {
  const handled = deferred();
  let calls = 0,
    id;
  const errors = [];
  const listener = c.listen(
    'a',
    (d) => {
      if (id) {
        assert.equal(d.id, id);
      }
      id = d.id;
      calls++;
      if (calls < 3) {
        throw undefined;
      }
      handled.resolve();
    },
    { onError: (e) => errors.push(e) },
  );
  await c.send({ to: 'a', body: 'x' });
  await handled.promise;
  await listener.close();
  assert.equal(calls, 3);
  assert.deepEqual(errors, [undefined, undefined]);
  assert.equal((await c.history())[0].deliveries[0].state, 'acked');
});
await scenario('maximum handling duration signals cancellation', async (c) => {
  const started = deferred(),
    cancelled = deferred();
  const errors = [];
  const listener = c.listen(
    'a',
    async (_d, context) => {
      started.resolve();
      await new Promise((r) => context.signal.addEventListener('abort', r, { once: true }));
      cancelled.resolve();
    },
    { maxHandlingMs: 180, onError: (e) => errors.push(e) },
  );
  await c.send({ to: 'a', body: 'x' });
  await started.promise;
  const closed = listener.close();
  await cancelled.promise;
  await closed;
  assert.ok(errors.length);
  assert.equal((await c.history())[0].deliveries[0].state, 'claimed');
});
await scenario('close finishes active handlers without draining pending messages', async (c) => {
  const started = deferred(),
    finish = deferred();
  let calls = 0;
  const listener = c.listen('a', async () => {
    calls++;
    started.resolve();
    await finish.promise;
  });
  await c.send({ to: 'a', body: 'first' });
  await c.send({ to: 'a', body: 'second' });
  await started.promise;
  const closing = listener.close();
  await pause(200);
  finish.resolve();
  await closing;
  assert.equal(calls, 1);
  assert.deepEqual(
    (await c.history()).map((m) => m.deliveries[0].state),
    ['acked', 'pending'],
  );
});
await scenario('explicit cancellation awaits handler cleanup then retries', async (c) => {
  const started = deferred(),
    cleanup = deferred();
  const listener = c.listen(
    'a',
    async (_d, context) => {
      started.resolve();
      await new Promise((r) => context.signal.addEventListener('abort', r, { once: true }));
      await cleanup.promise;
      throw new Error('cancelled');
    },
    { onError() {} },
  );
  await c.send({ to: 'a', body: 'x' });
  await started.promise;
  const closing = listener.close({ cancel: true });
  assert.deepEqual(await c.receive('a'), []);
  cleanup.resolve();
  await closing;
  assert.equal((await c.history())[0].deliveries[0].state, 'pending');
});
await scenario('external command receives JSON and success acknowledges', async (c) => {
  const handler = commandHandler([
    process.execPath,
    '-e',
    "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const d=JSON.parse(s);process.exit(d.message.body==='command'?0:1)})",
  ]);
  const handled = deferred();
  const listener = c.listen('a', async (d, context) => {
    await handler(d, context);
    handled.resolve();
  });
  await c.send({ to: 'a', body: 'command' });
  await handled.promise;
  await listener.close();
  assert.equal((await c.history())[0].deliveries[0].state, 'acked');
});
await scenario('client close rejects new sends and waits for its listener', async (c) => {
  const started = deferred(),
    finish = deferred();
  c.listen('a', async () => {
    started.resolve();
    await finish.promise;
  });
  await c.send({ to: 'a', body: 'x' });
  await started.promise;
  const closing = c.close();
  await assert.rejects(c.send({ to: 'a', body: 'late' }), (e) => e.code === 'CLOSED');
  finish.resolve();
  await closing;
});
console.log(`RESULT ${passed}/${passed} passed`);
