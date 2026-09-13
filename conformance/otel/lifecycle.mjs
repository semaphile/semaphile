import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { openLimiter } from '../../packages/core/dist/src/memory.js';
const turn = () => new Promise((resolve) => setImmediate(resolve));
const context = new AsyncLocalStorage();
const events = [];
const pool = await openLimiter({
  key: 'telemetry-lifecycle',
  config: { maxConcurrent: 1 },
  telemetry: {
    pool: 'test',
    onEvent: (event) => events.push(event),
    instrumentation: {
      start: () => {
        const captured = context.getStore();
        return { run: (callback) => context.run(captured, callback) };
      },
    },
  },
});
let release;
const first = context.run('first', () =>
  pool.schedule(async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
    assert.equal(context.getStore(), 'first');
  }),
);
while (!release) await turn();
const second = context.run('second', () => pool.schedule(() => context.getStore()));
release();
await first;
assert.equal(await second, 'second');
await pool.close();
await turn();
await turn();
assert.equal(events.filter((e) => e.kind === 'completed').length, 2);
assert.equal(events.filter((e) => e.kind === 'leaseReleased').length, 2);
for (const id of new Set(events.map((e) => e.id))) {
  const own = events.filter((e) => e.id === id);
  assert.deepEqual(
    own.map((e) => e.kind),
    [
      'queued',
      'leaseGranted',
      'attemptStarted',
      'attemptCompleted',
      'leaseReleased',
      'callerSettled',
      'completed',
    ],
  );
  assert(own.every((e) => Object.isFrozen(e)));
}
console.log('PASS queued callbacks preserve isolated submission context and ordered lifecycle');
let calls = 0;
const broken = await openLimiter({
  key: 'broken-instrumentation',
  config: { maxConcurrent: 1 },
  telemetry: {
    instrumentation: {
      start: () => ({
        run: (fn) => {
          fn();
          fn();
          throw Error('adapter');
        },
        event: () => {
          throw Error('observer');
        },
        end: () => {
          throw Error('end');
        },
      }),
    },
    onEvent: async () => {
      throw Error('subscriber');
    },
    onDiagnostic: () => {
      throw Error('diagnostic');
    },
  },
});
assert.equal(await broken.schedule(() => ++calls), 1);
assert.equal(calls, 1);
await assert.rejects(
  broken.schedule(() => {
    throw new Error('original');
  }),
  /original/,
);
await broken.close();
await turn();
console.log('PASS throwing adapters cannot duplicate work or alter callback results');
const executionEvents = [];
let finish;
const executing = await openLimiter({
  key: 'timeout-observation',
  config: { maxConcurrent: 1 },
  telemetry: { onEvent: (e) => executionEvents.push(e) },
});
const result = executing.execute(
  async () =>
    new Promise((resolve) => {
      finish = resolve;
    }),
  { policy: { deadlineMs: 30 } },
);
await assert.rejects(result, /exceeded/);
await turn();
assert(executionEvents.some((e) => e.kind === 'callerSettled'));
assert(!executionEvents.some((e) => e.kind === 'completed'));
assert.equal((await executing.inspect()).active, 1);
finish();
await executing.close();
await turn();
await turn();
assert(executionEvents.some((e) => e.kind === 'completed'));
console.log('PASS caller timeout precedes actual callback cleanup and completion');
let diagnostics = 0,
  observed = 0;
const bounded = await openLimiter({
  key: 'bounded-observation',
  config: { maxConcurrent: 1 },
  telemetry: {
    bufferSize: 2,
    onDiagnostic: (d) => {
      if (d.kind === 'events-dropped') diagnostics += d.count;
    },
    onEvent: () => {
      observed++;
      return new Promise(() => {});
    },
  },
});
for (let i = 0; i < 20; i++) await bounded.schedule(() => 42);
await bounded.close();
await turn();
assert(diagnostics > 0);
assert.equal(observed, 1);
console.log('PASS hung event subscriber remains bounded and cannot block limiter close');
console.log('RESULT 4/4 passed');
