// Install actual archives in an independent consumer, then remove every SQLite
// implementation file to prove the optional backend has no native dependency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { server, key } from './harness.mjs';
const repo = resolve('.');
await mkdir('.tmp/redis-package', { recursive: true });
const root = resolve(await mkdtemp('.tmp/redis-package/run-'));
async function run(command, args, cwd = root, env = process.env) {
  return await new Promise((yes, no) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      no(new Error('Consumer timeout: ' + output));
    }, 60000);
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      no(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        yes(output);
      } else {
        no(new Error(`Consumer exit ${code}: ${output}`));
      }
    });
  });
}
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform}`,
);
const archives = [];
for (const name of ['core', 'redis']) {
  let archive = process.env[`SEMAPHILE_${name.toUpperCase()}_ARCHIVE`];
  if (archive) {
    archive = resolve(archive);
  } else {
    const [packed] = JSON.parse(
      await run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
        join(repo, 'packages', name),
      ),
    );
    archive = join(root, packed.filename);
  }
  archives.push(archive);
  console.log(
    `${name}ArchiveSha256=${createHash('sha256')
      .update(await readFile(archive))
      .digest('hex')}`,
  );
}
const consumer = join(root, 'consumer');
await mkdir(consumer);
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify({ name: 'redis-consumer', private: true, type: 'module' }),
);
await run(
  'npm',
  [
    'install',
    '--offline',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    ...archives,
  ],
  consumer,
);
const installed = join(consumer, 'node_modules/@semaphile');
const manifest = JSON.parse(await readFile(join(installed, 'redis/package.json'), 'utf8'));
assert.equal(manifest.dependencies['@semaphile/core'], undefined);
assert.equal(manifest.peerDependencies['@semaphile/core'], '2026.9.2-dev.0');
assert.equal(manifest.scripts.install, undefined);
assert.equal(
  await readFile(join(installed, 'redis/dist/protocol.lua'), 'utf8'),
  await readFile('packages/redis/src/protocol.lua', 'utf8'),
);
console.log('PASS offline archives install with an explicit core peer and no install hooks');
await mkdir(join(consumer, 'node_modules/@types'), { recursive: true });
await cp(
  join(repo, 'packages/core/node_modules/@types/node'),
  join(consumer, 'node_modules/@types/node'),
  { recursive: true },
);
await cp(
  join(repo, 'packages/core/node_modules/undici-types'),
  join(consumer, 'node_modules/undici-types'),
  { recursive: true },
);
await cp('conformance/redis/consumer.ts', join(consumer, 'consumer.ts'));
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmitOnError: true,
      types: ['node'],
      outDir: 'compiled',
    },
    include: ['consumer.ts'],
  }),
);
await run(
  process.execPath,
  [join(repo, 'packages/core/node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
  consumer,
);
console.log('PASS independent strict consumer verifies inference and invalid Redis options');
await rm(join(installed, 'core/dist/native'), { recursive: true, force: true });
for (const file of await readdir(join(installed, 'core/dist/src'))) {
  if (
    !file.startsWith('client.') &&
    !file.startsWith('config.') &&
    !file.startsWith('client-errors.') &&
    !file.startsWith('deadline.') &&
    !file.startsWith('execution.') &&
    !file.startsWith('http.') &&
    !file.startsWith('http-policy.') &&
    !file.startsWith('response-lifetime.') &&
    !file.startsWith('administration.') &&
    !file.startsWith('recovery-policy.') &&
    !file.startsWith('control-state.') &&
    !file.startsWith('maintenance-state.') &&
    !file.startsWith('recovery-state.')
  ) {
    await rm(join(installed, 'core/dist/src', file), { recursive: true, force: true });
  }
}
const redis = await server();
try {
  await run(process.execPath, ['compiled/consumer.js'], consumer, {
    ...process.env,
    REDIS_URL: redis.url,
    POOL: key(),
  });
} finally {
  await redis.close();
}
console.log(
  'PASS installed callbacks share capacity with every SQLite module and native binary removed',
);
console.log('RESULT 3/3 passed');
