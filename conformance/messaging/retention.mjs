import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
import { Database } from '../../packages/messaging/dist/src/database.js';
import { Presence } from '../../packages/messaging/dist/src/presence.js';
import { normalize } from '../../packages/messaging/dist/src/config.js';
import { contentBytes } from '../../packages/messaging/dist/src/storage.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/retention-');
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function scenario(label, config, run) {
  const c = await openMessaging({ path: join(directory, String(passed)), config });
  try {
    await c.createMailbox('a');
    await run(c);
    console.log('PASS ' + label);
    passed++;
  } finally {
    await c.close();
  }
}
await scenario(
  'cleanup makes progress past retained dedupe tombstones',
  { maxMessages: 2 },
  async (c) => {
    for (let i = 0; i < 270; i++) {
      await c.send({ to: 'a', body: 'history', dedupeKey: String(i) });
      const [d] = await c.receive('a');
      await c.ack(d.receipt);
    }
    const history = await c.history({ limit: 1000 });
    assert.equal(history.length, 270);
    assert.ok(history.filter((m) => m.message !== null).length <= 2);
    assert.equal((await c.send({ to: 'a', body: 'history', dedupeKey: '0' })).deduplicated, true);
  },
);
await scenario(
  'expired unattended messages do not permanently fill an inbox',
  { maxPendingPerRecipient: 1 },
  async (c) => {
    await c.send({ to: 'a', body: 'old', expiresInMs: 5 });
    await pause(10);
    await c.send({ to: 'a', body: 'new' });
    assert.equal((await c.receive('a'))[0].message.body, 'new');
  },
);
await scenario(
  'event append respects logical content bounds',
  { maxContentBytes: 20000 },
  async (c) => {
    for (let i = 0; i < 5; i++) {
      await c.append({ kind: 'test', payload: 'x'.repeat(16000) });
    }
    const db = new Database(c.path, normalize({ maxContentBytes: 20000 }), 'error');
    try {
      assert.ok(db.locked(() => contentBytes(db)) <= 20000);
    } finally {
      db.close();
    }
    assert.equal((await c.events()).length, 1);
  },
);
await scenario(
  'dedupe window survives early history eviction then expires',
  { retainHistoryMs: 5, dedupeRetentionMs: 100, maxMessages: 1 },
  async (c) => {
    const first = await c.send({ to: 'a', body: 'old', dedupeKey: 'key' });
    const [d] = await c.receive('a');
    await c.ack(d.receipt);
    await pause(10);
    await c.send({ to: 'a', body: 'trigger' });
    assert.equal((await c.send({ to: 'a', body: 'old', dedupeKey: 'key' })).id, first.id);
    const [next] = await c.receive('a');
    await c.ack(next.receipt);
    await pause(110);
    const replacement = await c.send({ to: 'a', body: 'old', dedupeKey: 'key' });
    assert.notEqual(replacement.id, first.id);
  },
);
await scenario('unregister failure still retires every owned lifetime lock', {}, async (c) => {
  await c.createMailbox('b');
  const db = new Database(c.path, normalize(), 'error'),
    presence = new Presence(db);
  const a = db.locked(() => presence.register('a')),
    b = db.locked(() => presence.register('b'));
  const mutate = db.mutate.bind(db);
  let calls = 0;
  db.mutate = (...args) => {
    if (++calls === 1) {
      throw new Error('injected failure');
    }
    return mutate(...args);
  };
  db.locked(() => assert.throws(() => presence.close(), AggregateError));
  assert.equal(db.native.alive(join(c.path, 'owners', a.id + '.lock')), false);
  assert.equal(db.native.alive(join(c.path, 'owners', b.id + '.lock')), false);
  db.close();
});
await scenario('invalid shared settings and mismatch policies fail validation', {}, async (c) => {
  await assert.rejects(
    openMessaging({ path: c.path, config: { maxAttempts: null } }),
    (e) => e.code === 'INPUT',
  );
  await assert.rejects(
    openMessaging({ path: c.path, configMismatch: 'erorr' }),
    (e) => e.code === 'INPUT',
  );
});
console.log(`RESULT ${passed}/${passed} passed`);
