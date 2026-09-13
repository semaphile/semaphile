// Runs the actual Lua source against deterministic Redis-command substitutes.
// This checks transitions/encoding; it cannot prove live Redis atomicity or Pub/Sub.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { normalizePoolConfig } from '../../packages/core/dist/src/client.js';
import { decodeControl } from '../../packages/redis/dist/control-codec.js';
import { suite } from '../typescript/fixtures/cases.mjs';
const { test, run } = suite();
await mkdir('.tmp/redis-control-model', { recursive: true });
const root = await mkdtemp('.tmp/redis-control-model/run-');
const source = (await readFile('packages/redis/src/protocol.lua', 'utf8')).replace(
  '-- semaphile-control-module',
  await readFile('packages/redis/src/control.lua', 'utf8'),
);
const literal = (value) => {
  if (value === null) {
    return 'modelNull';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gi, '\\u{$1}');
  }
  if (typeof value === 'number') {
    return `(${value}+0.0)`;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `{${value.map(literal).join(',')}}`;
  }
  return `{${Object.entries(value)
    .map(([key, item]) => `[${literal(key)}]=${literal(item)}`)
    .join(',')}}`;
};
let sequence = 0;
async function scenario(events, extra = {}) {
  const { ownerTimeoutMs = 2000, ...pool } = extra;
  const config = { ...normalizePoolConfig({ maxConcurrent: 2, ...pool }), ownerTimeoutMs };
  const path = join(root, `scenario-${++sequence}.lua`);
  await writeFile(
    path,
    `local modelNull = io.stdin\nlocal run = dofile(${literal(resolve('conformance/redis/fixtures/protocol-model.lua'))})\nrun(${literal(source)}, ${literal(events)}, ${literal(config)}, modelNull)\n`,
  );
  const output = spawnSync(process.env.SEMAPHILE_LUA_BIN ?? 'lua', [path], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (output.error) {
    throw output.error;
  }
  assert.equal(output.status, 0, output.stderr);
  return output.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
const event = (owner, action, now, input = {}) => ({ owner, action, now, input });
const acquire = (owner, lease, now, input = {}) =>
  event(owner, 'acquire', now, { lease, weight: 1, expirationMs: null, ...input });
const release = (owner, lease, now, outcome = { kind: 'neutral' }) =>
  event(owner, 'release', now, { lease, outcome });
const status = (owner, now, command = { action: 'status' }) =>
  event(owner, 'control', now, { command });
const control = (result) => decodeControl(result.state.control);
const successful = (results) => {
  for (const result of results) {
    assert.equal(result.error, undefined);
  }
};
console.log('Lua protocol model (no Redis server or network):');

test('cooldown release is atomic, preserves provider floor and spends each admission once', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('a', 'first', 1000),
      release('a', 'first', 1001, { kind: 'throttle', retryAfterMs: 100 }),
      acquire('b', 'second', 1010),
      acquire('b', 'second', 1040),
      acquire('b', 'second', 1101),
    ],
    { reservoir: 3, recovery: { retry: { baseDelayMs: 5, maxDelayMs: 10 } } },
  );
  successful(results);
  assert.equal(results[3].state.leases.first, undefined);
  assert.equal(control(results[3]).recovery.cooldownUntil, 1101);
  assert.equal(results[4].reply.admission, null);
  assert.equal(
    results[5].publications,
    results[4].publications,
    'unchanged refused check cannot sustain self-wakeups',
  );
  assert.equal(results[6].reply.admission.leaseId, 'second');
  assert.equal(results[6].state.remaining, '1');
});

test('one cohort escalates once; duplicate report cannot extend newer cooldown', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('a', 'x', 1000),
      acquire('b', 'y', 1000),
      release('a', 'x', 1001, { kind: 'throttle' }),
      release('b', 'y', 1002, { kind: 'throttle', retryAfterMs: 100 }),
      release('a', 'x', 1003, { kind: 'throttle', retryAfterMs: 5000 }),
    ],
    { recovery: { retry: { baseDelayMs: 5, maxDelayMs: 10 } } },
  );
  successful(results);
  assert.equal(control(results[5]).recovery.cooldownStep, 1);
  assert.deepEqual(control(results[6]), control(results[5]));
});

