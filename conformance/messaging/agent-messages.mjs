import assert from 'node:assert/strict';
import {
  validateAgentMessage,
  validateAnswer,
  encodeAgentMessage,
  decodeAgentMessage,
} from '../../packages/messaging/dist/src/agent-messages.js';
const question = {
  version: 1,
  type: 'question',
  question: 'Continue?',
  options: [
    { id: 'yes', label: 'Continue' },
    { id: 'no', label: 'Stop', example: 'Leave work queued' },
  ],
};
const answer = { version: 1, type: 'answer', selectedOptionId: 'yes' };
assert.deepEqual(decodeAgentMessage(encodeAgentMessage(question)), question);
assert.deepEqual(validateAnswer(question, answer), answer);
assert.deepEqual(
  validateAnswer(question, { ...answer, notes: 'After the review' }).notes,
  'After the review',
);
console.log('PASS optional question examples and answer notes round-trip');
for (const input of [
  null,
  [],
  { ...question, version: 2 },
  { ...question, options: [] },
  { ...question, options: [question.options[0], question.options[0]] },
  { ...question, question: '  ' },
  { ...answer, selectedOptionId: '' },
  { ...answer, notes: null },
  { ...question, options: [{ id: 'x', label: 'X', example: 42 }] },
  { ...answer, unexpected: 'x' },
]) {
  assert.throws(() => validateAgentMessage(input), { code: 'INPUT' });
}
assert.throws(() => validateAnswer(question, { ...answer, selectedOptionId: 'missing' }), {
  code: 'INPUT',
});
console.log(
  'PASS invalid versions, missing fields, duplicate options and unknown selections refuse',
);
const payload = {
  version: 1,
  type: 'turn-completed',
  projectId: 'project',
  runId: 'run',
  turnId: 'turn',
  outcome: 'completed',
};
assert.deepEqual(validateAgentMessage(payload), payload);
assert.throws(() => validateAgentMessage({ ...payload, outcome: 'invented' }), { code: 'INPUT' });
const copy = validateAgentMessage(question);
copy.options[0].label = 'changed';
assert.equal(question.options[0].label, 'Continue');
assert.throws(
  () => decodeAgentMessage('{"private payload'),
  (e) => !e.message.includes('private payload'),
);
console.log('PASS completion identity, defensive copies and payload-free parse diagnostics');
console.log('RESULT 3/3 passed');
