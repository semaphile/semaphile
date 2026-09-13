import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
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
  const [pack] = JSON.parse(
    run(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
      resolve('packages', name),
    ),
  );
  archives.push(join(root, pack.filename));
  if (name === 'otel') {
    for (const path of [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/types.d.ts',
      'dist/sdk.js',
      'dist/collector.js',
      'dist/cli.js',
    ]) {
      assert(pack.files.some((file) => file.path === path));
    }
  }
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
