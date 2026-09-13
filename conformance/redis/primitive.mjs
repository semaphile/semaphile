import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { owner, server, key, config, connect } from './harness.mjs';
import { spawn } from 'node:child_process';
import { httpFixture } from './http-fixture.mjs';
import { once } from 'node:events';
const redis = await server();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS ' + name);
}
const clients = [];
async function open(pool = key(), settings) {
  const c = await owner(redis.url, pool, settings);
  clients.push(c);
  return c;
}
const acquire = (client, lease, weight = 1, expirationMs = null) =>
  client.invoke('acquire', { lease, weight, expirationMs });
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform}`,
);
try {
  await test('atomic shared capacity and any-holder release notification', async () => {
    const pool = key(),
      a = await open(pool),
      b = await open(pool),
      subscriber = await connect(redis.url);
    try {
      let wake = () => {};
      await subscriber.subscribe(pool + ':notify', () => wake());
      assert.ok((await acquire(a, 'oldest', 3)).admission);
      assert.ok((await acquire(b, 'newer', 2)).admission);
      assert.equal((await acquire(a, 'denied')).admission, null);
      await subscriber.ping();
      const event = new Promise((resolve) => {
        wake = resolve;
      });
      await b.invoke('release', { lease: 'newer' });
      await event;
      assert.ok((await acquire(b, 'replacement', 2)).admission);
      await b.invoke('release', { lease: 'newer' });
      assert.equal((await a.invoke('inspect')).value.active, '5');
    } finally {
      subscriber.destroy();
    }
  });
  await test('owner timeout reclaims capacity and rejects stale renewal', async () => {
    const pool = key(),
      settings = config({ ownerTimeoutMs: 300 });
    const a = await open(pool, settings);
    await acquire(a, 'abandoned', 5);
    await delay(350);
    await assert.rejects(a.invoke('renew'), /LOST/);
    const b = await open(pool, settings);
    assert.ok((await acquire(b, 'recovered', 5)).admission);
    await assert.rejects(a.invoke('renew'), /LOST/);
  });
  await test('renewal preserves a long request independently of job expiration', async () => {
    const a = await open(key(), config({ ownerTimeoutMs: 600 }));
    await acquire(a, 'long', 5);
    await delay(350);
    await a.invoke('renew');
    await delay(350);
    assert.equal((await a.invoke('inspect')).value.active, '5');
  });
  await test('renewal alone does not poll capacity or materialize idle budget resets', async () => {
    const pool = key(),
      a = await open(
        pool,
        config({ reservoir: 1, reservoirRefreshAmount: 1, reservoirRefreshInterval: 30 }),
      );
    await acquire(a, 'expired', 1, 20);
    await delay(60);
    await a.invoke('renew');
    const stored = JSON.parse(await a.client.get(pool));
    assert.equal(stored.remaining, '0');
    assert.ok(stored.leases.expired);
    assert.equal((await a.invoke('inspect')).value.active, '0');
    assert.equal((await a.invoke('reservoir')).value, '1');
  });
  await test('expired request frees capacity while owner stays live; duplicate release is harmless', async () => {
    const a = await open();
    await acquire(a, 'old', 5, 50);
    await delay(70);
    await acquire(a, 'new', 5);
    await a.invoke('release', { lease: 'old' });
    assert.equal((await a.invoke('inspect')).value.active, '5');
  });
  await test('full policy and ownership config mismatch precedes registration', async () => {
    const pool = key(),
      a = await open(pool);
    const before = await a.client.get(pool);
    await assert.rejects(open(pool, config({ ownerTimeoutMs: 3000 })), /CONFIG/);
    assert.equal(await a.client.get(pool), before);
  });
  await test('sequence replay cannot duplicate a budget increment; older sequence refuses', async () => {
    const a = await open(key(), config({ reservoir: 10 }));
    const first = await a.invoke('increment', { amount: 3 });
    assert.equal(first.value, '13');
    const replay = await a.invoke('increment', { amount: 3 }, 2);
    assert.equal(replay.value, '13');
    assert.equal((await a.invoke('reservoir')).value, '13');
    await assert.rejects(a.invoke('increment', { amount: 3 }, 2), /SEQUENCE/);
  });
  await test('safe integer budgets retain all digits and overflow consumes nothing', async () => {
    const a = await open(key(), config({ reservoir: Number.MAX_SAFE_INTEGER }));
    assert.equal((await a.invoke('reservoir')).value, String(Number.MAX_SAFE_INTEGER));
    await assert.rejects(a.invoke('increment', { amount: 1 }), /INPUT/);
    assert.equal((await a.invoke('reservoir', {}, 3)).value, String(Number.MAX_SAFE_INTEGER));
  });
  await test('spacing and refill provide computed deadlines with no token refund', async () => {
    const a = await open(
      key(),
      config({
        reservoir: 1,
        reservoirRefreshAmount: 1,
        reservoirRefreshInterval: 100,
        minTime: 60,
      }),
    );
    await acquire(a, 'first');
    await a.invoke('release', { lease: 'first' });
    assert.equal((await a.invoke('reservoir')).value, '0');
    const blocked = await acquire(a, 'second');
    assert.equal(blocked.admission, null);
    assert.ok(Number(blocked.deadline) > Number(blocked.now));
    await delay(120);
    assert.ok((await acquire(a, 'third')).admission);
  });
  await test('spacing independently blocks admission with capacity and tokens available', async () => {
    const a = await open(key(), config({ reservoir: 5, minTime: 200 }));
    await acquire(a, 'first');
    await a.invoke('release', { lease: 'first' });
    const blocked = await acquire(a, 'second');
    assert.equal(blocked.admission, null);
    assert.ok(Number(blocked.deadline) > Number(blocked.now));
  });
  await test('inspection history keeps stored state linear in owners and leases', async () => {
    async function size(count) {
      const pool = key(),
        members = [];
      for (let i = 0; i < count; i++) {
        const member = await open(pool, config({ maxConcurrent: null, ownerTimeoutMs: 10000 }));
        members.push(member);
        await acquire(member, 'job-' + i);
      }
      for (const member of members) {
        assert.equal((await member.invoke('inspect')).value.active, String(count));
      }
      return (await members[0].client.get(pool)).length;
    }
    const small = await size(8),
      large = await size(16);
    assert.ok(large < small * 2.5, `state grew from ${small} to ${large} bytes`);
  });
  await test('missing state refuses established owners rather than recreating capacity', async () => {
    const pool = key(),
      a = await open(pool);
    await a.client.del(pool);
    await assert.rejects(a.invoke('renew'), /LOST/);
    assert.equal(await a.client.exists(pool), 0);
  });
  await test('two independent processes submit twenty HTTP requests with shared cap five', async () => {
    const http = await httpFixture();
    const pool = key(),
      children = [];
    try {
      const jobs = [0, 1].map(() => {
        const child = spawn(process.execPath, ['conformance/redis/participant.mjs'], {
          env: {
            ...process.env,
            REDIS_URL: redis.url,
            POOL: pool,
            HTTP_URL: http.url,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(child);
        let output = '';
        child.stdout.on('data', (data) => {
          output += data;
        });
        child.stderr.on('data', (data) => {
          output += data;
        });
        return once(child, 'exit').then(([code]) => assert.equal(code, 0, output));
      });
      await Promise.all([http.saturated, ...jobs]);
      assert.equal(http.stats.completed, 20);
      assert.equal(http.stats.peak, 5);
      console.log(`  participants=2 requests=${http.stats.completed} peak=${http.stats.peak}`);
    } finally {
      for (const child of children) {
        if (child.exitCode === null) {
          child.kill();
        }
      }
      await http.close();
    }
  });
  await test('HTTP fixture detects excess concurrency when no limiter is used', async () => {
    const http = await httpFixture();
    try {
      await Promise.all([
        http.saturated,
        ...Array.from({ length: 20 }, async () => {
          const response = await fetch(http.url);
          await response.text();
        }),
      ]);
      assert.equal(http.stats.completed, 20);
      assert.ok(http.stats.peak > 5, `counter hid excess concurrency: ${http.stats.peak}`);
      console.log(`  unthrottled requests=${http.stats.completed} peak=${http.stats.peak}`);
    } finally {
      await http.close();
    }
  });
  console.log(`RESULT ${passed}/14 passed`);
} finally {
  for (const client of clients) {
    client.destroy();
  }
  await redis.close();
}
