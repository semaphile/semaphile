import assert from 'node:assert/strict';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
import {
  acceptOperation,
  acknowledgeUnconfirmed,
  abandonOwner,
  beginDrain,
  drainStatus,
  endOperationAttempt,
  finishOperation,
  initialMaintenanceState,
  PoolDrainingError,
  resumePool,
  startOperationAttempt,
} from '../../packages/core/dist/src/maintenance-state.js';

test('drain fences new acceptance but previously accepted work can retry', () => {
  const state = initialMaintenanceState();
  const old = acceptOperation(state, 'owner', 'old');
  const { generation } = beginDrain(state);
  assert.equal(beginDrain(state).generation, generation);
  assert.throws(() => acceptOperation(state, 'owner', 'new'), PoolDrainingError);
  startOperationAttempt(state, 'owner', old);
  endOperationAttempt(state, 'owner', old, 1);
  startOperationAttempt(state, 'owner', old);
  assert.throws(() => finishOperation(state, 'owner', old));
  endOperationAttempt(state, 'owner', old, 2);
  assert.equal(finishOperation(state, 'owner', old), true);
  assert.equal(finishOperation(state, 'owner', old), false);
  assert.equal(drainStatus(state).clean, true);
  assert.throws(() => acceptOperation(state, 'owner', 'new'), PoolDrainingError);
});

test('owner crash distinguishes queued work from unconfirmed active effects', () => {
  const state = initialMaintenanceState();
  acceptOperation(state, 'lost', 'queued');
  const running = acceptOperation(state, 'lost', 'running');
  const survivor = acceptOperation(state, 'live', 'survivor');
  startOperationAttempt(state, 'lost', running);
  const { generation } = beginDrain(state);
  abandonOwner(state, 'lost');
  assert.equal(drainStatus(state).pending, 1);
  assert.equal(drainStatus(state).unconfirmed, 1);
  finishOperation(state, 'live', survivor);
  assert.equal(drainStatus(state).settled, false);
  const status = acknowledgeUnconfirmed(
    state,
    generation,
    ['running'],
    'Operator verified remote service stopped',
  );
  assert.equal(status.settled, true);
  assert.equal(status.clean, false);
  assert.equal(status.acknowledged, 1);
  assert.equal(state.unconfirmed.running.reason, 'Operator verified remote service stopped');
});

test('maintenance generation prevents an old administrator from resuming a later drain', () => {
  const state = initialMaintenanceState();
  const first = beginDrain(state).generation;
  resumePool(state, first);
  acceptOperation(state, 'owner', 'new');
  const second = beginDrain(state).generation;
  assert.equal(second, first + 1);
  assert.throws(() => resumePool(state, first));
  assert.equal(state.mode, 'draining');
  resumePool(state, second);
  assert.equal(state.mode, 'active');
});

test('one owner cannot finish or start another owner operation', () => {
  const state = initialMaintenanceState();
  const work = acceptOperation(state, 'a', 'work');
  assert.throws(() => finishOperation(state, 'b', work));
  assert.throws(() => startOperationAttempt(state, 'b', work));
  startOperationAttempt(state, 'a', work);
  assert.throws(() => startOperationAttempt(state, 'a', work));
  assert.equal(drainStatus(state).pending, 1);
});

test('invalid or partial acknowledgement does not discard uncertainty', () => {
  const state = initialMaintenanceState();
  const work = acceptOperation(state, 'a', 'work');
  startOperationAttempt(state, 'a', work);
  abandonOwner(state, 'a');
  const { generation } = beginDrain(state);
  assert.throws(() => acknowledgeUnconfirmed(state, generation, ['work', 'missing'], 'reason'));
  assert.throws(() => acknowledgeUnconfirmed(state, generation, ['work'], ''));
  assert.equal(state.unconfirmed.work.acknowledged, false);
  assert.throws(() => acceptOperation(state, 'a', '__proto__'));
});

test('late completion cannot end a replacement attempt during drain', () => {
  const state = initialMaintenanceState();
  const work = acceptOperation(state, 'a', 'work');
  const first = startOperationAttempt(state, 'a', work);
  assert.equal(endOperationAttempt(state, 'a', work, first), true);
  const next = startOperationAttempt(state, 'a', work);
  beginDrain(state);
  assert.equal(endOperationAttempt(state, 'a', work, first), false);
  assert.throws(() => finishOperation(state, 'a', work));
  assert.equal(endOperationAttempt(state, 'a', work, next), true);
  finishOperation(state, 'a', work);
  assert.equal(drainStatus(state).clean, true);
});

test('reusing an operation id fences every report from its previous acceptance', () => {
  const state = initialMaintenanceState();
  const old = acceptOperation(state, 'a', 'work');
  const oldAttempt = startOperationAttempt(state, 'a', old);
  assert.equal(endOperationAttempt(state, 'a', old, oldAttempt), true);
  assert.equal(finishOperation(state, 'a', old), true);
  const replacement = acceptOperation(state, 'a', 'work');
  assert.notEqual(replacement.generation, old.generation);
  assert.throws(() => startOperationAttempt(state, 'a', old));
  assert.equal(finishOperation(state, 'a', old), false);
  const nextAttempt = startOperationAttempt(state, 'a', replacement);
  beginDrain(state);
  assert.equal(endOperationAttempt(state, 'a', old, oldAttempt), false);
  assert.equal(finishOperation(state, 'a', old), false);
  assert.equal(drainStatus(state).clean, false);
  assert.throws(() => finishOperation(state, 'a', replacement));
  assert.equal(endOperationAttempt(state, 'a', replacement, nextAttempt), true);
  assert.equal(finishOperation(state, 'a', replacement), true);
  assert.equal(drainStatus(state).clean, true);
});

test('exhausted acceptance sequence fails without creating a ticket', () => {
  const state = initialMaintenanceState();
  state.operationSequence = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(state);
  assert.throws(() => acceptOperation(state, 'a', 'work'), /generation overflow/);
  assert.deepEqual(state, before);
});

await run();
