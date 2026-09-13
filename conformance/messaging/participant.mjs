import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
const [operation, path, recipient = 'inbox', extra] = process.argv.slice(2);
const client = await openMessaging({
  path,
  config: extra ? JSON.parse(extra) : undefined,
  onWarning() {},
});
if (operation === 'wait' || operation === 'claim-hold') {
  const delivery = await client.wait(recipient, { timeoutMs: 5000, claimTtlMs: 1500 });
  process.stdout.write(JSON.stringify(delivery) + '\n');
  if (operation === 'claim-hold') {
    process.stdin.resume();
  } else {
    await client.close();
  }
} else if (operation === 'hold') {
  const agent = await client.register(recipient, process.env.SEMAPHILE_TEST_METADATA ?? '{}');
  process.stdout.write(JSON.stringify(agent) + '\n');
  process.stdin.once('data', () => {
    void client.close();
  });
} else if (operation === 'send') {
  process.stdout.write(
    JSON.stringify(await client.send({ to: recipient, body: 'from child' })) + '\n',
  );
  await client.close();
}

if (operation === 'exchange') {
  const other = recipient === 'a' ? 'b' : 'a';
  for (let i = 0; i < 10; i++) {
    await client.send({ to: other, sender: recipient, body: String(i) });
  }
  for (let i = 0; i < 10; i++) {
    const child = spawn(
      process.execPath,
      ['--no-warnings', 'conformance/messaging/participant.mjs', 'wait', path, recipient, extra],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    const delivery = JSON.parse(output);
    assert.equal(delivery.message.sender, other);
    assert.equal(delivery.message.body, String(i));
    assert.equal((await client.ack(delivery.receipt)).status, 'acked');
  }
  process.stdout.write(JSON.stringify({ received: 10 }) + '\n');
  await client.close();
}
