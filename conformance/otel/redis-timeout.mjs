// Keep a Redis TCP connection alive while withholding replies after registration.
import assert from 'node:assert/strict';
import { createServer, connect as tcpConnect } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { server } from '../redis/harness.mjs';
import { openLimiter } from '../../packages/redis/dist/index.js';
import { openObservationSource } from '../../packages/redis/dist/observation.js';
const redis = await server();
const namespace = randomUUID();
const limiter = await openLimiter({
  url: redis.url,
  namespace,
  pool: 'api',
  config: { maxConcurrent: 1 },
});
let stall = false,
  bytes = 0;
const sockets = new Set();
const proxy = createServer((socket) => {
  const upstream = tcpConnect({ host: '127.0.0.1', port: Number(new URL(redis.url).port) });
  sockets.add(socket);
  sockets.add(upstream);
  socket.on('error', () => {});
  upstream.on('error', () => {});
  socket.on('close', () => {
    upstream.destroy();
    sockets.delete(socket);
  });
  upstream.on('close', () => {
    socket.destroy();
    sockets.delete(upstream);
  });
  socket.on('data', (chunk) => {
    bytes += chunk.length;
    upstream.write(chunk);
  });
  upstream.on('data', (chunk) => {
    if (!stall) {
      socket.write(chunk);
    }
  });
});
proxy.listen(0, '127.0.0.1');
await once(proxy, 'listening');
let source;
try {
  source = await openObservationSource({
    url: `redis://127.0.0.1:${proxy.address().port}`,
    namespace,
  });
  const observer = await source.open('api', randomUUID());
  stall = true;
  await assert.rejects(source.discover(), /timed out/);
  assert.equal(observer.valid(), false);
  const before = bytes;
  for (let i = 0; i < 10; i++) {
    await assert.rejects(source.discover(), /retired/);
  }
  assert.equal(bytes, before);
  console.log(
    'PASS response timeout retires socket, invalidates ownership, and refuses further commands',
  );
} finally {
  await source?.close();
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise((resolve) => proxy.close(resolve));
  await limiter.close();
  await redis.close();
}
console.log('RESULT 1/1 passed');
