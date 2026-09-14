import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, cp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
await mkdir('.tmp/otel', { recursive: true });
const root = await mkdtemp(resolve('.tmp/otel/package-'));
const env = {
  ...process.env,
  npm_config_offline: 'true',
  npm_config_ignore_scripts: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
};
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const archives = [];
for (const name of ['core', 'redis', 'otel', 'messaging']) {
  const supplied = process.env[`SEMAPHILE_${name.toUpperCase()}_ARCHIVE`];
  const archive = supplied && resolve(supplied);
  const [pack] = archive
    ? [
        {
          filename: archive,
          files: run('tar', ['-tf', archive])
            .trim()
            .split('\n')
            .map((path) => ({ path: path.replace(/^package\//, '') })),
        },
      ]
    : JSON.parse(
        run(
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
          resolve('packages', name),
        ),
      );
  archives.push(archive ?? join(root, pack.filename));
  if (name === 'otel') {
    for (const path of [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/types.d.ts',
      'dist/sdk.js',
      'dist/collector.js',
      'dist/cli.js',
      'dist/messaging.js',
      'dist/messaging.d.ts',
    ]) {
      assert(pack.files.some((file) => file.path === path));
    }
  }
}
// Supply every dependency archive explicitly: npm ci caches tarballs without
// necessarily caching registry metadata needed by a fresh offline consumer.
const dependencies = new Map();
async function gather(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const require = createRequire(join(directory, 'package.json'));
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...(manifest.name === '@semaphile/otel' ? { '@opentelemetry/api': '*' } : {}),
  })) {
    if (name.startsWith('@semaphile/') || dependencies.has(name)) {
      continue;
    }
    let target = dirname(require.resolve(name));
    for (;;) {
      try {
        if (JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).name === name) {
          break;
        }
      } catch {}
      const parent = dirname(target);
      assert.notEqual(parent, target, `Cannot locate installed dependency ${name}`);
      target = parent;
    }
    dependencies.set(name, target);
    await gather(target);
  }
}
await gather(resolve('packages/otel'));
await gather(resolve('packages/redis'));
for (const directory of dependencies.values()) {
  const [pack] = JSON.parse(
    run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], directory),
  );
  archives.push(join(root, pack.filename));
}
await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run('npm', ['install', '--offline', '--omit=dev', '--ignore-scripts', ...archives]);
await mkdir(join(root, 'node_modules/@types'), { recursive: true });
for (const name of ['@types/node', 'undici-types']) {
  await cp(resolve('packages/core/node_modules', name), join(root, 'node_modules', name), {
    recursive: true,
  });
}
await writeFile(
  join(root, 'consumer.ts'),
  `
import { createInstrumentation } from '@semaphile/otel';
import { createMessagingInstrumentation } from '@semaphile/otel/messaging';
import type { MessageTelemetryOptions } from '@semaphile/messaging';
const messageTelemetry: MessageTelemetryOptions = { instrumentation: createMessagingInstrumentation() };
void messageTelemetry;
import type { TelemetryOptions } from '@semaphile/core/client';
import { startTelemetry } from '@semaphile/otel/sdk';
import { startCollector } from '@semaphile/otel/collector';
const telemetry: TelemetryOptions = { instrumentation: createInstrumentation() };
void telemetry; void startTelemetry; void startCollector;
`,
);
run(process.execPath, [
  resolve('packages/core/node_modules/typescript/bin/tsc'),
  '--strict',
  '--noEmit',
  '--module',
  'NodeNext',
  '--target',
  'ES2022',
  'consumer.ts',
]);
console.log(
  'PASS offline installed adapter declarations agree with core and load without SDK startup',
);
await writeFile(
  join(root, 'runtime.mjs'),
  `
import assert from 'node:assert/strict';
import { openLimiter } from '@semaphile/core';
import { createInstrumentation } from '@semaphile/otel';
import { startCollector } from '@semaphile/otel/collector';
import { mkdir } from 'node:fs/promises';
await mkdir('pools');
const limiter = await openLimiter({ path: 'pools/api', config: { maxConcurrent: 1 }, telemetry: { instrumentation: createInstrumentation() } });
const collector = await startCollector({ sources: [{ name: 'local', backend: 'sqlite', directory: 'pools' }], port: 0 });
try { assert.equal(await limiter.schedule(() => 42), 42); assert(collector.health().healthy); }
finally { await collector.close(); await limiter.close(); }
`,
);
run(process.execPath, ['--no-warnings', 'runtime.mjs']);
const help = run(process.execPath, [
  'node_modules/@semaphile/messaging/dist/src/cli.js',
  'telemetry',
  'collect',
  '--help',
]);
assert(help.includes('--allow-overlap'));
console.log('PASS installed collector resolves native worker artifacts and messaging CLI addon');
console.log('RESULT 2/2 passed');
