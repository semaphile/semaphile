import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { server, connect } from '../redis/harness.mjs';
import { openLimiter } from '../../packages/redis/dist/index.js';
import { openObservationSource, poolKey } from '../../packages/redis/dist/observation.js';
const redis = await server(),
  namespace = randomUUID(),
  pool = 'api';
const limiter = await openLimiter({
  url: redis.url,
  namespace,
  pool,
  config: { maxConcurrent: 3 },
});
const source = await openObservationSource({ url: redis.url, namespace });
let first, second;
try {
  assert.deepEqual(await source.discover(), [pool]);
  first = await source.open(pool, randomUUID());
  await assert.rejects(source.open(pool, randomUUID()), (e) => e.owners.length === 1);
  second = await source.open(pool, randomUUID(), true);
  assert.equal((await first.owners()).length, 2);
  console.log('PASS Redis discovery and overlapping registration agree with default rejection');
  let release;
  const running = limiter.schedule(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { weight: 2 },
  );
  while (!release) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal((await first.sample()).active, 2);
  release();
  await running;
  const command = await connect(redis.url);
  try {
    const key = poolKey(namespace, pool),
      before = await command.get(key);
    assert.equal((await first.sample()).active, 0);
    assert.equal(await command.get(key), before);
    await command.del(key + ':collectors-v1');
    await assert.rejects(first.sample(), /expired/);
    for (const action of ['sample', 'owners']) {
      const reusedId = randomUUID();
      const stale = await source.open(pool, reusedId);
      await command.zAdd(key + ':collectors-v1', { score: 1, value: reusedId });
      const reopened = await source.open(pool, reusedId);
      await assert.rejects(stale[action](), /expired/);
      assert.equal(stale.valid(), false);
      await stale.close();
      assert.deepEqual(await reopened.owners(), [reusedId]);
      assert.equal((await reopened.sample()).active, 0);
      await reopened.close();
    }
    console.log(
      'PASS expired Redis collector identity reopens and stale cleanup preserves its replacement',
    );
  } finally {
    command.destroy();
  }
  console.log('PASS Redis projection is read-only and lost registration rejects sampling');
} finally {
  await Promise.allSettled([first?.close(), second?.close()]);
  await source.close();
  await limiter.close();
  await redis.close();
}
console.log('RESULT 3/3 passed');
