import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
await mkdir('.tmp/messaging', { recursive: true });
const root = await mkdtemp(resolve('.tmp/messaging/telemetry-'));
for (const mode of ['throw', 'double', 'async', 'invalid', 'close']) {
  let starts = 0,
    ends = 0,
    diagnostics = 0,
    client,
    closing;
  client = await openMessaging({
    path: join(root, mode),
    telemetry: {
      onDiagnostic: () => {
        diagnostics++;
      },
      instrumentation: {
        start(event) {
          starts++;
          if (mode === 'throw') {
            throw Error('observer failure');
          }
          if (mode === 'async') {
            return new Promise(() => {});
          }
          if (mode === 'close' && event.operation === 'send') {
            closing = client.close();
          }
          return {
            run(cb) {
              const result = cb();
              if (mode === 'double') {
                cb();
              }
              return result;
            },
            inject: () => (mode === 'invalid' ? { baggage: 'x'.repeat(5000) } : undefined),
            end() {
              ends++;
            },
          };
        },
      },
    },
  });
  await client.createMailbox('worker');
  const count = mode === 'close' ? 1 : 10;
  for (let i = 0; i < count; i++) {
    await client.send({ to: 'worker', body: `body${i}` });
  }
  await closing;
  if (!closing) {
    await client.close();
  }
  const inspector = await openMessaging({ path: join(root, mode) });
  assert.equal((await inspector.history()).length, count);
  await inspector.close();
  if (mode === 'async') {
    assert.equal(starts, 1);
    assert.equal(diagnostics, 1);
  }
  if (mode === 'double') {
    assert.equal(ends, 10);
  }
  if (mode === 'invalid') {
    assert(diagnostics >= 10);
  }
}
console.log(
  'PASS broken, duplicate, async and invalid hooks cannot change sends; reentrant close awaits accepted work',
);
const client = await openMessaging({ path: join(root, 'wait') });
await client.createMailbox('worker');
const abort = new AbortController();
const waiting = client.wait('worker', { signal: abort.signal });
abort.abort();
await assert.rejects(waiting, /cancel/i);
await client.close();
await assert.rejects(client.wait('worker'), /closed|closing|Coordinator exited/i);
console.log('PASS cancellation and close settle observed waits without stranded registrations');
console.log('RESULT 2/2 passed');
