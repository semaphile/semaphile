import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import {
  openPoolObserver,
  CollectorConflictError,
} from '../../packages/core/dist/src/observation.js';
await mkdir('.tmp/otel', { recursive: true });
const path = await mkdtemp(resolve('.tmp/otel/pool-'));
const limiter = await openLimiter({ path, config: { maxConcurrent: 3 } });
const firstId = randomUUID(),
  secondId = randomUUID();
const first = await openPoolObserver({ path, collectorId: firstId });
try {
  await assert.rejects(
    openPoolObserver({ path: await realpath(path), collectorId: secondId }),
    (e) => e instanceof CollectorConflictError && e.owners.includes(firstId),
  );
  const overlap = await openPoolObserver({ path, collectorId: secondId, allowOverlap: true });
  try {
    assert.deepEqual((await first.owners()).sort(), [firstId, secondId].sort());
    await assert.rejects(
      openPoolObserver({ path, collectorId: randomUUID() }),
      (e) => e.owners.length === 2,
    );
    console.log(
      'PASS overlapping collectors stay visible and default collectors reject both owners',
    );
    let release;
    const running = limiter.schedule(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      { weight: 2 },
    );
    while (!release) {await new Promise((resolve) => setImmediate(resolve));}
    const sample = await overlap.sample();
    assert.equal(sample.active, 2);
    assert.equal(sample.maxConcurrent, 3);
    release();
    await running;
    assert.equal((await first.sample()).active, 0);
    console.log(
      'PASS observational snapshots report weighted shared occupancy without request work',
    );
  } finally {
    await overlap.close();
  }
  assert.deepEqual(await first.owners(), [firstId]);
} finally {
  await first.close();
  await limiter.close();
}
const restarted = await openPoolObserver({ path, collectorId: randomUUID() });
await restarted.close();
console.log('PASS collector close releases lifetime registration for subsequent ownership');
assert.deepEqual(await readdir(path + '/.telemetry/collectors-v1'), ['gate']);
await Promise.all(
  Array.from({ length: 100 }, () =>
    writeFile(path + '/.telemetry/collectors-v1/' + randomUUID() + '.lock', ''),
  ),
);
const cleaned = await openPoolObserver({ path, collectorId: randomUUID() });
await cleaned.close();
assert.deepEqual(await readdir(path + '/.telemetry/collectors-v1'), ['gate']);
console.log(
  'PASS startup bounds registration scanning and removes stale files without owners calls',
);
console.log('RESULT 4/4 passed');
