import assert from 'node:assert/strict';
import { openLimiter, type Admission, type OpenOptions } from '@semaphile/redis';
const options: OpenOptions = {
  url: process.env.REDIS_URL!,
  pool: process.env.POOL!,
  config: { maxConcurrent: 2, minTime: 1 },
  ownerTimeoutMs: 3000,
};
if (process.env.SEMAPHILE_TYPECHECK_ONLY === '1') {
  // @ts-expect-error Redis requires an endpoint.
  void openLimiter({ pool: 'missing-url', config: { maxConcurrent: 1 } });
  // @ts-expect-error Existing-only selection is boolean.
  void openLimiter({ ...options, create: 'false' });
  // @ts-expect-error Numeric owner timeout only.
  void openLimiter({ ...options, ownerTimeoutMs: '3000' });
}
const left = await openLimiter(options),
  right = await openLimiter(options);
let active = 0,
  peak = 0;
try {
  const tasks: Promise<number>[] = Array.from({ length: 10 }, (_, i) =>
    (i % 2 ? left : right).schedule(async (admission: Admission) => {
      assert.equal(admission.weight, 1);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return i;
    }),
  );
  assert.deepEqual(
    await Promise.all(tasks),
    Array.from({ length: 10 }, (_, i) => i),
  );
  assert.equal(peak, 2);
  assert.equal((await left.inspect()).active, 0);
  const result: number = await left.execute(({ attempt }) => attempt, {
    retrySafety: 'safe',
    classifier: { id: 'semaphile.generic/1', classify: () => ({ kind: 'success' }) },
  });
  assert.equal(result, 1);
  const response: Response = await left.http.fetch('data:text/plain,redis');
  assert.equal(await response.text(), 'redis');
  const scoped: string = await right.http.request('data:text/plain,scoped', (value) =>
    value.text(),
  );
  assert.equal(scoped, 'scoped');
  const drain = await left.maintenance.drain();
  await assert.rejects(
    right.execute(() => 1),
    { name: 'PoolDrainingError' },
  );
  assert.equal(
    (await right.maintenance.wait({ generation: drain.maintenance.generation, timeoutMs: 1000 }))
      .maintenance.clean,
    true,
  );
  await left.maintenance.resume(drain.maintenance.generation);
  const existing = await openLimiter({ ...options, create: false });
  await existing.close();
} finally {
  await Promise.all([left.close({ drain: true }), right.close()]);
}
