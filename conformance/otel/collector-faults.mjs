// Fault injection into an isolated copy of the built collector; production code
// has no test hooks. Advance its clock and churn discovery without wall sleeps.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
const built = await readFile('packages/otel/dist/collector.js', 'utf8');
for (const mode of ['startup', 'growth', 'deadline', 'alias']) {
  let now = 0,
    generation = 0,
    next = 0,
    active = 0,
    scans = 0;
  const ids = new Map();
  const server = Object.assign(new EventEmitter(), {
    setTimeout() {},
    listen(_port, _host, cb) {
      cb();
    },
    address() {
      return {};
    },
    close(cb) {
      cb?.();
    },
    closeAllConnections() {},
  });
  const fixture = {
    performance: { now: () => now },
    createServer: () => server,
    realpath: async (p) => p,
    stat: async (p) => {
      if (mode === 'alias') {
        p = p.replace('/alias/', '/root/');
      }
      if (!ids.has(p)) {
        ids.set(p, ++next);
      }
      return { dev: 1n, ino: BigInt(ids.get(p)) };
    },
    opendir: async (root) => {
      scans++;
      if (mode === 'deadline') {
        now = 6000;
        throw Error('late source');
      }
      if (mode === 'alias' && generation && root === '/root') {
        throw Error('source unavailable');
      }
      if (root === '/broken' && generation) {
        throw Error('unavailable');
      }
      return {
        async *[Symbol.asyncIterator]() {
          for (const name of mode === 'startup'
            ? ['a', 'b']
            : root === '/broken'
              ? ['fixed']
              : mode === 'alias'
                ? ['fixed']
                : [String(generation)]) {
            yield { name, isDirectory: () => true };
          }
        },
      };
    },
    implementation: {
      openPoolObserver: async ({ path }) => {
        if (mode === 'startup' && path.endsWith('/b')) {
          throw Object.assign(Error('conflict'), { owners: ['peer'] });
        }
        active++;
        return {
          valid: () => !(mode === 'alias' && generation && path.startsWith('/root/')),
          owners: async () => {
            if (mode === 'alias' && generation && path.startsWith('/root/')) {
              throw Error('retired source');
            }
            if (mode === 'startup') {
              now = 6000;
            }
            return [];
          },
          sample: async () => ({ at: 0, active: 0 }),
          close: async () => {
            active--;
          },
        };
      },
    },
  };
  globalThis.__collectorFixture = fixture;
  const source = built
    .replace(
      /import \{[^}]+\} from 'node:http';/,
      'const { createServer } = globalThis.__collectorFixture;',
    )
    .replace(
      /import \{[^}]+\} from 'node:fs\/promises';/,
      'const { opendir, realpath, stat } = globalThis.__collectorFixture;',
    )
    .replaceAll('await import(moduleName)', 'globalThis.__collectorFixture.implementation');
  const { startCollector } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        `const { performance } = globalThis.__collectorFixture;\n${source}\n// ${mode}`,
      ).toString('base64')
  );
  const options = {
    port: 0,
    sources: [
      { name: 'local', backend: 'sqlite', directory: '/root' },
      ...(mode === 'growth' ? [{ name: 'broken', backend: 'sqlite', directory: '/broken' }] : []),
      ...(mode === 'alias' ? [{ name: 'alias', backend: 'sqlite', directory: '/alias' }] : []),
      ...(mode === 'deadline'
        ? Array.from({ length: 63 }, (_, i) => ({
            name: `source${i}`,
            backend: 'sqlite',
            directory: `/source${i}`,
          }))
        : []),
    ],
  };
  if (mode === 'deadline') {
    await assert.rejects(startCollector(options), /discovery failed/);
    assert.equal(scans, 1);
    console.log('PASS exhausted discovery budget prevents starting more source operations');
  } else if (mode === 'alias') {
    const collector = await startCollector(options);
    try {
      assert.equal(collector.health().pools.length, 1);
      generation = 1;
      await collector.refresh();
      await collector.refresh();
      const [pool] = collector.health().pools;
      assert.equal(pool.source, 'alias');
      assert.equal(pool.error, undefined);
      assert.equal(active, 1);
    } finally {
      await collector.close();
    }
    console.log('PASS canonical pool acquisition can move to a healthy source alias');
  } else if (mode === 'startup') {
    await assert.rejects(startCollector(options), /verify every selected pool/);
    assert.equal(active, 0);
    console.log(
      'PASS startup deadline cannot bypass unchecked ownership; partial registrations close',
    );
  } else {
    const collector = await startCollector(options);
    try {
      for (generation = 1; generation <= 1050; generation++) {
        await collector.refresh();
      }
      assert.equal(collector.health().pools.length, 2);
      assert.equal(active, 2);
      assert.equal(collector.health().healthy, false);
    } finally {
      await collector.close();
    }
    assert.equal(active, 0);
    console.log('PASS one source outage cannot retain disappeared pools from another source');
  }
}
delete globalThis.__collectorFixture;
console.log('RESULT 4/4 passed');
