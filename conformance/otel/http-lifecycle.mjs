import assert from 'node:assert/strict';
import { openLimiter } from '../../packages/core/dist/src/memory.js';
const original = globalThis.fetch,
  events = [];
let stream;
globalThis.fetch = async () =>
  new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
  );
const pool = await openLimiter({
  key: 'http-observation',
  config: { maxConcurrent: 1 },
  telemetry: { onEvent: (event) => events.push(event) },
});
try {
  const response = await pool.http.fetch('http://test.invalid/');
  await new Promise((resolve) => setImmediate(resolve));
  assert(events.some((event) => event.kind === 'callerSettled' && event.status === 'fulfilled'));
  assert(!events.some((event) => event.kind === 'completed'));
  stream.error(Error('body failed'));
  await assert.rejects(response.text(), /body failed/);
  await pool.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert(events.some((event) => event.kind === 'responseFailed'));
  assert.equal(events.filter((event) => event.kind === 'callerSettled').length, 1);
  assert.equal(events.find((event) => event.kind === 'completed').status, 'rejected');
  console.log(
    'PASS fetch caller fulfillment precedes terminal response failure and operation cleanup',
  );
} finally {
  await pool.close();
  globalThis.fetch = original;
}
console.log('RESULT 1/1 passed');
