// Run against the explicitly built Rust addon before changing production loading.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { nativePath } from '../../packages/core/dist/src/native-path.js';
import { suite } from './fixtures/cases.mjs';

const addon = process.env.SEMAPHILE_NATIVE_ADDON
  ? resolve(process.env.SEMAPHILE_NATIVE_ADDON)
  : nativePath();
const { NativeContext } = createRequire(import.meta.url)(addon);
await mkdir('.tmp/native-binding', { recursive: true });
const root = await mkdtemp('.tmp/native-binding/run-');
const { test, run } = suite();
let serial = 0;
function fixture() {
  const context = new NativeContext();
  const prefix = join(root, String(serial++));
  const path = prefix + '.notify';
  const notification = context.open(path, 'notification');
  const lifetimePath = prefix + '.owner';
  const lifetime = context.open(lifetimePath, 'lifetime');
  lifetime.lockLifetime();
  return { context, notification, path, lifetimePath, lifetime, prefix };
}
const wait = (subscription, timeout = 1000) =>
  new Promise((yes, no) => {
    subscription.start(timeout, (error, value) => (error ? no(error) : yes(value)));
  });

test('scoped gate returns callback values and unlocks after throws', () => {
  const f = fixture();
  try {
    const gate = f.context.open(f.prefix + '.gate', 'gate');
    const peer = f.context.open(f.prefix + '.gate', 'gate');
    assert.equal(
      gate.withGate(() => 42),
      42,
    );
    const original = new Error('callback failure');
    assert.throws(
      () =>
        gate.withGate(() => {
          throw original;
        }),
      (e) => e === original,
    );
    assert.equal(
      peer.withGate(() => 'unlocked'),
      'unlocked',
    );
    assert.throws(() => gate.withGate(() => Promise.resolve()), /synchronous/);
    assert.equal(
      peer.withGate(() => 'still unlocked'),
      'still unlocked',
    );
  } finally {
    f.context.close();
  }
});

test('wrong file roles and reentrant gate access fail without losing ownership', () => {
  const f = fixture();
  try {
    assert.throws(() => f.lifetime.withGate(() => {}), /coordination gate/);
    assert.equal(f.context.alive(f.lifetimePath), true);
    assert.throws(() => f.notification.lockLifetime(), /lifetime lock/);
    const gate = f.context.open(f.prefix + '.gate', 'gate');
    gate.withGate(() => {
      assert.throws(() => gate.withGate(() => {}), /nested gate/);
      assert.throws(() => gate.close(), /borrowed/);
      assert.throws(() => f.context.close(), /inside a gate callback/);
      assert.equal(f.context.alive(f.lifetimePath), true);
    });
    assert.equal(
      gate.withGate(() => true),
      true,
    );
  } finally {
    f.context.close();
  }
});