test('one probe observes budgets, rejects fail-fast without accepting work, and recovers', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('a', 'failed', 1000),
      release('a', 'failed', 1001, { kind: 'service-failure' }),
      acquire('a', 'probe', 1011),
      acquire('b', 'queued', 1012),
      acquire('b', 'fast', 1013, { circuit: 'fail-fast' }),
      release('a', 'probe', 1014, { kind: 'success' }),
      acquire('b', 'queued', 1015),
    ],
    {
      reservoir: 4,
      recovery: {
        breaker: { failureThreshold: 1, initialPauseMs: 10, maxPauseMs: 40, probeTimeoutMs: 30 },
      },
    },
  );
  successful(results);
  assert.equal(control(results[4]).recovery.circuit, 'half-open');
  assert.equal(results[5].reply.admission, null);
  assert.equal(results[6].reply.refusal.name, 'CircuitOpenError');
  assert.equal(control(results[6]).maintenance.operations['implicit:fast'], undefined);
  assert.equal(control(results[7]).recovery.circuit, 'closed');
  assert.equal(results[8].state.remaining, '1');
});

test('drain acceptance permits retries, rejects new work and retains full completion evidence', async () => {
  const operation = { id: 'work', generation: 1 };
  const results = await scenario([
    event('a', 'open', 1000),
    event('a', 'accept', 1001, { operationId: 'work' }),
    status('a', 1002, { action: 'drain' }),
    event('a', 'accept', 1003, { operationId: 'new' }),
    acquire('a', 'attempt1', 1004, { operation }),
    release('a', 'attempt1', 1005),
    acquire('a', 'attempt2', 1006, { operation }),
    release('a', 'attempt2', 1007),
    status('a', 1008),
    event('a', 'finish', 1009, { operation }),
    status('a', 1010),
    status('a', 1011, { action: 'resume', generation: 1 }),
    acquire('a', 'next', 1012),
  ]);
  successful(results);
  assert.equal(results[3].reply.refusal.name, 'PoolDrainingError');
  assert.equal(decodeControl(results[8].reply.value).maintenance.pending, 1);
  assert.equal(decodeControl(results[10].reply.value).maintenance.clean, true);
  assert.ok(results[12].reply.admission);
});

test('owner expiry after lease expiry preserves uncertainty; acknowledgement never becomes clean', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('a', 'old', 1001, { expirationMs: 10 }),
      status('b', 1020, { action: 'drain' }),
      event('b', 'renew', 1250),
      status('b', 1301),
      status('b', 1302, {
        action: 'acknowledge',
        generation: 1,
        ids: ['implicit:old'],
        reason: 'Reviewed uncertainty',
      }),
    ],
    { ownerTimeoutMs: 300 },
  );
  successful(results);
  assert.equal(decodeControl(results[3].reply.value).maintenance.pending, 1);
  assert.equal(
    results[3].reply.deadline,
    '1300',
    'admin wait follows owners even after their lease expires',
  );
  assert.equal(decodeControl(results[5].reply.value).maintenance.unconfirmed, 1);
  const final = decodeControl(results[6].reply.value).maintenance;
  assert.equal(final.settled, true);
  assert.equal(final.clean, false);
});

test('invalid outcome rolls back all state and corrected release uses the same next sequence', async () => {
  const results = await scenario([
    event('a', 'open', 1000),
    acquire('a', 'held', 1001),
    release('a', 'held', 1002, { kind: 'invalid' }),
    release('a', 'held', 1003, { kind: 'success' }),
    acquire('a', 'later', 1004),
  ]);
  assert.match(results[2].error, /SEMAPHILE_INPUT/);
  assert.deepEqual(results[2].state, results[1].state);
  assert.equal(results[2].publications, results[1].publications);
  assert.equal(results[3].error, undefined);
  assert.ok(results[4].reply.admission);
});

