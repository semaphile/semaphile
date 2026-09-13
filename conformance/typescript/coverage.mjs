// Collect Node V8 coverage from the application and coordinator workers.
// Bun conformance is separate evidence; this report does not claim JSC coverage.
import { mkdir, mkdtemp, copyFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.versions.bun) {
  throw new Error('Use Node to collect V8 coverage; run Bun conformance separately');
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const archive = process.env.SEMAPHILE_TEST_ARCHIVE
  ? resolve(process.env.SEMAPHILE_TEST_ARCHIVE)
  : undefined;
if (archive) {
  await access(archive);
}
await mkdir(join(repo, '.tmp/coverage'), { recursive: true });
const root = await mkdtemp(join(repo, '.tmp/coverage/run-'));
const raw = join(root, 'v8'),
  reports = join(root, 'reports');
const env = { ...process.env, NODE_V8_COVERAGE: raw };
// Package conformance must pack this run's build, even if a caller supplied an
// older portable archive for the platform-header fixtures.
delete env.SEMAPHILE_TEST_ARCHIVE;
function run(args, environment = env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    env: environment,
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Coverage command failed (${result.status}): ${args.join(' ')}`);
  }
}
console.log(`Coverage runtime=node ${process.version} store=${root}`);
run(['--no-warnings', 'packages/core/build.mjs']);
for (const suite of [
  'artifacts',
  'native-headers',
  'admission',
  'budgets',
  'min-time',
  'test',
  'package',
  'backend-regression',
]) {
  const suiteEnvironment =
    suite === 'native-headers' && archive ? { ...env, SEMAPHILE_TEST_ARCHIVE: archive } : env;
  run(['--no-warnings', `conformance/typescript/${suite}.mjs`], suiteEnvironment);
}
const reportEnvironment = { ...process.env };
delete reportEnvironment.NODE_V8_COVERAGE;
run(
  [
    'packages/core/node_modules/c8/bin/c8.js',
    'report',
    '--temp-directory',
    raw,
    '--reports-dir',
    reports,
    '--reporter=lcov',
    '--reporter=text',
    '--all',
    '--src=packages/core',
    '--include=packages/core/src/**/*.ts',
    '--include=packages/core/dist/src/**/*.js',
    '--include=packages/core/*.mjs',
    '--exclude=**/node_modules/**',
    '--exclude=**/*.d.ts',
    '--exclude-after-remap',
  ],
  reportEnvironment,
);
await copyFile(join(reports, 'lcov.info'), join(repo, '.tmp/coverage/lcov.info'));
console.log(`LCOV: .tmp/coverage/lcov.info (raw evidence: ${root})`);
