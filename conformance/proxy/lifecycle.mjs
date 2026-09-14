import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { errorResponse, ProxyError } from '../../packages/proxy/dist/errors.js';
// Model the writable lifecycle directly: Bun's ServerResponse synthetic socket
// adapter reports finish immediately, unlike a real network response.
for (const [status, code] of [
  [504, 'PROXY_TIMEOUT'],
  [503, 'PROXY_CLOSING'],
]) {
  let finish;
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(callback) {
      finish = callback;
    },
  });
  response.end('blocked final response');
  assert.equal(response.writableEnded, true);
  assert.equal(response.writableFinished, false);
  errorResponse(response, new ProxyError(status, code));
  assert.equal(response.destroyed, true);
  finish?.();
  console.log('PASS ' + code + ' destroys an ended response whose final write is still blocked');
}
console.log('RESULT 2/2 passed');
