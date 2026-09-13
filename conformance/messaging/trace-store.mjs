import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { contentBytes } from '../../packages/messaging/dist/src/storage.js';
import { resolve, join } from 'node:path';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
await mkdir('.tmp/messaging', { recursive: true });
const path = await mkdtemp(resolve('.tmp/messaging/trace-store-'));
const client = await openMessaging({ path, config: { retryDelayMs: 1 } });
const first = { traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01' };
const second = { traceparent: '00-' + 'c'.repeat(32) + '-' + 'd'.repeat(16) + '-01' };
try {
  await client.createMailbox('worker');
  const original = await client.send({
    to: 'worker',
    body: 'hello',
    dedupeKey: 'key',
    trace: first,
  });
  const duplicate = await client.send({
    to: 'worker',
    body: 'hello',
    dedupeKey: 'key',
    trace: second,
  });
  assert.equal(duplicate.id, original.id);
  assert(duplicate.deduplicated);
  const [delivery] = await client.receive('worker');
  assert.deepEqual(delivery.trace, first);
  assert.equal(delivery.message.trace, undefined);
  assert.equal(delivery.message.body, 'hello');
  await client.release(delivery.receipt);
  const again = await client.wait('worker', { timeoutMs: 1000 });
  assert.equal(again.attempt, 2);
  assert.deepEqual(again.trace, first);
  await client.ack(again.receipt);
  assert.deepEqual((await client.history())[0].trace, first);
  await assert.rejects(
    client.send({ to: 'worker', body: 'ok', trace: { baggage: 'a'.repeat(4097) } }),
    /bound/,
  );
  console.log(
    'PASS trace is separate from content, first context wins dedupe, and redelivery/history preserve it',
  );
  await client.createMailbox('second');
  const a = await client.register('worker'),
    b = await client.register('second');
  const broadcast = await client.send({
    to: '*',
    body: 'broadcast',
    dedupeKey: 'broadcast',
    trace: first,
  });
  const left = (await client.receive('worker'))[0],
    right = (await client.receive('second'))[0];
  assert.equal(left.messageId, broadcast.id);
  assert.equal(right.messageId, broadcast.id);
  assert.notEqual(left.receipt.deliveryId, right.receipt.deliveryId);
  assert.deepEqual(left.trace, first);
  assert.deepEqual(right.trace, first);
  await client.ack(left.receipt);
  await client.ack(right.receipt);
  await client.unregister(a.id);
  await client.unregister(b.id);
  console.log(
    'PASS broadcast recipients retain independent receipts with the same committed sender context',
  );
} finally {
  await client.close();
}
// All clients are closed before this independent inspection of retained bytes.
const db = new DatabaseSync(join(path, 'state.sqlite'));
try {
  const size = contentBytes({ db });
  const traceBytes = db
    .prepare('SELECT SUM(length(CAST(trace AS BLOB))) AS bytes FROM messages')
    .get().bytes;
  db.exec('BEGIN; UPDATE messages SET trace=NULL;');
  assert.equal(size - contentBytes({ db }), traceBytes);
  db.exec('ROLLBACK;');
  db.prepare('UPDATE messages SET terminal_at=?').run(Date.now() - 604800001);
} finally {
  db.close();
}
const cleanup = await openMessaging({ path, onWarning: () => {} });
await cleanup.send({ to: 'worker', body: 'trigger retention' });
await cleanup.close();
const retained = new DatabaseSync(join(path, 'state.sqlite'));
try {
  assert.equal(
    retained.prepare('SELECT COUNT(*) AS n FROM messages WHERE trace IS NOT NULL').get().n,
    0,
  );
} finally {
  retained.close();
}
console.log('PASS trace bytes count toward retention and expire with terminal message content');
console.log('RESULT 3/3 passed');
