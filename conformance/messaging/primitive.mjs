import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/primitive-');
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const config = { claimTtlMs: 120, retryDelayMs: 5, maxHandlingMs: 1000 };
let passed = 0;
async function scenario(label, run) {
  const clients = [];
  const open = async (suffix = label.replaceAll(/\W/g, '-'), settings = config) => {
    const client = await openMessaging({
      path: resolve(directory, suffix),
      config: settings,
      onWarning() {},
    });
    clients.push(client);
    return client;
  };
  try {
    await run(open);
    console.log('PASS ' + label);
    passed++;
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }
}
function participant(mode, path, recipient, settings = config) {
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      'conformance/messaging/participant.mjs',
      mode,
      path,
      recipient,
      JSON.stringify(settings),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  return { child, output: () => output, finished: once(child, 'exit') };
}
await scenario('cross-process claim survives command exit and duplicate ack', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  await c.send({ to: 'inbox', body: 'hello' });
  const p = participant('wait', c.path, 'inbox');
  assert.deepEqual(await p.finished, [0, null]);
  const delivery = JSON.parse(p.output());
  assert.equal(delivery.message.body, 'hello');
  assert.equal((await c.ack(delivery.receipt)).status, 'acked');
  assert.equal((await c.ack(delivery.receipt)).status, 'acked');
});
await scenario('idle waiter wakes on another process send', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  const received = c.wait('inbox', { timeoutMs: 5000 });
  const p = participant('send', c.path, 'inbox');
  await p.finished;
  const delivery = await received;
  assert.equal(delivery.message.body, 'from child');
  await c.ack(delivery.receipt);
});
await scenario('queued cancellation and timeout leave no claims', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  const controller = new AbortController();
  const waiting = c.wait('inbox', { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (e) => e.code === 'ABORTED');
  assert.equal(await c.wait('inbox', { timeoutMs: 10 }), null);
  assert.deepEqual(await c.history(), []);
});
await scenario('live claim expires and stale operations preserve replacement', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  await c.send({ to: 'inbox', body: '' });
  const [first] = await c.receive('inbox');
  const next = await c.wait('inbox', { timeoutMs: 2000 });
  assert.notEqual(first.receipt.claimId, next.receipt.claimId);
  assert.equal(first.id, next.id);
  assert.equal((await c.ack(first.receipt)).status, 'stale');
  assert.equal((await c.release(first.receipt)).status, 'stale');
  assert.equal((await c.renew(first.receipt)).status, 'stale');
  assert.equal((await c.ack(next.receipt)).status, 'acked');
});
await scenario('renewal remains bounded by handling deadline', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  await c.send({ to: 'inbox', body: 'x' });
  const [d] = await c.receive('inbox', { claimTtlMs: 100, maxHandlingMs: 180 });
  const renewed = await c.renew(d.receipt, 1000);
  assert.equal(renewed.expiresAt, d.handlingExpiresAt);
  await pause(190);
  assert.equal((await c.renew(d.receipt)).status, 'stale');
});
await scenario('five attempts exhaust and explicit retry resets budget', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  await c.send({ to: 'inbox', body: 'x' });
  let last;
  for (let i = 1; i <= 5; i++) {
    last = await c.wait('inbox', { timeoutMs: 2000 });
    assert.equal(last.attempt, i);
    await c.fail(last.receipt, 'failed');
  }
  assert.equal((await c.history())[0].deliveries[0].state, 'failed');
  await c.retry(last.id);
  assert.equal((await c.receive('inbox'))[0].attempt, 1);
});
await scenario('message expiration ends delivery eligibility', async (open) => {
  const c = await open();
  await c.createMailbox('inbox');
  await c.send({ to: 'inbox', body: 'x', expiresInMs: 20 });
  await pause(30);
  assert.deepEqual(await c.receive('inbox'), []);
  assert.equal((await c.history())[0].deliveries[0].state, 'expired');
});
await scenario(
  'dedupe ignores current broadcast population and rejects conflicts',
  async (open) => {
    const c = await open();
    await c.createMailbox('a');
    await c.createMailbox('b');
    await c.register('a');
    const first = await c.send({ to: '*', body: 'x', dedupeKey: 'same' });
    await c.register('b');
    const second = await c.send({ to: '*', body: 'x', dedupeKey: 'same' });
    assert.deepEqual(second.recipients, ['a']);
    assert.equal(first.id, second.id);
    assert.equal(second.deduplicated, true);
    await assert.rejects(
      c.send({ to: '*', body: 'different', dedupeKey: 'same' }),
      (e) => e.code === 'REFUSED',
    );
  },
);
await scenario('broadcast all-or-nothing capacity and independent acks', async (open) => {
  const c = await open(undefined, { ...config, maxPendingPerRecipient: 1 });
  for (const name of ['a', 'b']) {
    await c.createMailbox(name);
    await c.register(name);
  }
  await c.send({ to: 'a', body: 'full' });
  await assert.rejects(c.send({ to: '*', body: 'broadcast' }));
  assert.equal((await c.history()).length, 1);
  const [first] = await c.receive('a');
  await c.ack(first.receipt);
  await c.send({ to: '*', body: 'broadcast' });
  const [a] = await c.receive('a'),
    [b] = await c.receive('b');
  await c.ack(a.receipt);
  assert.equal((await c.history())[1].deliveries.find((d) => d.recipient === 'b').state, 'claimed');
  await c.ack(b.receipt);
});
await scenario('dead registration is replaced without losing mailbox messages', async (open) => {
  const c = await open();
  await c.createMailbox('a');
  await c.send({ to: 'a', body: 'survives' });
  const p = participant('hold', c.path, 'a');
  await once(p.child.stdout, 'data');
  await assert.rejects(c.register('a'));
  p.child.kill('SIGKILL');
  await p.finished;
  assert.equal((await c.agents())[0].online, false);
  await c.register('a');
  assert.equal((await c.receive('a'))[0].message.body, 'survives');
});
await scenario('config warning adoption and opt-in rejection', async (open) => {
  const c = await open();
  let warning;
  const peer = await openMessaging({
    path: c.path,
    config: { ...config, maxAttempts: 2 },
    onWarning(d) {
      warning = d;
    },
  });
  try {
    assert.equal(peer.config.maxAttempts, 5);
    assert.equal(warning[0].field, 'maxAttempts');
  } finally {
    await peer.close();
  }
  await assert.rejects(
    openMessaging({ path: c.path, config: { ...config, maxAttempts: 2 }, configMismatch: 'error' }),
    (e) => e.code === 'CONFIG_MISMATCH',
  );
  assert.deepEqual(await c.agents(), []);
});
await scenario('policy incompatibility fails before a handler can receive', async (open) => {
  const c = await open();
  await c.createMailbox('a');
  await c.send({ to: 'a', body: 'x', ackMode: 'manual' });
  assert.deepEqual(await c.receive('a', { ackMode: 'handler-success' }), []);
  assert.equal((await c.history())[0].deliveries[0].state, 'failed');
});
await scenario('history eviction retains dedupe and pending bodies', async (open) => {
  const c = await open(undefined, { ...config, maxMessages: 1 });
  await c.createMailbox('a');
  const old = await c.send({ to: 'a', body: 'old', dedupeKey: 'key' });
  const [d] = await c.receive('a');
  await c.ack(d.receipt);
  await c.send({ to: 'a', body: 'new' });
  assert.equal((await c.send({ to: 'a', body: 'old', dedupeKey: 'key' })).id, old.id);
  const records = await c.history();
  assert.equal(records[0].message, null);
  assert.equal(records[1].message.body, 'new');
  await assert.rejects(c.send({ to: 'a', body: 'cannot evict pending' }));
});
await scenario('close cancels a native wait before descriptor teardown', async (open) => {
  const c = await open();
  await c.createMailbox('a');
  const waiting = c.wait('a');
  const rejected = assert.rejects(waiting);
  await c.close();
  await rejected;
});
await scenario(
  'two participants exchange twenty messages through short-lived waiters',
  async (open) => {
    const c = await open();
    await c.createMailbox('a');
    await c.createMailbox('b');
    const a = participant('exchange', c.path, 'a'),
      b = participant('exchange', c.path, 'b');
    assert.deepEqual(await a.finished, [0, null]);
    assert.deepEqual(await b.finished, [0, null]);
    assert.equal(JSON.parse(a.output()).received, 10);
    assert.equal(JSON.parse(b.output()).received, 10);
    const messages = await c.history();
    assert.equal(messages.length, 20);
    assert.ok(messages.every((message) => message.deliveries[0].state === 'acked'));
  },
);
await scenario('SIGKILL claimant leaves receipt valid until its computed expiry', async (open) => {
  const c = await open();
  await c.createMailbox('a');
  await c.send({ to: 'a', body: 'recover' });
  const p = participant('claim-hold', c.path, 'a');
  await once(p.child.stdout, 'data');
  const first = JSON.parse(p.output());
  p.child.kill('SIGKILL');
  await p.finished;
  assert.deepEqual(await c.receive('a'), []);
  const replacement = await c.wait('a', { timeoutMs: 3000 });
  assert.equal(replacement.id, first.id);
  assert.notEqual(replacement.receipt.claimId, first.receipt.claimId);
  assert.equal((await c.ack(first.receipt)).status, 'stale');
  await c.ack(replacement.receipt);
});
console.log(`RESULT ${passed}/${passed} passed`);