test('duplicate gate handles reject nesting without hanging or losing the lock', () => {
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const [addon, path] = process.argv.slice(1);
    const context = new (require(addon).NativeContext)();
    const a = context.open(path, 'gate'), b = context.open(path, 'gate');
    a.withGate(() => assert.throws(() => b.withGate(() => {}), /nested gate/));
    assert.equal(b.withGate(() => 'released'), 'released');
    context.close();
  `,
      addon,
      join(root, 'duplicate.gate'),
    ],
    { encoding: 'utf8', timeout: 3000 },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('subscription is armed before native wait thread starts', async () => {
  const f = fixture();
  try {
    const sub = f.context.subscribe(f.path);
    f.notification.pulse();
    assert.equal(await wait(sub), 1);
    sub.close();
    sub.close();
  } finally {
    f.context.close();
  }
});

test('explicit lifetime retirement wakes a peer while its process remains alive', async () => {
  const f = fixture(),
    peer = new NativeContext();
  try {
    const sub = peer.subscribe(f.path);
    assert.equal(peer.alive(f.lifetimePath), true);
    const result = wait(sub);
    f.lifetime.close();
    assert.equal(await result, 1);
    assert.equal(peer.alive(f.lifetimePath), false);
    sub.close();
  } finally {
    f.context.close();
    peer.close();
  }
});

test('cancel and close join an idle wait without retiring its owner', async () => {
  const f = fixture();
  try {
    const sub = f.context.subscribe(f.path);
    const result = wait(sub, null);
    sub.cancel();
    sub.close();
    assert.equal(await result, 2);
    assert.equal(f.context.alive(f.lifetimePath), true);
  } finally {
    f.context.close();
  }
});

test('context close cancels its wait and wakes another context after retirement', async () => {
  const f = fixture(),
    peer = new NativeContext();
  try {
    const mine = f.context.subscribe(f.path),
      theirs = peer.subscribe(f.path);
    const cancelled = wait(mine),
      changed = wait(theirs);
    f.context.close();
    assert.equal(await cancelled, 2);
    assert.equal(await changed, 1);
    assert.equal(peer.alive(f.lifetimePath), false);
    assert.throws(() => f.context.open(f.path, 'file'), /closed/);
    theirs.close();
  } finally {
    f.context.close();
    peer.close();
  }
});

test('native deadline returns without a notification', async () => {
  const f = fixture();
  try {
    const sub = f.context.subscribe(f.path);
    assert.equal(await wait(sub, 15), 0);
    sub.close();
  } finally {
    f.context.close();
  }
});

test('worker environment teardown cancels a blocked native wait and wakes peers', async () => {
  const path = join(root, 'worker.notify'),
    lifetimePath = join(root, 'worker.owner');
  const peer = new NativeContext();
  const worker = new Worker(
    `
    const { workerData, parentPort } = require('node:worker_threads');
    const { NativeContext } = require(workerData.addon);
    const context = new NativeContext();
    context.open(workerData.path, 'notification');
    const owner = context.open(workerData.lifetimePath, 'lifetime');
    owner.lockLifetime();
    const sub = context.subscribe(workerData.path);
    sub.start(null, () => {});
    parentPort.postMessage('ready');
    parentPort.on('message', () => {});
  `,
    { eval: true, workerData: { addon, path, lifetimePath } },
  );
  try {
    await once(worker, 'message');
    assert.equal(peer.alive(lifetimePath), true);
    const sub = peer.subscribe(path);
    const changed = wait(sub, 3000);
    await worker.terminate();
    assert.equal(await changed, 1);
    assert.equal(peer.alive(lifetimePath), false);
    sub.close();
  } finally {
    await worker.terminate();
    peer.close();
  }
});

test('collecting a lifetime wrapper preserves its lock until context retirement', async () => {
  assert.equal(typeof globalThis.gc, 'function', 'Run this suite with --expose-gc');
  const context = new NativeContext(),
    peer = new NativeContext();
  const path = join(root, 'gc.notify'),
    ownerPath = join(root, 'gc.owner');
  context.open(path, 'notification');
  const createOwner = () => {
    const owner = context.open(ownerPath, 'lifetime');
    owner.lockLifetime();
    return new WeakRef(owner);
  };
  const weak = createOwner();
  try {
    await nextTurn();
    globalThis.gc();
    await nextTurn();
    assert.equal(weak.deref(), undefined, 'fixture wrapper was not collected');
    assert.equal(peer.alive(ownerPath), true);
    const sub = peer.subscribe(path);
    const changed = wait(sub);
    context.close();
    assert.equal(await changed, 1);
    assert.equal(peer.alive(ownerPath), false);
    sub.close();
  } finally {
    context.close();
    peer.close();
  }
});

test('terminating a SQLite owner with an idle native wait reclaims its committed lease', async () => {
  const { openLimiter } = await import('../../packages/core/dist/src/index.js');
  const path = join(root, 'terminated-sqlite');
  const module = new URL('../../packages/core/dist/src/backend.js', import.meta.url).href;
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.module).then(async ({ Pool }) => {
      const pool = new Pool(workerData.path, { maxConcurrent: 1 }, workerData.addon);
      await pool.acquire();
      pool.onWait = () => parentPort.postMessage('waiting');
      void pool.acquire().catch(() => {});
      parentPort.on('message', () => {});
    });
  `,
    { eval: true, workerData: { module, path, addon } },
  );
  let peer;
  try {
    await once(worker, 'message');
    peer = await openLimiter({ path, config: { maxConcurrent: 1 } });
    assert.equal((await peer.inspect()).active, 1);
    const admitted = peer.schedule(() => 'reclaimed', { queueTimeoutMs: 2000 });
    await worker.terminate();
    assert.equal(await admitted, 'reclaimed');
    assert.equal((await peer.inspect()).active, 0);
  } finally {
    await worker.terminate();
    await peer?.close();
  }
});

await run();