test('renewal never sweeps expired leases or broadcasts admission hints', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      acquire('a', 'expired', 1001, { expirationMs: 5 }),
      event('a', 'renew', 1050),
    ],
    { reservoir: 1, reservoirRefreshAmount: 1, reservoirRefreshInterval: 10 },
  );
  successful(results);
  assert.ok(results[2].state.leases.expired);
  assert.equal(results[2].state.remaining, '0');
  assert.equal(results[2].publications, results[1].publications);
  assert.deepEqual(control(results[2]), control(results[1]));
});

test('large millisecond deadlines and numeric-looking identities round-trip exactly', async () => {
  const now = 8_000_000_000_000_111;
  const results = await scenario([
    event('123', 'open', now),
    event('123', 'accept', now + 1, { operationId: 'generation' }),
    acquire('123', 'at', now + 2, { operation: { id: 'generation', generation: 1 } }),
    release('123', 'at', now + 3, { kind: 'throttle', retryAfterMs: 12345 }),
  ]);
  successful(results);
  assert.equal(results[3].state.control.recovery.cooldownUntil, String(now + 3 + 12345));
  assert.equal(control(results[3]).maintenance.operations.generation.owner, '123');
});

test('admin mutation replay returns its bounded original receipt across peer commands', async () => {
  const results = await scenario([
    event('a', 'open', 1000),
    event('b', 'open', 1000),
    status('a', 1001, { action: 'drain' }),
    status('b', 1002, { action: 'resume', generation: 1 }),
    { ...status('a', 1003, { action: 'drain' }), sequence: 2 },
    { ...status('b', 1004, { action: 'resume', generation: 1 }), sequence: 2 },
    status('b', 1005),
    { ...status('b', 1006, { action: 'drain' }), sequence: 3 },
  ]);
  successful(results.slice(0, 7));
  assert.deepEqual(results[4].reply.value, results[2].reply.value);
  assert.deepEqual(results[5].reply.value, results[3].reply.value);
  assert.deepEqual(Object.keys(results[2].reply.value), ['maintenance']);
  assert.equal(results[5].publications, results[3].publications);
  assert.equal(decodeControl(results[6].reply.value).maintenance.mode, 'active');
  assert.match(results[7].error, /SEQUENCE operation mismatch/);
  assert.deepEqual(results[7].state, results[6].state);
});

test('acknowledgement replay preserves the original result and reason after resume', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('a', 'lost', 1001),
      status('b', 1002, { action: 'drain' }),
      event('b', 'renew', 1250),
      status('b', 1301, {
        action: 'acknowledge',
        generation: 1,
        ids: ['implicit:lost'],
        reason: 'Reviewed',
      }),
      event('c', 'open', 1302),
      status('c', 1303, { action: 'resume', generation: 1 }),
      {
        ...status('b', 1304, {
          action: 'acknowledge',
          generation: 1,
          ids: ['implicit:lost'],
          reason: 'Changed',
        }),
        sequence: 4,
      },
    ],
    { ownerTimeoutMs: 300 },
  );
  successful(results);
  assert.deepEqual(results[8].reply.value, results[5].reply.value);
  assert.deepEqual(control(results[8]), control(results[7]));
  assert.equal(results[8].publications, results[7].publications);
});

test('recovery refusal deadline stays distinct from earlier lease expiry wakeup', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('a', 'held', 1000, { expirationMs: 5 }),
      acquire('a', 'failed', 1000),
      release('a', 'failed', 1001, { kind: 'service-failure' }),
      acquire('b', 'waiting', 1002),
      acquire('b', 'fast', 1002, { circuit: 'fail-fast' }),
    ],
    { recovery: { breaker: { failureThreshold: 1, initialPauseMs: 50, maxPauseMs: 100 } } },
  );
  successful(results);
  assert.equal(results[5].reply.deadline, '1005');
  assert.equal(results[5].reply.recoveryDeadline, '1051');
  assert.equal(results[6].reply.refusal.notBefore, '1051');
});

