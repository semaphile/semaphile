import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { startCollector } from '../../packages/otel/dist/collector.js';
await mkdir('.tmp/otel', { recursive: true });
const root = await mkdtemp(resolve('.tmp/otel/collect-'));
const pools = [];
const make = async (name) => {
  const pool = await openLimiter({ path: join(root, name), config: { maxConcurrent: 2 } });
  pools.push(pool);
  return pool;
};
await make('api-a');
await make('api-b');
await make('private');
const sources = [{ name: 'local', backend: 'sqlite', directory: root }],
  warnings = [];
const a = await startCollector({
  sources,
  port: 0,
  include: ['api-*', 'private'],
  exclude: ['private'],
  onWarning: (w) => warnings.push(w),
});
let b;
try {
  assert.equal(a.health().pools.length, 2);
  await assert.rejects(startCollector({ sources, port: 0 }), /already have collectors/);
  b = await startCollector({
    sources,
    port: 0,
    include: ['api-a'],
    allowOverlap: true,
    onWarning: (w) => warnings.push(w),
  });
  assert(warnings.some((w) => w.kind === 'overlap'));
  await a.refresh();
  assert(a.health().pools.some((p) => p.owners.includes(b.id)));
  console.log('PASS partial startup conflicts reject; overlap collectors warn and remain visible');
  await make('api-new');
  await a.refresh();
  assert.equal(a.health().pools.length, 3);
  const url = `http://127.0.0.1:${a.address.port}`;
  const output = await (await fetch(url + '/metrics')).text();
  assert(output.includes('semaphile_pool_active'));
  assert(output.includes('api-new'));
  assert(!output.includes('private'));
  assert.equal((await fetch(url + '/healthz')).status, 200);
  console.log('PASS repeated selection, exclusion precedence, watched discovery and HTTP metrics');
  const frozen = await startCollector({
    sources,
    port: 0,
    include: ['api-*'],
    allowOverlap: true,
    watchPools: false,
  });
  try {
    await make('api-later');
    await frozen.refresh();
    assert.equal(frozen.health().pools.length, 3);
  } finally {
    await frozen.close();
  }
  console.log('PASS disabled watching freezes startup pool selection');
  await make('a'.repeat(48));
  const start = performance.now();
  const adversarial = await startCollector({
    sources,
    port: 0,
    include: ['*a'.repeat(24) + 'b'],
    allowOverlap: true,
  });
  await adversarial.close();
  assert(performance.now() - start < 2000);
  console.log('PASS repeated-wildcard selectors complete within a bounded collection cycle');
} finally {
  await b?.close();
  await a.close();
  await Promise.all(pools.map((p) => p.close()));
}
console.log('RESULT 4/4 passed');
