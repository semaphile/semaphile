import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/faults-');
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
const config = { claimTtlMs: 250, retryDelayMs: 10 };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
function participant(operation, path, stage = '') {
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      'conformance/messaging/fault-worker.mjs',
      operation,
      path,
      stage,
      JSON.stringify(config),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let output = '';
  child.stdout.on('data', (b) => {
    output += b;
  });
  return { child, output: () => output, exited: once(child, 'exit') };
}
async function scenario(label, fn) {
  const c = await openMessaging({ path: resolve(directory, String(passed)), config });
  try {
    await c.createMailbox('a');
    await fn(c);
    console.log('PASS ' + label);
    passed++;
  } finally {
    await c.close();
  }
}
for (const stage of [
  'beforeSignal',
  'afterSignal',
  'afterMutation',
  'beforeCommit',
  'afterCommit',
  'beforeUnlock',
]) {
  await scenario('writer SIGKILL at ' + stage, async (c) => {
    const committed = ['afterCommit', 'beforeUnlock'].includes(stage);
    const waiting = c.wait('a', { timeoutMs: 700 });
    const writer = participant('writer', c.path, stage);
    assert.deepEqual(await writer.exited, [null, 'SIGKILL']);
    const delivery = await waiting;
    if (committed) {
      assert.equal(delivery.message.body, stage);
      await c.ack(delivery.receipt);
    } else {
      assert.equal(delivery, null);
      assert.deepEqual(await c.history(), []);
    }
  });
}
await scenario('idle native subscription wakes zero times before its deadline', async (c) => {
  const waiter = participant('wait', c.path);
  assert.deepEqual(await waiter.exited, [0, null]);
  assert.equal(JSON.parse(waiter.output().split('\n')[1]).result, 0);
  assert.deepEqual(await c.events(), []);
});
await scenario('application remains responsive while gate holder is alive', async (c) => {
  const holder = participant('gate', c.path);
  await once(holder.child.stdout, 'data');
  let done = false;
  const send = c.send({ to: 'a', body: 'x' }).then(() => {
    done = true;
  });
  await pause(30);
  assert.equal(done, false);
  holder.child.stdin.write('release');
  await holder.exited;
  await send;
});
await scenario('killing a gate holder releases blocked coordination', async (c) => {
  const holder = participant('gate', c.path);
  await once(holder.child.stdout, 'data');
  const sent = c.send({ to: 'a', body: 'x' });
  holder.child.kill('SIGKILL');
  await holder.exited;
  await sent;
});
await scenario('inbox rename fails the waiter explicitly', async (c) => {
  const waiting = c.wait('a', { timeoutMs: 1000 });
  const rejected = assert.rejects(waiting, /invalidat|notification/i);
  // Allow the coordinator to arm; this one-shot fixture delay is not a product poll.
  await pause(100);
  const path = resolve(c.path, 'inboxes', createHash('sha256').update('a').digest('hex'), 'notify');
  await rename(path, path + '.renamed');
  await rejected;
});
console.log(`RESULT ${passed}/${passed} passed`);
