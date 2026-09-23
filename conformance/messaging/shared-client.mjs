// Exercise the backend boundary without a SQLite coordinator or native addon.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MessagingClient, defaults } from '../../packages/messaging/dist/src/shared.js';
class Transport extends EventEmitter {
  commands = [];
  postMessage(command) {
    this.commands.push(command);
    if (command.action === 'wait') {
      this.pending = command;
      return;
    }
    if (command.action === 'abort') {
      queueMicrotask(() =>
        this.emit('message', {
          id: this.pending.id,
          value: {
            id: 'd',
            messageId: 'm',
            seq: 1,
            recipient: 'inbox',
            message: { to: 'inbox', body: 'late grant' },
            receipt: { deliveryId: 'd', claimId: 'c' },
            attempt: 1,
            ackMode: 'manual',
            claimedAt: 1,
            claimExpiresAt: 9999999999999,
            handlingExpiresAt: 9999999999999,
          },
        }),
      );
      return;
    }
    queueMicrotask(() => {
      this.emit('message', {
        id: command.id,
        value: command.action === 'release' ? { status: 'released' } : undefined,
      });
      if (command.action === 'close') {
        this.emit('exit', 0);
      }
    });
  }
}
const transport = new Transport();
const client = new MessagingClient('remote:test', transport, { ...defaults }, []);
const cancel = new AbortController();
const waiting = client.wait('inbox', { signal: cancel.signal });
await Promise.resolve();
cancel.abort();
await assert.rejects(waiting, { code: 'ABORTED' });
await client.close();
assert.deepEqual(
  transport.commands.map((c) => c.action),
  ['wait', 'abort', 'release', 'close'],
);
console.log('PASS native-free transport: cancelled late claim is released before close');
console.log('RESULT 1/1 passed');
