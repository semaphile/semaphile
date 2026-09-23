// Cross-host fixture. The orchestrator supplies endpoint/store identities via env.
import assert from 'node:assert/strict';
import { openRedisMessaging } from '../../packages/redis/dist/messaging.js';
import {
  encodeAgentMessage,
  decodeAgentMessage,
  validateAnswer,
} from '../../packages/messaging/dist/src/agent-messages.js';
const c = await openRedisMessaging({
  url: process.env.SEMAPHILE_REDIS_TEST_URL,
  namespace: 'crosshost',
  store: process.env.SEMAPHILE_MESSAGE_STORE,
  readiness: 'strict',
  operationTimeoutMs: 10000,
});
const question = {
  version: 1,
  type: 'question',
  question: 'Deploy where?',
  options: [{ id: 'staging', label: 'Staging' }],
};
try {
  switch (process.argv[2]) {
    case 'relay': {
      const sub = await c.subscribe('relay', { topics: ['agent.question'] });
      console.log('READY');
      const d = await sub.wait({ timeoutMs: 15000 });
      assert.ok(d);
      const q = decodeAgentMessage(d.message.body);
      assert.equal(q.type, 'question');
      const answer = validateAnswer(q, {
        version: 1,
        type: 'answer',
        selectedOptionId: 'staging',
        notes: 'Approved',
      });
      await c.send({
        to: d.message.replyTo,
        body: encodeAgentMessage(answer),
        correlationId: d.message.correlationId,
        dedupeKey: 'answer-1',
      });
      await c.ack(d.receipt);
      break;
    }
    case 'request': {
      await c.createMailbox('reply');
      await c.publish({
        topic: 'agent.question',
        body: encodeAgentMessage(question),
        replyTo: 'reply',
        correlationId: 'q1',
        dedupeKey: 'question-1',
      });
      const d = await c.wait('reply', { timeoutMs: 15000 });
      assert.ok(d);
      assert.equal(d.message.correlationId, 'q1');
      validateAnswer(question, decodeAgentMessage(d.message.body));
      await c.ack(d.receipt);
      break;
    }
    case 'prepare':
      await c.createMailbox('persisted');
      await c.send({ to: 'persisted', body: 'survives', dedupeKey: 'survives' });
      break;
    case 'verify': {
      const d = await c.wait('persisted', { timeoutMs: 1000 });
      assert.equal(d.message.body, 'survives');
      await c.ack(d.receipt);
      break;
    }
    case 'watch': {
      await c.createMailbox('restart');
      console.log('READY');
      const d = await c.wait('restart', { timeoutMs: 20000 });
      assert.equal(d.message.body, 'after restart');
      await c.ack(d.receipt);
      break;
    }
    case 'wake':
      await c.send({ to: 'restart', body: 'after restart' });
      break;
    default:
      throw Error('Unknown participant mode');
  }
  console.log('PASS ' + process.argv[2]);
} finally {
  await c.close();
}
