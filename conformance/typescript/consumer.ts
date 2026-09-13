import { Limiter, openLimiter } from '@semaphile/core';
import { openLimiter as openMemoryLimiter } from '@semaphile/core/memory';
import type {
  PoolConfig,
  OpenOptions,
  ScheduleOptions,
  CloseOptions,
  Snapshot,
  Admission,
} from '@semaphile/core';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Compile-only negative cases: these must stay rejected by public types.
function invalidCalls(limiter: Limiter) {
  // @ts-expect-error memory pool identity is a string key
  openMemoryLimiter({ key: 1, config: { maxConcurrent: 1 } });
  // @ts-expect-error queue deadlines are numeric milliseconds
  limiter.schedule(() => 1, { queueTimeoutMs: '100' });
  // @ts-expect-error capacity is numeric
  openLimiter({ path: 'unused', config: { maxConcurrent: '5' } });
  // @ts-expect-error spacing requires integer milliseconds
  openLimiter({ path: 'unused', config: { maxConcurrent: 5, minTime: '10' } });
  // @ts-expect-error callbacks, not already-started promises
  limiter.schedule(Promise.resolve(1));
  // @ts-expect-error drain is boolean
  limiter.close({ drain: 'yes' });
  // @ts-expect-error cancellation requires an AbortSignal
  limiter.schedule(() => 1, { signal: {} });
  // @ts-expect-error weights are numeric
  limiter.schedule(() => 1, { weight: '2' });
  // @ts-expect-error reservoir adjustments are numeric
  limiter.incrementReservoir('1');
  // @ts-expect-error per-call expiry is numeric or null
  limiter.schedule(() => 1, { expirationMs: '30' });
  limiter.schedule((admission) => {
    // @ts-expect-error caller metadata cannot change the release identity
    admission.leaseId = 'different';
  });
  // @ts-expect-error safety is explicit, not a boolean
  limiter.execute(() => 1, { retrySafety: true });
  // @ts-expect-error maintenance generation is numeric
  limiter.maintenance.resume('1');
  // @ts-expect-error HTTP handlers receive a Response, not a string
  limiter.http.request('data:text/plain,ok', (value: string) => value);
  // @ts-expect-error HTTP bodyFactory must produce request bodies
  limiter.http.fetch('data:text/plain,ok', { bodyFactory: () => 42 });
  limiter.execute((context) => {
    // @ts-expect-error immutable admission metadata
    context.admission.leaseId = 'replacement';
  });
  // @ts-expect-error constructor is private
  new Limiter();
  // @ts-expect-error native coordination is not public
  limiter.backend;
  // @ts-expect-error result preserves the callback's type
  const wrong: Promise<string> = limiter.schedule(() => 42);
  // @ts-expect-error backend is not an exported package entry point
  type Backend = typeof import('@semaphile/core/dist/src/backend.js');
  void wrong;
}
void invalidCalls;
const memory = await openMemoryLimiter({ key: 'package-consumer', config: { maxConcurrent: 1 } });
assert.equal(await memory.schedule(() => 43, { queueTimeoutMs: 1000 }), 43);
await memory.close();

const config: PoolConfig = { maxConcurrent: 1, expirationMs: null };
const options: OpenOptions = { path: process.argv[2]!, config };
const scheduling: ScheduleOptions = { signal: new AbortController().signal };
const closing: CloseOptions = { drain: true };
const first = await openLimiter(options);
const second = await Limiter.open(options);
try {
  const numberResult = first.schedule(() => 42, scheduling);
  type NumberResult = Expect<Equal<typeof numberResult, Promise<number>>>;
  assert.equal(await numberResult, 42);
  const objectResult = first.schedule(async () => ({ answer: 42 }));
  type ObjectResult = Expect<Equal<typeof objectResult, Promise<{ answer: number }>>>;
  assert.deepEqual(await objectResult, { answer: 42 });
  const thenable: PromiseLike<string> = {
    then: (yes, no) => Promise.resolve('thenable').then(yes, no),
  };
  const thenableResult = first.schedule(() => thenable);
  type ThenableResult = Expect<Equal<typeof thenableResult, Promise<string>>>;
  assert.equal(await thenableResult, 'thenable');

  const executed = first.execute(
    (context) => ({ attempt: context.attempt, signal: context.signal }),
    {
      retrySafety: 'safe',
      classifier: { id: 'semaphile.generic/1', classify: () => ({ kind: 'success' }) },
    },
  );
  type ExecutionResult = Expect<
    Equal<typeof executed, Promise<{ attempt: number; signal: AbortSignal }>>
  >;
  assert.equal((await executed).attempt, 1);
  const fetched: Response = await first.http.fetch('data:text/plain,installed');
  assert.equal(await fetched.text(), 'installed');
  const scoped = first.http.request('data:text/plain,scoped', async (response) => ({
    text: await response.text(),
  }));
  type ScopedResult = Expect<Equal<typeof scoped, Promise<{ text: string }>>>;
  assert.deepEqual(await scoped, { text: 'scoped' });
  const drained = await first.maintenance.drain();
  await assert.rejects(
    second.execute(() => 1),
    { name: 'PoolDrainingError' },
  );
  assert.equal(
    (await second.maintenance.wait({ generation: drained.maintenance.generation, timeoutMs: 1000 }))
      .maintenance.clean,
    true,
  );
  await first.maintenance.resume(drained.maintenance.generation);

  let started!: () => void, release!: () => void;
  const running = new Promise<void>((yes) => {
    started = yes;
  });
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  const holder = first.schedule(async () => {
    started();
    await held;
    return 'held';
  });
  await running;
  let entered = false;
  const queued = second.schedule(() => {
    entered = true;
    return 'queued';
  });
  try {
    // Hold capacity long enough for the installed package's nested wait
    // worker to start, then release and require its notification to wake.
    await delay(150);
    assert.equal(entered, false);
    const snapshot = first.inspect();
    type SnapshotResult = Expect<Equal<typeof snapshot, Promise<Snapshot>>>;
    assert.equal((await snapshot).active, 1);
  } finally {
    release();
  }
  assert.equal(await holder, 'held');
  assert.equal(await queued, 'queued');
  assert.equal((await second.inspect()).active, 0);
  const reservoir = first.currentReservoir();
  type ReservoirResult = Expect<Equal<typeof reservoir, Promise<number | null>>>;
  assert.equal(await reservoir, null);
  const adjustment = first.incrementReservoir(3);
  type AdjustmentResult = Expect<Equal<typeof adjustment, Promise<number>>>;
  assert.equal(await adjustment, 3);
  const contextResult = first.schedule((admission) => admission, { expirationMs: 1000 });
  type ContextResult = Expect<Equal<typeof contextResult, Promise<Admission>>>;
  assert.equal((await contextResult).weight, 1);
  await first.schedule(() => 1, { weight: 1 });
  assert.equal(await second.currentReservoir(), 1);
} finally {
  const closed = first.close(closing);
  type CloseResult = Expect<Equal<typeof closed, Promise<void>>>;
  await Promise.all([closed, second.close()]);
}
console.log(
  'PASS installed consumer: callbacks, execution, HTTP, maintenance, shared capacity and close',
);