test('expired and cancelled probes cannot reset a replacement with stale success', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      acquire('a', 'failed', 1000),
      release('a', 'failed', 1001, { kind: 'service-failure' }),
      acquire('a', 'expired', 1011),
      status('a', 1016),
      acquire('a', 'cancelled', 1026),
      release('a', 'expired', 1027, { kind: 'success' }),
      release('a', 'cancelled', 1028, { kind: 'neutral' }),
      acquire('a', 'replacement', 1038),
      release('a', 'cancelled', 1039, { kind: 'success' }),
    ],
    {
      maxConcurrent: 3,
      recovery: {
        breaker: { failureThreshold: 1, initialPauseMs: 10, maxPauseMs: 40, probeTimeoutMs: 5 },
      },
    },
  );
  successful(results);
  assert.equal(control(results[4]).recovery.circuit, 'open');
  assert.equal(control(results[6]).recovery.probe.id, 'cancelled');
  assert.equal(control(results[7]).recovery.circuit, 'open');
  assert.equal(control(results[9]).recovery.probe.id, 'replacement');
  assert.deepEqual(control(results[9]), control(results[8]));
});

test('lost probe owner cannot report recovery after another owner starts its replacement', async () => {
  const results = await scenario(
    [
      event('a', 'open', 1000),
      event('b', 'open', 1000),
      acquire('b', 'failed', 1200),
      release('b', 'failed', 1201, { kind: 'service-failure' }),
      event('b', 'renew', 1250),
      acquire('a', 'lost', 1295),
      status('b', 1301),
      acquire('b', 'replacement', 1311),
      release('a', 'lost', 1312, { kind: 'success' }),
      release('b', 'lost', 1313, { kind: 'success' }),
    ],
    {
      ownerTimeoutMs: 300,
      recovery: {
        breaker: { failureThreshold: 1, initialPauseMs: 10, maxPauseMs: 40, probeTimeoutMs: 500 },
      },
    },
  );
  successful(results.slice(0, 8));
  assert.equal(control(results[6]).recovery.circuit, 'open');
  assert.ok(control(results[6]).maintenance.unconfirmed['implicit:lost']);
  assert.match(results[8].error, /LOST owner expired/);
  assert.equal(results[9].error, undefined);
  assert.equal(control(results[9]).recovery.probe.id, 'replacement');
  assert.deepEqual(control(results[9]), control(results[7]));
});

test('percentage breaker respects minimum traffic, window expiry and same-time aggregation', async () => {
  const events = [event('a', 'open', 1000)];
  for (let i = 0; i < 3; i++) {
    events.push(
      acquire('a', `old-${i}`, 1000),
      release('a', `old-${i}`, 1000, { kind: 'service-failure' }),
    );
  }
  events.push(acquire('a', 'fresh', 1100), release('a', 'fresh', 1100, { kind: 'success' }));
  for (const [i, kind] of ['service-failure', 'success', 'service-failure'].entries()) {
    events.push(acquire('a', `new-${i}`, 1101), release('a', `new-${i}`, 1101, { kind }));
  }
  const results = await scenario(events, {
    recovery: {
      breaker: { rule: 'percentage', failureRatio: 0.5, minimumSamples: 4, windowMs: 100 },
    },
  });
  successful(results);
  const insufficient = control(results[6]).recovery;
  assert.equal(insufficient.circuit, 'closed');
  assert.deepEqual(insufficient.samples, [{ at: 1000, failures: 3, total: 3 }]);
  assert.deepEqual(control(results[8]).recovery.samples, [{ at: 1100, failures: 0, total: 1 }]);
  assert.equal(control(results[12]).recovery.circuit, 'closed');
  assert.equal(control(results[14]).recovery.circuit, 'open');
  assert.deepEqual(control(results[14]).recovery.samples, [
    { at: 1100, failures: 0, total: 1 },
    { at: 1101, failures: 2, total: 3 },
  ]);
});

await run();
