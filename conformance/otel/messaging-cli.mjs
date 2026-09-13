import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
await mkdir('.tmp/otel', { recursive: true });
const root = await mkdtemp(resolve('.tmp/otel/message-cli-')),
  path = join(root, 'store');
const client = await openMessaging({ path });
await client.createMailbox('worker');
await client.close();
const payloads = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    payloads.push(Buffer.concat(chunks));
    res.end();
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
async function run(
  args,
  endpoint = `http://127.0.0.1:${server.address().port}`,
  telemetryFlag = '--otel',
) {
  const child = spawn(
    process.execPath,
    [
      resolve('packages/messaging/dist/src/cli.js'),
      'message',
      ...args,
      '--store',
      path,
      telemetryFlag,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        TRACEPARENT: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
        BAGGAGE: 'secret=private',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '',
    errors = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    errors += data;
  });
  const [status] = await once(child, 'exit');
  assert.equal(status, 0, errors);
  return JSON.parse(output);
}
try {
  const sent = await run(['send', '--to', 'worker', '--body', 'cli-secret']);
  const [delivery] = await run(['receive', '--as', 'worker']);
  assert.equal(delivery.messageId, sent.id);
  assert.equal(delivery.message.body, 'cli-secret');
  assert(delivery.trace.traceparent.startsWith('00-' + 'a'.repeat(32)));
  assert.equal(delivery.trace.baggage, undefined);
  const file = join(root, 'receipt.json');
  await writeFile(file, JSON.stringify(delivery.receipt));
  assert.equal((await run(['ack', '--receipt-file', file])).status, 'acked');
  const exported = Buffer.concat(payloads);
  for (const operation of ['send', 'receive', 'ack']) {
    assert(exported.includes(Buffer.from(`semaphile message ${operation}`)));
  }
  assert(!exported.includes(Buffer.from('cli-secret')));
  assert(!exported.includes(Buffer.from('private')));
  console.log(
    'PASS CLI sends, receives and acknowledges with linked OTLP spans while preserving JSON stdout',
  );
  const start = performance.now();
  const result = await run(
    ['send', '--to', 'worker', '--body', 'still succeeds'],
    'http://127.0.0.1:1',
  );
  assert(result.id);
  assert(performance.now() - start < 5000);
  console.log('PASS unreachable exporter cannot change message results or exceed bounded shutdown');
  await writeFile(join(root, 'semaphile.json'), '{broken');
  const beforeDisabled = payloads.length;
  assert((await run(['send', '--to', 'worker', '--body', 'explicit'], undefined, '--no-otel')).id);
  assert.equal(payloads.length, beforeDisabled, 'disabled telemetry must not export');
  assert((await run(['send', '--to', 'worker', '--body', 'explicit with export'])).id);
  console.log(
    'PASS explicit store bypasses malformed nearby project config with telemetry on or off',
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log('RESULT 3/3 passed');
