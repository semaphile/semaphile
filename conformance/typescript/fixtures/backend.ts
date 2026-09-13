import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { platform, release } from 'node:os';
import { createRequire } from 'node:module';

const addon = resolve(process.argv[2]);
await mkdir('.tmp/sqlite-coordination', { recursive: true });
const root = await mkdtemp('.tmp/sqlite-coordination/run-');
const peers = new Set<Peer>();
const deadline = 8000;
let serial = 0;
function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout: ' + label)), deadline);
    }),
  ]).finally(() => clearTimeout(timer));
}
class Peer {
  child: ChildProcess;
  queue: any[] = [];
  errors = '';
  ended = false;
  observer: (() => void) | undefined;
  requests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  exit: Promise<{ code: number | null; signal: string | null }>;
  constructor(path: string, config = { maxConcurrent: 1, expirationMs: null as number | null }) {
    // An explicit second executable exercises the same protocol between
    // different JS runtimes. Pairs alternate primary and second runtime.
    const execPath =
      peers.size % 2 === 1 && process.env.SEMAPHILE_TEST_PEER_EXEC_PATH
        ? resolve(process.env.SEMAPHILE_TEST_PEER_EXEC_PATH)
        : process.execPath;
    this.child = fork(
      new URL('./participant.ts', import.meta.url),
      [resolve(path), addon, JSON.stringify(config)],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: ['--no-warnings'], execPath },
    );
    peers.add(this);
    this.child.stderr!.on('data', (data) => {
      this.errors += data;
    });
    const receive = (message: any) => {
      if (message.id) {
        const pending = this.requests.get(message.id);
        this.requests.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error));
        else pending?.resolve(message.value);
      } else {
        this.queue.push(message);
        this.observer?.();
      }
    };
    this.child.on('message', receive);
    createInterface({ input: this.child.stdout! }).on('line', (line) => {
      receive(JSON.parse(line));
    });
    this.exit = new Promise((resolveExit) => {
      this.child.on('error', (error) => {
        this.errors += String(error);
      });
      this.child.on('close', (code, signal) => {
        this.ended = true;
        for (const pending of this.requests.values())
          pending.reject(new Error('participant exited: ' + this.errors));
        this.requests.clear();
        this.observer?.();
        resolveExit({ code, signal });
      });
    });
  }
  async event(expected: string): Promise<any> {
    return within(
      new Promise((resolveEvent, reject) => {
        this.observer = () => {
          const index = this.queue.findIndex((message) => message.event === expected);
          if (index >= 0) {
            this.observer = undefined;
            resolveEvent(this.queue.splice(index, 1)[0]);
          } else if (this.ended) {
            this.observer = undefined;
            reject(new Error('exited before ' + expected + ': ' + this.errors));
          }
        };
        this.observer();
      }),
      expected,
    );
  }
  request(action: string, extra: object = {}) {
    const id = String(serial++);
    const value = within(
      new Promise<any>((resolveRequest, reject) => {
        this.requests.set(id, { resolve: resolveRequest, reject });
        this.child.send({ id, action, ...extra }, (error) => {
          if (error) {
            this.requests.delete(id);
            reject(error);
          }
        });
      }),
      action,
    );
    // Attach immediately; tests may deliberately kill a request's participant.
    void value.catch(() => {});
    return { id, value };
  }
  call(action: string, extra: object = {}) {
    return this.request(action, extra).value;
  }
  async close() {
    if (this.ended) return;
    await this.call('close');
    assert.deepEqual(await within(this.exit, 'close exit'), { code: 0, signal: null }, this.errors);
  }
  async kill() {
    assert.equal(this.child.kill('SIGKILL'), true);
    assert.equal((await within(this.exit, 'kill exit')).signal, 'SIGKILL');
  }
}
const tests: Array<[string, () => Promise<void>]> = [];
let caseId = 0;
function test(name: string, body: (path: string) => Promise<void>) {
  tests.push([name, () => body(join(root, 'pool-' + caseId++))]);
}
async function pair(
  path: string,
  config = { maxConcurrent: 1, expirationMs: null as number | null },
) {
  const a = new Peer(path, config),
    b = new Peer(path, config);
  await Promise.all([a.event('ready'), b.event('ready')]);
  return [a, b];
}

