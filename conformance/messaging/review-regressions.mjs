import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  openMessaging,
  commandHandler,
  loadConfig,
  info,
} from '../../packages/messaging/dist/src/index.js';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { nativePath } from '../../packages/messaging/dist/src/native-path.js';
import { Database } from '../../packages/messaging/dist/src/database.js';
import { normalize } from '../../packages/messaging/dist/src/config.js';
import { reconcile } from '../../packages/messaging/dist/src/delivery.js';
import { contentBytes } from '../../packages/messaging/dist/src/storage.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/reviews-');
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
  const client = await openMessaging({ path: join(directory, String(passed)), config });
  try {
    await client.createMailbox('a');
    await fn(client);
    console.log('PASS ' + label);
    passed++;
  } finally {
    await client.close();
  }
}
await scenario(
  'unattended exhausted claims are reclaimed for another mailbox',
  { maxMessages: 1, maxAttempts: 1, claimTtlMs: 10 },
  async (c) => {
    await c.createMailbox('b');
    await c.send({ to: 'a', body: 'old' });
    await c.receive('a');
    await pause(20);
    await c.send({ to: 'b', body: 'new' });
    assert.equal((await c.receive('b'))[0].message.body, 'new');
  },
);
await scenario(
  'large sends finish multiple bounded eviction batches',
  { maxContentBytes: 2000000, maxBodyBytes: 1600000, maxEvents: 1 },
  async (c) => {
    for (let i = 0; i < 600; i++) {
      await c.send({ to: 'a', body: 'x' });
      const [d] = await c.receive('a');
      await c.ack(d.receipt);
    }
    await c.send({ to: 'a', body: 'x'.repeat(1500000) });
    assert.equal((await c.receive('a'))[0].message.body.length, 1500000);
  },
);
await scenario(
  'error reservation keeps terminal cleanup within capacity',
  { maxContentBytes: 15000, maxAttempts: 1 },
  async (c) => {
    await c.send({ to: 'a', body: 'x' });
    const [d] = await c.receive('a');
    await c.fail(d.receipt, '界'.repeat(4096));
    const db = new Database(c.path, normalize({ maxContentBytes: 15000, maxAttempts: 1 }), 'error');
    try {
      assert.ok(db.locked(() => contentBytes(db)) <= 15000);
    } finally {
      db.close();
    }
    assert.equal((await c.history())[0].deliveries[0].state, 'failed');
  },
);
await scenario(
  'session metadata is accounted and evictable after unregister',
  { maxContentBytes: 20000 },
  async (c) => {
    for (let i = 0; i < 10; i++) {
      const a = await c.register('a', 'x'.repeat(16000));
      await c.unregister(a.id);
    }
    const db = new Database(c.path, normalize({ maxContentBytes: 20000 }), 'error');
    try {
      assert.ok(db.locked(() => contentBytes(db)) <= 20000);
    } finally {
      db.close();
    }
    assert.equal((await c.agents()).length, 1);
  },
);
await scenario(
  'expiry reconciliation accounts per batch not per event',
  { claimTtlMs: 10 },
  async (c) => {
    for (let i = 0; i < 100; i++) {
      await c.send({ to: 'a', body: 'x' });
    }
    await c.receive('a', { max: 100 });
    await pause(20);
    const db = new Database(c.path, normalize({ claimTtlMs: 10 }), 'error'),
      prepare = db.db.prepare.bind(db.db);
    let scans = 0;
    db.db.prepare = (sql) => {
      if (sql.includes('AS bytes')) {
        scans++;
      }
      return prepare(sql);
    };
    try {
      db.locked(() => reconcile(db, 'a'));
      assert.ok(scans <= 2, `accounting scans=${scans}`);
    } finally {
      db.close();
    }
  },
);
await scenario('failed stdin transmission cannot acknowledge a zero-exit command', {}, async () => {
  const handler = commandHandler([
    process.execPath,
    '-e',
    "require('node:fs').closeSync(0);setTimeout(()=>process.exit(0),50)",
  ]);
  await assert.rejects(
    handler({ message: { body: 'x'.repeat(1048576) } }, { signal: new AbortController().signal }),
    (e) => e.code === 'HANDLER',
  );
});
await scenario(
  'pending renewal retains an independent expiry watchdog',
  { claimTtlMs: 300, maxHandlingMs: 400 },
  async (c) => {
    const started = deferred(),
      cancelled = deferred();
    const listener = c.listen(
      'a',
      async (_d, context) => {
        started.resolve();
        await new Promise((r) => context.signal.addEventListener('abort', r, { once: true }));
        cancelled.resolve();
      },
      { onError() {} },
    );
    await c.send({ to: 'a', body: 'x' });
    await started.promise;
    const child = spawn(
      process.execPath,
      [
        '--no-warnings',
        'conformance/messaging/fault-worker.mjs',
        'gate',
        c.path,
        '',
        JSON.stringify({ claimTtlMs: 300, maxHandlingMs: 400 }),
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    const exited = once(child, 'exit');
    await once(child.stdout, 'data');
    const closed = listener.close();
    try {
      await Promise.race([
        cancelled.promise,
        pause(1500).then(() => {
          throw new Error('Deadline cancellation did not fire');
        }),
      ]);
    } finally {
      child.stdin.write('release');
      await exited;
    }
    await closed;
  },
);
await scenario(
  'client close immediately cancels raw waits while handlers finish',
  {},
  async (c) => {
    await c.createMailbox('b');
    const started = deferred(),
      finish = deferred();
    c.listen('a', async () => {
      started.resolve();
      await finish.promise;
    });
    await c.send({ to: 'a', body: 'x' });
    await started.promise;
    const wait = c.wait('b');
    const rejected = assert.rejects(wait, (e) => e.code === 'ABORTED');
    const closed = c.close();
    await Promise.race([
      rejected,
      pause(1000).then(() => {
        throw new Error('Raw wait not cancelled');
      }),
    ]);
    finish.resolve();
    await closed;
  },
);
await scenario('graceful listener shutdown can escalate to cancellation', {}, async (c) => {
  const started = deferred(),
    cancelled = deferred();
  const listener = c.listen('a', async (_d, context) => {
    started.resolve();
    await new Promise((r) => context.signal.addEventListener('abort', r, { once: true }));
    cancelled.resolve();
  });
  await c.send({ to: 'a', body: 'x' });
  await started.promise;
  const closing = listener.close();
  void listener.close({ cancel: true });
  await cancelled.promise;
  await closing;
});
await scenario('invalid CLI acknowledgment options exit without a worker leak', {}, async (c) => {
  for (const args of [
    ['--ack-mode', 'typo'],
    ['--accept-ack-modes', 'typo'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--no-warnings', cli, 'message', 'receive', '--store', c.path, '--as', 'a', ...args],
      { encoding: 'utf8', timeout: 3000 },
    );
    assert.equal(result.status, 5, `${result.error}\n${result.stderr}`);
  }
});
await scenario('nested config validation rejects invalid defaults before init', {}, async () => {
  const dir = join(directory, 'invalid');
  await mkdir(dir);
  for (const messaging of [
    { listenerDefaults: { concurrency: 0 } },
    { clientDefaults: [] },
    { handler: [''] },
    { listenerDefaults: { unknown: true } },
  ]) {
    await writeFile(
      join(dir, 'semaphile.json'),
      JSON.stringify({ version: 1, directory: './state', messaging }),
    );
    await assert.rejects(loadConfig(dir));
    const r = spawnSync(process.execPath, ['--no-warnings', cli, 'init'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(r.status, 4, r.stderr);
  }
  await assert.rejects(access(join(dir, 'state')));
});
await scenario(
  'info normalizes omitted pool settings and distinguishes absent expectations',
  {},
  async (c) => {
    const dir = join(directory, 'info');
    await mkdir(dir);
    await writeFile(
      join(dir, 'semaphile.json'),
      JSON.stringify({ version: 1, directory: './state', pools: { p: { maxConcurrent: 5 } } }),
    );
    const pool = await openLimiter({
      path: join(dir, 'state', 'pools', 'p'),
      config: { maxConcurrent: 5, minTime: 100 },
    });
    await pool.close();
    const report = await info({ cwd: dir });
    assert.equal(report.stores[0].differences[0].field, 'minTime');
    const standalone = await info({ store: c.path });
    assert.equal(standalone.expected, null);
    assert.equal(standalone.differences, null);
    const compared = await info({ store: c.path, expectedConfig: { maxAttempts: 2 } });
    assert.equal(compared.differences[0].field, 'maxAttempts');
  },
);
await scenario(
  'unsupported event filters fail instead of silently broadening results',
  {},
  async (c) => {
    await c.append({ kind: 'test', topic: 'one' });
    await c.append({ kind: 'test', topic: 'two' });
    assert.equal((await c.events({ topic: 'one' })).length, 1);
    await assert.rejects(c.events({ recipient: 'a' }), (e) => e.code === 'INPUT');
    const r = spawnSync(
      process.execPath,
      ['--no-warnings', cli, 'message', 'events', '--store', c.path, '--to', 'a'],
      { encoding: 'utf8', timeout: 3000 },
    );
    assert.equal(r.status, 5);
  },
);
await scenario('initialization rolls back before releasing its original gate', {}, async () => {
  const path = join(directory, 'failed-init');
  const native = createRequire(import.meta.url)(nativePath());
  const exec = DatabaseSync.prototype.exec,
    unlock = native.unlock;
  let failedSchema = false,
    rolledBack = false,
    prematureUnlock = false;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql.includes('CREATE TABLE config')) {
      exec.call(this, 'BEGIN IMMEDIATE');
      failedSchema = true;
      throw new Error('injected initialization failure');
    }
    if (sql === 'ROLLBACK') {
      rolledBack = true;
    }
    return exec.call(this, sql);
  };
  native.unlock = (fd) => {
    if (failedSchema && !rolledBack) {
      prematureUnlock = true;
    }
    return unlock(fd);
  };
  try {
    assert.throws(() => new Database(path, normalize(), 'error'), /injected initialization/);
  } finally {
    DatabaseSync.prototype.exec = exec;
    native.unlock = unlock;
  }
  assert.equal(rolledBack, true);
  assert.equal(prematureUnlock, false);
  const reopened = new Database(path, normalize(), 'error');
  reopened.close();
});
await scenario('registration cancelled while pending never launches its child', {}, async (c) => {
  const preload = join(directory, 'registration-preload.mjs'),
    marker = join(directory, 'should-not-launch');
  const clientURL = new URL('../../packages/messaging/dist/src/client.js', import.meta.url).href;
  await writeFile(
    preload,
    `import { MessagingClient } from ${JSON.stringify(clientURL)};
const original = MessagingClient.prototype.register;
MessagingClient.prototype.register = async function(...args) {
  process.stdout.write('registration-pending\\n');
  await new Promise(resolve => setTimeout(resolve, 150));
  return original.apply(this, args);
};
`,
  );
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      process.versions.bun ? '--preload' : '--import',
      preload,
      cli,
      'message',
      'register',
      '--store',
      c.path,
      '--name',
      'a',
      '--',
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  let errors = '';
  child.stderr.on('data', (b) => (errors += b));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await once(child.stdout, 'data');
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    assert.equal(code, 3, `${signal} ${errors}`);
    await assert.rejects(access(marker));
    assert.ok((await c.agents()).every((agent) => !agent.online));
  } finally {
    clearTimeout(timeout);
  }
});
// A separate client intentionally fails close; verify its registration retires.
{
  const path = join(directory, 'failed-close'),
    c = await openMessaging({ path });
  await c.createMailbox('a');
  await c.register('a');
  c.listen('missing', () => {}, { onError() {} });
  await assert.rejects(c.close(), AggregateError);
  const peer = await openMessaging({ path });
  try {
    await peer.register('a');
  } finally {
    await peer.close();
  }
  console.log('PASS listener rejection still closes coordinator and lifetime locks');
  passed++;
}
await scenario(
  'dead session metadata yields capacity to message sends',
  { maxContentBytes: 20000 },
  async (c) => {
    const child = spawn(
      process.execPath,
      [
        '--no-warnings',
        'conformance/messaging/participant.mjs',
        'hold',
        c.path,
        'a',
        JSON.stringify({ maxContentBytes: 20000 }),
      ],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, SEMAPHILE_TEST_METADATA: 'x'.repeat(16000) },
      },
    );
    const exited = once(child, 'exit');
    await once(child.stdout, 'data');
    child.kill('SIGKILL');
    await exited;
    await c.send({ to: 'a', body: 'survived' });
    assert.equal((await c.receive('a'))[0].message.body, 'survived');
  },
);
await scenario('pre-aborted command handler never starts child', {}, async () => {
  const marker = join(directory, 'pre-aborted-child');
  const signal = AbortSignal.abort(new Error('cancelled before dispatch'));
  await assert.rejects(
    commandHandler([
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`,
    ])({}, { signal }),
    /cancelled before dispatch/,
  );
  await assert.rejects(access(marker));
});
console.log(`RESULT ${passed}/${passed} passed`);
