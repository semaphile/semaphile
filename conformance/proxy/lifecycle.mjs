import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import { errorResponse, ProxyError } from '../../packages/proxy/dist/errors.js';
for (const [status, code] of [
  [504, 'PROXY_TIMEOUT'],
  [503, 'PROXY_CLOSING'],
]) {
  let blockedWrite;
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      blockedWrite = callback;
    },
  });
  const incoming = new IncomingMessage(socket);
  const response = new ServerResponse(incoming);
  response.assignSocket(socket);
  response.end('blocked final response');
  assert.equal(response.writableEnded, true);
  assert.equal(response.writableFinished, false);
  errorResponse(response, new ProxyError(status, code));
  assert.equal(response.destroyed, true);
  assert.equal(socket.destroyed, true);
  blockedWrite?.();
  console.log('PASS ' + code + ' destroys an ended response whose final write is still blocked');
}
console.log('RESULT 2/2 passed');
