// Regression evidence for the second independent client/CLI review.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { readInspection } from '../../packages/messaging/dist/src/admin.js';
import { openMessaging } from '../../packages/messaging/dist/src/index.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/client-reviews-');
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
const cli = resolve('packages/messaging/dist/src/cli.js');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => {
  let resolveValue;
  const promise = new Promise((r) => (resolveValue = r));
  return { promise, resolve: resolveValue };
};
let passed = 0;
async function scenario(label, config, fn) {
  const c = await openMessaging({ path: join(directory, String(passed)), config });
  try {
    await c.createMailbox('a');
    await fn(c);
    console.log('PASS ' + label);
    passed++;
  } finally {
    await c.close();
  }
}
await scenario('invalid handler fails before claiming or consuming an attempt', {}, async (c) => {
  await c.send({ to: 'a', body: 'protected' });
  assert.throws(
    () => c.listen('a', undefined),
    (e) => e.code === 'INPUT',
  );
  const [h] = await c.history();
  assert.equal(h.deliveries[0].state, 'pending');
  assert.equal(h.deliveries[0].attempts, 0);
});
async function cancelledCommand(c, action, adapter) {
  const script =
    adapter ??
    "process.on('SIGTERM',()=>{});process.stdin.resume();setTimeout(()=>{},60000);console.log('adapter-ready')";
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      cli,
      'message',
      action,
      '--store',
      c.path,
      action === 'listen' ? '--as' : '--name',
      'a',
      '--',
      process.execPath,
      '-e',
      script,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  let errors = '';
  child.stderr.on('data', (chunk) => (errors += chunk));
  const ready = deferred();
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (output.includes('adapter-ready')) {
      ready.resolve();
    }
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 12000);
  try {
    await Promise.race([
      ready.promise,
      exited.then(([code, signal]) => {
        throw new Error(`CLI exited before adapter readiness (${code ?? signal}): ${errors}`);
      }),
    ]);
    const started = Date.now();
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    assert.equal(code, 3, `${signal} ${errors}`);
    assert.ok(Date.now() - started < 10000, 'five-second escalation must finish');
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await exited;
  }
}
await scenario('adapter exit before readiness rejects instead of hanging', {}, async (c) => {
  await assert.rejects(
    cancelledCommand(c, 'register', 'process.exit(0)'),
    /before adapter readiness/,
  );
});
await scenario('CLI cancellation terminates an active handler with escalation', {}, async (c) => {
  await c.send({ to: 'a', body: 'work' });
  await cancelledCommand(c, 'listen');
  const [h] = await c.history();
  assert.equal(h.deliveries[0].state, 'pending');
  assert.equal(h.deliveries[0].attempts, 1);
});
await scenario('registration cancellation escalates and retires online presence', {}, async (c) => {
  await cancelledCommand(c, 'register');
  assert.ok((await c.agents()).every((a) => !a.online));
});
await scenario(
  'external acknowledgment stops renewal without cancelling handler cleanup',
  { claimTtlMs: 300, maxHandlingMs: 2000 },
  async (c) => {
    const accepted = deferred(),
      finish = deferred();
    let aborted = false;
    const errors = [];
    const listener = c.listen(
      'a',
      async (d, context) => {
        context.signal.addEventListener('abort', () => (aborted = true));
        const peer = await openMessaging({ path: c.path, config: c.config });
        try {
          assert.equal((await peer.ack(d.receipt)).status, 'acked');
        } finally {
          await peer.close();
        }
        accepted.resolve();
        await finish.promise;
      },
      { ackMode: 'manual', onError: (error) => errors.push(error) },
    );
    await c.send({ to: 'a', body: 'x' });
    await accepted.promise;
    await pause(650);
    assert.equal(aborted, false);
    assert.deepEqual(errors, []);
    const closing = listener.close();
    finish.resolve();
    await closing;
  },
);
await scenario(
  'positive wait timeout includes gate delay without creating a claim',
  {},
  async (c) => {
    await c.send({ to: 'a', body: 'later' });
    const holder = spawn(
      process.execPath,
      ['--no-warnings', 'conformance/messaging/fault-worker.mjs', 'gate', c.path],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    const exited = once(holder, 'exit');
    await once(holder.stdout, 'data');
    const waiting = c.wait('a', { timeoutMs: 10 });
    await pause(80);
    holder.stdin.end('release');
    await exited;
    assert.equal(await waiting, null);
    assert.equal((await c.history())[0].deliveries[0].attempts, 0);
    const d = await c.wait('a', { timeoutMs: 0 });
    assert.equal(d.message.body, 'later');
    await c.ack(d.receipt);
  },
);
await scenario('empty CLI policy overrides fail before consuming deliveries', {}, async (c) => {
  await c.send({ to: 'a', body: 'protected' });
  for (const key of ['ack-mode', 'accept-ack-modes', 'claim-ttl', 'max-handling']) {
    const r = spawnSync(
      process.execPath,
      ['--no-warnings', cli, 'message', 'wait', '--store', c.path, '--as', 'a', '--' + key, ''],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(r.status, 5, `${key}: ${r.stdout} ${r.stderr} ${r.error ?? ''}`);
  }
  assert.equal((await c.history())[0].deliveries[0].attempts, 0);
});
for (const code of [0, 7]) {
  await scenario(`inspection worker exit ${code} without a reply rejects`, {}, async () => {
    const worker = new Worker(new URL('./inspection-worker.mjs', import.meta.url), {
      workerData: { code },
    });
    await assert.rejects(
      readInspection(worker),
      (error) => error.code === 'STORE' && error.message.includes(`(${code})`),
    );
  });
}
await scenario('inspection worker reply wins over its subsequent clean exit', {}, async () => {
  const value = { path: 'fixture', format: 'fixture', config: {} };
  const worker = new Worker(new URL('./inspection-worker.mjs', import.meta.url), {
    workerData: { value },
  });
  const exited = once(worker, 'exit');
  assert.deepEqual(await readInspection(worker), value);
  await exited;
});
console.log(`RESULT ${passed}/${passed} passed`);
