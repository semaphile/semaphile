// Exercise real sockets whose DNS completion races failure of the other
// connection. The driver does not yet retain these pending sockets to destroy.
import assert from 'node:assert/strict';
import net from 'node:net';
import { RedisBackend } from '../../packages/redis/dist/backend.js';
import { server, key } from './harness.mjs';
const redis = await server(),
  original = net.createConnection;
const sockets = [],
  lookups = [];
const backend = new RedisBackend({
  url: redis.url,
  pool: key(),
  config: { maxConcurrent: 1 },
  ownerTimeoutMs: 1500,
});
net.createConnection = (options) => {
  const index = sockets.length;
  const socket = original({
    ...options,
    host: 'semaphile-startup.invalid',
    lookup(_host, options, callback) {
      lookups.push(
        setTimeout(
          () => {
            if (index === 0) {
              callback(Object.assign(new Error('injected DNS failure'), { code: 'ENOTFOUND' }));
            } else if (options.all) {
              callback(null, [{ address: '127.0.0.1', family: 4 }]);
            } else {
              callback(null, '127.0.0.1', 4);
            }
          },
          index === 0 ? 20 : 100,
        ),
      );
    },
  });
  sockets.push(socket);
  return socket;
};
try {
  await assert.rejects(backend.open(), /injected DNS failure/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(sockets.length, 2);
  assert.ok(
    sockets.every((socket) => socket.destroyed),
    'a pending connection survived terminal startup failure',
  );
  assert.equal(backend.wire.subscriber.isReady, false);
  console.log(
    `PASS ${process.platform} ${process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.version}: startup failure destroys pending sockets before late DNS completion`,
  );
  console.log('RESULT 1/1 passed');
} finally {
  net.createConnection = original;
  for (const timer of lookups) {
    clearTimeout(timer);
  }
  for (const socket of sockets) {
    socket.destroy();
  }
  await backend.detach().catch(() => {});
  await redis.close();
}
