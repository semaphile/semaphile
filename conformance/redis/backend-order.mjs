import { readFile } from 'node:fs/promises';
import { numericFields, decodeControl } from '../../packages/redis/dist/control-codec.js';
import { deferred } from '../typescript/fixtures/cases.mjs';
// Exercise local Redis queue ordering with controlled command completion. This
// does not connect to Redis; protocol atomicity belongs to the live suites.
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { RedisBackend } from '../../packages/redis/dist/backend.js';
import { CircuitOpenError } from '../../packages/core/dist/src/client.js';
import {
  initialControlState,
  controlSnapshot,
} from '../../packages/core/dist/src/control-state.js';
import { suite } from '../typescript/fixtures/cases.mjs';
const { test, run } = suite();
const timed = (reply = {}) => ({
  sent: performance.now(),
  received: performance.now(),
  reply: {
    now: '1000',
    ownerDeadline: '31000',
    value: null,
    admission: null,
    deadline: null,
    ...reply,
  },
});
const explicit = (id) => ({ operation: { id, generation: 1 } });
const acquire = (backend, options = {}, signal) =>
  backend.call('acquire', { weight: 1, expirationMs: null, ...options }, signal);
function stub(override = () => undefined) {
  const backend = new RedisBackend({
    url: 'redis://localhost:6379',
    pool: 'model',
    config: { maxConcurrent: 1 },
  });
  const admitted = [],
    finished = [];
  let accepted = 0;
  backend.wire.invoke = async (action, input) => {
    const result = override(action, input);
    if (result !== undefined) {
      return result;
    }
    if (action === 'accept') {
      return timed({ value: { id: `implicit-${++accepted}`, generation: 1 } });
    }
    if (action === 'control') {
      return timed({ value: controlSnapshot(initialControlState(), 'test') });
    }
    if (action === 'finish') {
      finished.push(input.operation.id);
      return timed({ value: true });
    }
    if (action === 'acquire') {
      admitted.push(input.operation.id);
      return timed({
        admission: { leaseId: input.lease, leaseGrantedAt: '1000', expiresAt: null, weight: '1' },
      });
    }
    throw new Error(`Unexpected command ${action}`);
  };
  backend.wire.close = async () => {};
  return { backend, admitted, finished };
}

test('Lua and TypeScript agree on every numeric control field', async () => {
  const lua = await readFile(
    new URL('../../packages/redis/src/control.lua', import.meta.url),
    'utf8',
  );
  const declaration = lua.match(/ipairs\(\{([\s\S]*?)\}\) do numericFields/);
  assert.ok(declaration, 'Lua numeric field declaration must be present');
  const fields = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(fields.sort(), [...numericFields].sort());
  for (const field of fields) {
    assert.equal(decodeControl({ [field]: '42' })[field], 42);
  }
  assert.deepEqual(decodeControl({ id: '42', reason: '42' }), { id: '42', reason: '42' });
});

test('acceptance delay preserves FIFO across implicit and explicit operations', async () => {
  const gate = deferred();
  let firstAccept = true;
  const { backend, admitted } = stub((action) => {
    if (action === 'accept' && firstAccept) {
      firstAccept = false;
      return gate.promise;
    }
  });
  const first = acquire(backend),
    second = acquire(backend, explicit('second')),
    third = acquire(backend);
  await setImmediate();
  assert.deepEqual(admitted, []);
  gate.resolve(timed({ value: { id: 'first', generation: 1 } }));
  await Promise.all([first, second, third]);
  assert.deepEqual(admitted, ['first', 'second', 'implicit-1']);
  await backend.detach();
});

test('fail-fast preflight cannot let later ordinary work overtake its submission', async () => {
  const gate = deferred();
  const { backend, admitted } = stub((action) => (action === 'control' ? gate.promise : undefined));
  const first = acquire(backend, { ...explicit('first'), circuit: 'fail-fast' });
  const second = acquire(backend);
  await setImmediate();
  assert.deepEqual(admitted, []);
  gate.resolve(timed({ value: controlSnapshot(initialControlState(), 'test') }));
  await Promise.all([first, second]);
  assert.deepEqual(admitted, ['first', 'implicit-1']);
  await backend.detach();
});

test('failed preparation releases its reserved position for later work', async () => {
  const failure = new Error('acceptance rejected');
  const { backend, admitted } = stub((action) => {
    if (action === 'accept') {
      throw failure;
    }
  });
  const first = acquire(backend).catch((error) => error);
  const second = acquire(backend, explicit('second'));
  assert.equal(await first, failure);
  await second;
  assert.deepEqual(admitted, ['second']);
  await backend.detach();
});

test('cancelled preparation finishes its implicit ticket before close settles', async () => {
  const gate = deferred(),
    abort = new AbortController();
  const { backend, admitted, finished } = stub((action) =>
    action === 'accept' ? gate.promise : undefined,
  );
  const first = acquire(backend, {}, abort.signal).catch((error) => error);
  const second = acquire(backend, explicit('second'));
  abort.abort();
  gate.resolve(timed({ value: { id: 'cancelled', generation: 1 } }));
  assert.equal((await first).name, 'AbortError');
  await second;
  await backend.detach();
  assert.deepEqual(admitted, ['second']);
  assert.deepEqual(finished, ['cancelled']);
});

test('queued fail-fast reports recovery floor rather than earlier capacity wake', async () => {
  const check = deferred(),
    abort = new AbortController();
  const { backend } = stub((action) => (action === 'acquire' ? check.promise : undefined));
  backend.wire.wait = async (_observed, _deadline, signal) => {
    if (signal.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  };
  const first = acquire(backend, explicit('head'), abort.signal).catch((error) => error);
  const fast = acquire(backend, { ...explicit('fast'), circuit: 'fail-fast' }).catch(
    (error) => error,
  );
  await setImmediate();
  check.resolve(timed({ circuit: 'open', deadline: '1010', recoveryDeadline: '2000' }));
  const refusal = await fast;
  assert.ok(refusal instanceof CircuitOpenError);
  assert.equal(refusal.notBefore, 2000);
  abort.abort();
  assert.equal((await first).name, 'AbortError');
  await backend.detach();
});

test('failed cancellation cleanup preserves AbortError and stops the backend', async () => {
  const gate = deferred(),
    abort = new AbortController();
  const cleanup = new Error('cleanup refused');
  const { backend } = stub((action) => {
    if (action === 'accept') {
      return gate.promise;
    }
    if (action === 'finish') {
      throw cleanup;
    }
  });
  try {
    const first = acquire(backend, {}, abort.signal).catch((error) => error);
    abort.abort();
    gate.resolve(timed({ value: { id: 'cancelled', generation: 1 } }));
    assert.equal((await first).name, 'AbortError');
    assert.equal(backend.failure, cleanup);
    await assert.rejects(acquire(backend), (error) => error === cleanup);
  } finally {
    await backend.detach();
  }
});

await run();
