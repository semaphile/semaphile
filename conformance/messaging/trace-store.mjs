import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
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
} finally {
  await client.close();
}
console.log('RESULT 1/1 passed');