test('two TS participants: twenty jobs, shared cap five', async (path) => {
  const [a, b] = await pair(path, { maxConcurrent: 5, expirationMs: null });
  const jobs = (await Promise.all([a.call('demo'), b.call('demo')])).flat();
  assert.equal(jobs.length, 20);
  assert.equal(new Set(jobs.map((job) => job.pid)).size, 2);
  assert.equal(new Set(jobs.map((job) => job.lease)).size, 20);
  const edges = jobs.flatMap((job) => [
    { at: job.started, delta: 1 },
    { at: job.completed, delta: -1 },
  ]);
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0,
    peak = 0;
  for (const edge of edges) {
    active += edge.delta;
    peak = Math.max(peak, active);
    assert.ok(active <= 5);
  }
  assert.equal(active, 0);
  assert.equal(peak, 5);
  const state = await a.call('inspect');
  assert.equal(state.active, 0);
  assert.equal(state.trace.filter((row: any) => row.kind === 'admitted').length, 20);
  assert.ok(state.trace.every((row: any) => row.active >= 0 && row.active <= 5));
  console.log('  participants=2 jobs=20 peak=5 remaining=0');
  await Promise.all([a.close(), b.close()]);
});
test('any-holder release wakes a waiter while oldest lease remains', async (path) => {
  const [a, b] = await pair(path, { maxConcurrent: 2, expirationMs: null });
  const oldest = await a.call('acquire'),
    newer = await a.call('acquire');
  const pending = b.call('acquire');
  await b.event('waiting');
  await a.call('release', { lease: newer });
  const admitted = await pending;
  assert.equal((await b.call('inspect')).active, 2);
  await b.call('release', { lease: admitted });
  await a.call('release', { lease: oldest });
  await Promise.all([a.close(), b.close()]);
});
test('idle wait has no periodic wakeups; queued cancellation works', async (path) => {
  const [a, b] = await pair(path);
  const held = await a.call('acquire');
  const pending = b.request('acquire');
  await b.event('waiting');
  const before = await b.call('stats');
  await delay(250); // One bounded observation, no retry loop.
  assert.deepEqual(await b.call('stats'), before);
  await b.call('abort', { target: pending.id });
  await assert.rejects(pending.value, /aborted/);
  assert.equal((await a.call('inspect')).active, 1);
  await a.call('release', { lease: held });
  await Promise.all([a.close(), b.close()]);
});
test('SIGKILL owner reclaims committed lease', async (path) => {
  const [a, b] = await pair(path);
  await a.call('acquire');
  const pending = b.call('acquire');
  await b.event('waiting');
  await a.kill();
  const lease = await pending;
  const state = await b.call('inspect');
  assert.equal(state.active, 1);
  assert.ok(state.trace.some((row: any) => row.kind === 'reclaimed'));
  await b.call('release', { lease });
  await b.close();
});
test('owner dies before waiter subscribes', async (path) => {
  const [a, b] = await pair(path);
  await a.call('acquire');
  await a.kill();
  const lease = await b.call('acquire');
  assert.equal((await b.call('inspect')).active, 1);
  await b.call('release', { lease });
  await b.close();
});
test('live-owner expiration; late and duplicate release preserve replacement', async (path) => {
  const [a, b] = await pair(path, { maxConcurrent: 1, expirationMs: 500 });
  const requestedAt = Date.now();
  const old = await a.call('acquire');
  const before = await a.call('inspect');
  const expiration = before.leases.find((row: any) => row.id === old).expires;
  assert.ok(expiration >= requestedAt + 500, 'configured lease lifetime must not be shortened');
  const pending = b.call('acquire');
  await b.event('waiting');
  const lease = await pending;
  assert.ok(Date.now() >= expiration, 'replacement must not arrive before expiration');
  const after = await b.call('inspect');
  const retired = after.trace.find((row: any) => row.lease === old && row.kind === 'expired');
  const admitted = after.trace.find((row: any) => row.lease === lease && row.kind === 'admitted');
  assert.ok(
    retired && retired.at >= expiration,
    'old lease must have an expiration transition at or after its deadline',
  );
  assert.ok(admitted.seq > retired.seq && admitted.at >= expiration);
  assert.equal(a.ended, false);
  await a.call('release', { lease: old });
  await a.call('release', { lease: old });
  assert.equal((await b.call('inspect')).active, 1);
  await b.call('release', { lease });
  await b.close();
  await a.close();
});
test('full config mismatch fails before registration', async (path) => {
  const a = new Peer(path);
  await a.event('ready');
  const b = new Peer(path, { maxConcurrent: 1, expirationMs: 500 });
  const exit = await within(b.exit, 'mismatch exit');
  assert.notEqual(exit.code, 0);
  assert.match(b.errors, /config or format mismatch/);
  const lease = await a.call('acquire');
  await a.call('release', { lease });
  await a.close();
});
for (const stage of [
  'beforeSignal',
  'afterSignal',
  'afterMutation',
  'beforeCommit',
  'afterCommit',
  'beforeUnlock',
]) {
  test('writer SIGKILL at ' + stage, async (path) => {
    const [a, b] = await pair(path);
    const held = await a.call('acquire');
    const pending = b.call('acquire');
    await b.event('waiting');
    const crashing = a.call('crashRelease', { lease: held, stage });
    await a.event('crash-point');
    await a.kill();
    await assert.rejects(crashing, /exited/);
    const lease = await pending;
    const state = await b.call('inspect');
    assert.equal(state.active, 1);
    assert.ok(state.trace.every((row: any) => row.active >= 0 && row.active <= 1));
    const oldTransitions = state.trace.filter(
      (row: any) => row.lease === held && row.kind !== 'admitted',
    );
    assert.equal(
      oldTransitions.length,
      1,
      'rollback or committed release must retire exactly once',
    );
    await b.call('release', { lease });
    await b.close();
  });
}
test('closing a pool cancels a native wait before closing descriptors', async (path) => {
  const [a, b] = await pair(path);
  const held = await a.call('acquire');
  const pending = b.call('acquire');
  await b.event('waiting');
  await b.close();
  await assert.rejects(pending, /closed/);
  assert.equal((await a.call('inspect')).active, 1);
  await a.call('release', { lease: held });
  await a.close();
});
for (const stage of ['afterSignal', 'beforeCommit', 'afterCommit']) {
  test('non-owner writer crash at ' + stage + ' still wakes subscribers', async (path) => {
    const [a, b] = await pair(path);
    const writer = new Peer(path);
    await writer.event('ready');
    const held = await a.call('acquire');
    const pending = b.call('acquire');
    await b.event('waiting');
    const crashing = writer.call('crashTouch', { stage });
    await writer.event('crash-point');
    await writer.kill();
    await assert.rejects(crashing, /exited/);
    // b watches a's process, not writer's. This wake must come from notify.
    await b.event('waiting');
    const state = await a.call('inspect');
    assert.equal(state.active, 1);
    assert.equal(
      state.trace.filter((row: any) => row.kind === 'test-marker').length,
      stage === 'afterCommit' ? 1 : 0,
    );
    await a.call('release', { lease: held });
    await b.call('release', { lease: await pending });
    await Promise.all([a.close(), b.close()]);
  });
}
test('notification rename fails the waiter explicitly', async (path) => {
  const [a, b] = await pair(path);
  const held = await a.call('acquire');
  const pending = b.call('acquire');
  await b.event('waiting');
  const { rename } = await import('node:fs/promises');
  await rename(join(path, 'notify'), join(path, 'notify-renamed'));
  await assert.rejects(pending, /invalidat/);
  await a.call('release', { lease: held });
  await Promise.all([a.close(), b.close()]);
});
test('native wait honors an elapsed absolute deadline after delayed dispatch', async (path) => {
  await mkdir(path, { recursive: true });
  const native = new (createRequire(import.meta.url)(addon).NativeContext)();
  const { waitForWake } = await import('../../../packages/core/dist/src/wake.js');
  native.open(join(path, 'notify'), 'notification');
  const subscription = native.subscribe(join(path, 'notify'));
  try {
    const expires = Date.now() + 100;
    await delay(150);
    const resumedAt = performance.now();
    await within(
      waitForWake(subscription, expires, () => {}),
      'elapsed deadline',
    );
    assert.ok(performance.now() - resumedAt < 75, 'elapsed deadline restarted an interval');
  } finally {
    subscription.close();
    native.close();
  }
});

assert.notEqual(process.geteuid!(), 0, 'run as an ordinary user');
console.log(
  `platform=${platform()} release=${release()} node=${process.version} uid=${process.geteuid!()}`,
);
console.log('store=' + resolve(root));
let passed = 0;
try {
  for (const [name, run] of tests) {
    await run();
    passed++;
    console.log('PASS ' + name);
  }
  console.log(`RESULT ${passed}/${tests.length} passed`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  console.log(`RESULT ${passed}/${tests.length} passed; remaining cases not completed`);
} finally {
  for (const peer of peers) if (!peer.ended) peer.child.kill('SIGKILL');
  await Promise.all(
    [...peers].map((peer) =>
      within(peer.exit, 'cleanup').catch((error) => {
        console.error(error);
        process.exitCode = 1;
      }),
    ),
  );
}
