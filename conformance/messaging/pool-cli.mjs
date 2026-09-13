import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { RedisBackend } from '../../packages/redis/dist/backend.js';
import { openLimiter as sqlite } from '../../packages/core/dist/src/index.js';
import { openLimiter as redisLimiter } from '../../packages/redis/dist/index.js';
import { Pool } from '../../packages/core/dist/src/backend.js';
import { nativePath } from '../../packages/core/dist/src/native-path.js';
import { server, connect } from '../redis/harness.mjs';
import { suite } from '../typescript/fixtures/cases.mjs';
const { test, run } = suite();
await mkdir('.tmp/pool-cli', { recursive: true });
const root = resolve(await mkdtemp('.tmp/pool-cli/run-'));
const script = resolve(process.env.SEMAPHILE_TEST_CLI ?? 'packages/messaging/dist/src/cli.js');
const redis = await server();
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const invoke = (args, cwd = root) =>
  new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', script, 'pool', ...args], {
      cwd,
      env: { ...process.env, SEMAPHILE_CLI_TEST_REDIS: redis.url },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    let out = '',
      err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolveResult({ code, out, err }));
  });
const value = (result) => {
  assert.equal(result.code, 0, result.err);
  return JSON.parse(result.out);
};
const config = { maxConcurrent: 1 };
const configPath = join(root, 'policy.json');
await writeFile(configPath, JSON.stringify(config));
for (const backend of ['sqlite', 'redis']) {
  test(`${backend} CLI: configured status, persistent drain, timed wait and resume`, async () => {
    const cwd = join(root, backend);
    await mkdir(cwd);
    const path = join(cwd, 'stores', 'pools', 'service');
    await writeFile(
      join(cwd, 'semaphile.json'),
      JSON.stringify({ version: 1, directory: './stores', pools: { service: config } }),
    );
    const limiter =
      backend === 'sqlite'
        ? await sqlite({ path, config })
        : await redisLimiter({ url: redis.url, pool: 'cli-service', config });
    const args =
      backend === 'sqlite'
        ? ['--name', 'service']
        : [
            '--redis-url-env',
            'SEMAPHILE_CLI_TEST_REDIS',
            '--pool',
            'cli-service',
            '--pool-config',
            configPath,
          ];
    const started = deferred(),
      finish = deferred();
    const running = limiter.execute(async () => {
      started.resolve();
      await finish.promise;
      return 'complete';
    });
    try {
      await started.promise;
      const status = value(await invoke(['status', ...args], cwd));
      assert.match(status.fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(status.maintenance.pending, 1);
      const drain = value(await invoke(['drain', ...args], cwd)),
        generation = String(drain.maintenance.generation);
      assert.equal(drain.maintenance.mode, 'draining');
      await assert.rejects(
        limiter.execute(() => assert.fail('draining callback')),
        { name: 'PoolDrainingError' },
      );
      assert.equal(
        (await invoke(['wait', '--generation', generation, '--timeout', '10', ...args], cwd)).code,
        2,
      );
      assert.equal((await limiter.maintenance.status()).maintenance.mode, 'draining');
      finish.resolve();
      assert.equal(await running, 'complete');
      assert.equal(
        value(await invoke(['wait', '--generation', generation, ...args], cwd)).maintenance.clean,
        true,
      );
      assert.equal(
        value(await invoke(['resume', '--generation', generation, ...args], cwd)).maintenance.mode,
        'active',
      );
      assert.equal(await limiter.execute(() => 7), 7);
    } finally {
      finish.resolve();
      await running;
      await limiter.close();
    }
  });
}
test('explicit SQLite store reads persisted config and acknowledges uncertainty without claiming completion', async () => {
  const path = join(root, 'uncertain'),
    owner = new Pool(path, config, nativePath());
  await owner.acquireDetailed();
  await owner.close();
  const status = value(await invoke(['status', '--store', path]));
  const ids = Object.keys(status.unconfirmed);
  assert.equal(ids.length, 1);
  const drain = value(await invoke(['drain', '--store', path])),
    generation = String(drain.maintenance.generation);
  const idsFile = join(root, 'ids.json');
  await writeFile(idsFile, JSON.stringify(ids));
  const acknowledged = value(
    await invoke([
      'acknowledge',
      '--store',
      path,
      '--generation',
      generation,
      '--ids-file',
      idsFile,
      '--reason',
      'Operator reviewed uncertainty',
    ]),
  );
  assert.equal(acknowledged.maintenance.settled, true);
  assert.equal(acknowledged.maintenance.clean, false);
  value(await invoke(['resume', '--store', path, '--generation', generation]));
});
test('administration refuses a missing SQLite store instead of creating one', async () => {
  const path = join(root, 'missing');
  assert.notEqual((await invoke(['status', '--store', path])).code, 0);
  await assert.rejects(access(path));
});
test('Redis administration refuses missing state without allocating fresh budgets', async () => {
  const client = await connect(redis.url);
  try {
    const before = await client.dbSize();
    const result = await invoke([
      'status',
      '--redis-url-env',
      'SEMAPHILE_CLI_TEST_REDIS',
      '--pool',
      'missing-pool',
      '--pool-config',
      configPath,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /missing pool state/);
    assert.equal(await client.dbSize(), before);
  } finally {
    await client.quit();
  }
});
test('invalid generation and conflicting backend arguments refuse before mutation', async () => {
  assert.equal((await invoke(['resume', '--generation', '0', '--store', 'missing'])).code, 5);
  assert.equal(
    (await invoke(['drain', '--store', 'missing', '--redis-url-env', 'SEMAPHILE_CLI_TEST_REDIS']))
      .code,
    5,
  );
});
test('empty selectors and named policy overrides refuse before selecting a store', async () => {
  for (const args of [
    ['--store', '', '--name', 'service'],
    ['--redis-url-env', '', '--name', 'service'],
    ['--name', 'service', '--pool-config', configPath],
  ]) {
    assert.equal((await invoke(['drain', ...args], join(root, 'sqlite'))).code, 5);
  }
  assert.equal(
    value(await invoke(['status', '--name', 'service'], join(root, 'sqlite'))).maintenance.mode,
    'active',
  );
});
test('invalid timeouts and acknowledgement contents refuse before opening a missing store', async () => {
  const emptyIds = join(root, 'empty-ids.json');
  await writeFile(emptyIds, '[]');
  for (const args of [
    ['wait', '--generation', '1', '--timeout', '-1'],
    ['wait', '--generation', '1', '--timeout', '2147483648'],
    ['acknowledge', '--generation', '1', '--ids-file', emptyIds, '--reason', 'reviewed'],
    [
      'acknowledge',
      '--generation',
      '1',
      '--ids-file',
      join(root, 'ids.json'),
      '--reason',
      'x'.repeat(4097),
    ],
  ]) {
    assert.equal((await invoke([...args, '--store', join(root, 'never-created')])).code, 5);
  }
  await assert.rejects(access(join(root, 'never-created')));
});
test('malformed JSON never echoes input contents in diagnostics', async () => {
  const file = join(root, 'malformed.json');
  await writeFile(file, '{"token":REVIEW_SECRET}');
  const cwd = join(root, 'malformed-project');
  await mkdir(cwd);
  await writeFile(join(cwd, 'semaphile.json'), '{"token":REVIEW_SECRET}');
  for (const args of [
    [
      'status',
      '--redis-url-env',
      'SEMAPHILE_CLI_TEST_REDIS',
      '--pool',
      'unused',
      '--pool-config',
      file,
    ],
    [
      'acknowledge',
      '--generation',
      '1',
      '--ids-file',
      file,
      '--reason',
      'reviewed',
      '--store',
      'missing',
    ],
    ['status', '--name', 'service'],
  ]) {
    const result = await invoke(args, cwd);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.err, /REVIEW_SECRET/);
  }
});
test('SIGTERM during blocked startup terminates the CLI and preserves the gate owner', async () => {
  const path = join(root, 'signal-startup');
  await (await sqlite({ path, config })).close();
  const owner = spawn(
    process.execPath,
    [
      '--no-warnings',
      resolve('conformance/typescript/gate-owner.mjs'),
      nativePath(),
      join(path, 'coordination.lock'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const ownerExit = once(owner, 'exit');
  await once(owner.stdout, 'data');
  const child = spawn(
    process.execPath,
    ['--no-warnings', script, 'pool', 'status', '--store', path],
    { stdio: 'ignore' },
  );
  const exit = once(child, 'exit');
  try {
    await delay(300);
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      const [code, signal] = await exit;
      assert.equal(code, null);
      assert.equal(signal, 'SIGTERM');
    } finally {
      clearTimeout(timer);
    }
    assert.equal(owner.exitCode, null);
    assert.equal(owner.signalCode, null);
  } finally {
    owner.stdin.end('x');
    await ownerExit;
    child.kill('SIGKILL');
  }
});
test('Redis acknowledgement preserves uncertainty and stale generations cannot resume', async () => {
  const pool = 'cli-uncertain';
  const owner = new RedisBackend({ url: redis.url, pool, config });
  await owner.open();
  await owner.call('acquire', { weight: 1, expirationMs: null });
  await owner.detach();
  const args = [
    '--redis-url-env',
    'SEMAPHILE_CLI_TEST_REDIS',
    '--pool',
    pool,
    '--pool-config',
    configPath,
  ];
  const status = value(await invoke(['status', ...args]));
  const idsFile = join(root, 'redis-ids.json');
  await writeFile(idsFile, JSON.stringify(Object.keys(status.unconfirmed)));
  assert.equal(Object.keys(status.unconfirmed).length, 1);
  const drain = value(await invoke(['drain', ...args]));
  const generation = String(drain.maintenance.generation);
  assert.notEqual(
    (await invoke(['resume', '--generation', String(Number(generation) + 1), ...args])).code,
    0,
  );
  const receipt = value(
    await invoke([
      'acknowledge',
      '--generation',
      generation,
      '--ids-file',
      idsFile,
      '--reason',
      'Operator reviewed uncertainty',
      ...args,
    ]),
  );
  assert.equal(receipt.maintenance.settled, true);
  assert.equal(receipt.maintenance.clean, false);
  value(await invoke(['resume', '--generation', generation, ...args]));
});
for (const backend of ['sqlite', 'redis']) {
  test(`${backend}: post-open signal cancels wait, closes its owner and preserves producers`, async () => {
    const path = join(root, 'signal-' + backend),
      pool = 'signal-pool';
    const limiter =
      backend === 'sqlite'
        ? await sqlite({ path, config })
        : await redisLimiter({ url: redis.url, pool, config });
    const args =
      backend === 'sqlite'
        ? ['--store', path]
        : [
            '--redis-url-env',
            'SEMAPHILE_CLI_TEST_REDIS',
            '--pool',
            pool,
            '--pool-config',
            configPath,
          ];
    const entered = deferred(),
      finish = deferred();
    const running = limiter.execute(async () => {
      entered.resolve();
      await finish.promise;
      return 'producer-finished';
    });
    await entered.promise;
    const drain = await limiter.maintenance.drain();
    const child = spawn(
      process.execPath,
      [
        '--no-warnings',
        '--import',
        resolve('conformance/messaging/pool-signal-ready.mjs'),
        script,
        'pool',
        'wait',
        '--generation',
        String(drain.maintenance.generation),
        ...args,
      ],
      {
        env: { ...process.env, SEMAPHILE_CLI_TEST_REDIS: redis.url },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const exit = once(child, 'exit');
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      await once(child.stdout, 'data');
      child.kill('SIGTERM');
      const [code] = await exit;
      assert.equal(code, 3, errors);
      assert.equal((await limiter.maintenance.status()).maintenance.mode, 'draining');
      assert.equal((await limiter.inspect()).active, 1);
      if (backend === 'sqlite') {
        const db = new DatabaseSync(join(path, 'state.sqlite'));
        try {
          assert.equal(db.prepare('SELECT count(*) AS count FROM owners').get().count, 1);
        } finally {
          db.close();
        }
      } else {
        const client = await connect(redis.url);
        try {
          const identity = createHash('sha256')
            .update(JSON.stringify(['semaphile', pool]))
            .digest('hex');
          const stateKey = `semaphile:{${identity}}:state`;
          assert.equal(Object.keys(JSON.parse(await client.get(stateKey)).owners).length, 1);
        } finally {
          await client.quit();
        }
      }
      finish.resolve();
      assert.equal(await running, 'producer-finished');
      assert.equal(
        (
          await limiter.maintenance.wait({
            generation: drain.maintenance.generation,
            timeoutMs: 1000,
          })
        ).maintenance.clean,
        true,
      );
    } finally {
      clearTimeout(timer);
      child.kill('SIGKILL');
      finish.resolve();
      await running;
      await limiter.close();
    }
  });
}
test('configuration drift refuses named, explicit SQLite and Redis administration without mutation', async () => {
  const cwd = join(root, 'drift');
  await mkdir(cwd);
  const path = join(cwd, 'stores', 'pools', 'service');
  const a = await sqlite({ path, config }),
    b = await redisLimiter({ url: redis.url, pool: 'drift-pool', config });
  const wrong = join(cwd, 'wrong.json');
  await writeFile(wrong, JSON.stringify({ maxConcurrent: 2 }));
  await writeFile(
    join(cwd, 'semaphile.json'),
    JSON.stringify({ version: 1, directory: './stores', pools: { service: { maxConcurrent: 2 } } }),
  );
  const snapshots = await Promise.all([a.maintenance.status(), b.maintenance.status()]);
  const budgets = await Promise.all([a.currentReservoir(), b.currentReservoir()]);
  const redisArgs = ['--redis-url-env', 'SEMAPHILE_CLI_TEST_REDIS', '--pool', 'drift-pool'];
  try {
    for (const args of [
      ['--name', 'service'],
      ['--store', path, '--pool-config', wrong],
      [...redisArgs, '--pool-config', wrong],
      [...redisArgs, '--pool-config', configPath, '--owner-timeout', '4000'],
    ]) {
      const result = await invoke(['drain', ...args], cwd);
      assert.notEqual(result.code, 0, result.out);
    }
    const after = await Promise.all([a.maintenance.status(), b.maintenance.status()]);
    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].fingerprint, snapshots[i].fingerprint);
      assert.deepEqual(after[i].maintenance, snapshots[i].maintenance);
    }
    assert.deepEqual(await Promise.all([a.currentReservoir(), b.currentReservoir()]), budgets);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
try {
  await run();
} finally {
  await redis.close();
}
