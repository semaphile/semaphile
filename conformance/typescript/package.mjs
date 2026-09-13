import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, cp, symlink, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release } from 'node:os';
import {
  assertBinaryTarget,
  assertNoBuildHomePaths,
} from '../../packages/core/native-artifact.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const core = join(repo, 'packages/core');
const tsc = join(core, 'node_modules/typescript/bin/tsc');
await mkdir(join(repo, '.tmp/typescript-package'), { recursive: true });
const root = await mkdtemp(join(repo, '.tmp/typescript-package/run-'));
const cache = join(root, 'npm-cache');
const env = {
  ...process.env,
  npm_config_cache: cache,
  npm_config_offline: 'true',
  npm_config_ignore_scripts: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
};
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30_000 });
  if (result.error) {
    throw result.error;
  }
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
async function hashes(directory) {
  const result = {};
  for (const name of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (name.isFile()) {
      const path = join(name.parentPath, name.name);
      result[path.slice(directory.length + 1)] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    }
  }
  return result;
}
console.log(
  `platform=${platform()} release=${release()} node=${process.version} uid=${process.getuid?.()}`,
);
console.log(`store=${root}`);
assert.notEqual(process.getuid?.(), 0, 'ordinary-user conformance only');

const suppliedArchive =
  process.env.SEMAPHILE_TEST_ARCHIVE && resolve(process.env.SEMAPHILE_TEST_ARCHIVE);
const [packed] = suppliedArchive
  ? [
      {
        filename: suppliedArchive,
        files: run('tar', ['-tf', suppliedArchive])
          .trim()
          .split('\n')
          .map((path) => ({ path: path.replace(/^package\//, '') }))
          .filter((file) => !file.path.endsWith('/')),
      },
    ]
  : JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], core),
    );
const archive = suppliedArchive ?? join(root, packed.filename);
console.log(
  `archiveSha256=${createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')}`,
);
const files = packed.files.map((file) => file.path);
for (const name of ['index', 'coordinator', 'backend', 'wake', 'native-path']) {
  assert.ok(files.includes(`dist/src/${name}.js`), name);
}
assert.ok(files.includes(`dist/native/${process.platform}-${process.arch}.node`));
assert.ok(files.includes(`dist/native/${process.platform}-${process.arch}.json`));
assert.ok(!files.includes('dist/native.node'));
assert.ok(!files.includes('dist/src/wait-worker.js'));
assert.ok(files.includes('dist/src/index.d.ts'));
assert.ok(!files.includes('dist/index.d.ts'), 'no old handwritten declaration');
assert.ok(
  files.every(
    (file) => file.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(file),
  ),
  'no source/toolchain in archive',
);
console.log('PASS package archive includes generated declarations and runtime workers');

const consumer = join(root, 'consumer');
await mkdir(consumer);
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify({ name: 'semaphile-consumer-test', private: true, type: 'module' }),
);
run(
  'npm',
  ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', archive],
  consumer,
);
const installed = join(consumer, 'node_modules/@semaphile/core');
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, 'no runtime dependencies');
assert.equal(manifest.scripts?.install, undefined, 'no native install hook');
assert.deepEqual(
  Object.keys(manifest.exports),
  suppliedArchive && !manifest.exports['./observation']
    ? ['.', './client', './memory']
    : ['.', './client', './memory', './observation'],
);
const installedHashes = await hashes(join(installed, 'dist'));
if (!suppliedArchive) {
  assert.deepEqual(installedHashes, await hashes(join(core, 'dist')));
}
for (const path of files.filter((path) => /^dist\/native\/[^/]+\.json$/.test(path))) {
  const native = JSON.parse(await readFile(join(installed, path), 'utf8'));
  assert.ok(['darwin-arm64', 'linux-x64'].includes(native.target));
  assert.equal(path, `dist/native/${native.target}.json`);
  const binary = await readFile(join(installed, `dist/native/${native.target}.node`));
  assert.equal(createHash('sha256').update(binary).digest('hex'), native.binarySha256);
  assertBinaryTarget(binary, native.target);
  assertNoBuildHomePaths(binary);
}
console.log('PASS offline tarball installation preserves built artifacts without install hooks');

// Independent consumer gets its own Node type definitions; no source alias,
// symlink to the core, or inherited repository tsconfig resolves its API.
await mkdir(join(consumer, 'node_modules/@types'), { recursive: true });
await cp(join(core, 'node_modules/@types/node'), join(consumer, 'node_modules/@types/node'), {
  recursive: true,
});
await cp(join(core, 'node_modules/undici-types'), join(consumer, 'node_modules/undici-types'), {
  recursive: true,
});
await cp(join(repo, 'conformance/typescript/consumer.ts'), join(consumer, 'consumer.ts'));
await writeFile(
  join(consumer, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmitOnError: true,
        types: ['node'],
        outDir: 'compiled',
      },
      include: ['consumer.ts'],
    },
    null,
    2,
  ),
);
run(process.execPath, [tsc, '--project', 'tsconfig.json'], consumer);
console.log('PASS independent strict consumer accepts API types and rejects invalid usage');
process.stdout.write(
  run(
    process.execPath,
    ['--no-warnings', 'compiled/consumer.js', join(consumer, 'pool')],
    consumer,
  ),
);
// Both runtimes enforce exports, but Bun reports a different resolver code.
const privateImportCode = process.versions.bun
  ? 'ERR_MODULE_NOT_FOUND'
  : 'ERR_PACKAGE_PATH_NOT_EXPORTED';
run(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `import assert from 'node:assert/strict'; await assert.rejects(import('@semaphile/core/dist/src/backend.js'), { code: ${JSON.stringify(privateImportCode)} });`,
  ],
  consumer,
);
console.log('PASS private backend cannot be imported through package exports');

const broken = join(root, 'broken-core');
await mkdir(broken);
for (const name of [
  'package.json',
  'tsconfig.json',
  'build.mjs',
  'package-build.mjs',
  'native-artifact.mjs',
  'native-build.mjs',
  'src',
]) {
  await cp(join(core, name), join(broken, name), { recursive: true });
}
await cp(join(installed, 'dist'), join(broken, 'dist'), { recursive: true });
await symlink(join(core, 'node_modules'), join(broken, 'node_modules'), 'dir');
const original = await hashes(join(broken, 'dist'));
await writeFile(
  join(broken, 'src/type-error.ts'),
  'export const invalid: number = "type error fixture";\n',
);
const stagingRoot = resolve(broken, '../../.tmp/core-build');
const beforeStaging = await readdir(stagingRoot).catch((error) => {
  if (error.code === 'ENOENT') {
    return [];
  }
  throw error;
});
const failed = spawnSync(process.execPath, ['build.mjs'], {
  cwd: broken,
  env: { ...env, RUSTC: 'must-not-invoke-native-compiler' },
  encoding: 'utf8',
  timeout: 30_000,
});
if (failed.error) {
  throw failed.error;
}
assert.notEqual(failed.status, 0);
assert.match(failed.stdout + failed.stderr, /TS2322/);
assert.ok(!(failed.stdout + failed.stderr).includes('must-not-invoke-native-compiler'));
assert.deepEqual(
  await hashes(join(broken, 'dist')),
  original,
  'type errors must not replace a previous build',
);
assert.deepEqual((await readdir(stagingRoot)).sort(), beforeStaging.sort());
console.log('PASS type errors fail build before native compilation and preserve existing output');
// A fresh consumer process must resolve the explicit memory entry point without
// any SQLite implementation or native artifacts left in its installed package.
await rm(join(installed, 'dist/native'), { recursive: true, force: true });
for (const file of await readdir(join(installed, 'dist/src'))) {
  if (
    !/^(memory|memory-backend|memory-control|control-state|maintenance-state|recovery-state|client|client-errors|deadline|execution|administration|http|http-policy|response-lifetime|config|recovery-policy)\./.test(
      file,
    )
  ) {
    await rm(join(installed, 'dist/src', file), { recursive: true, force: true });
  }
}
run(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict';
  import { openLimiter } from '@semaphile/core/memory';
  const options = {key:'installed',config:{maxConcurrent:1,reservoir:2}};
  const a = await openLimiter(options), b = await openLimiter(options);
  assert.equal(await a.schedule(()=>42),42);
  assert.equal(await b.currentReservoir(),1);
  await Promise.all([a.close(),b.close()]);
`,
  ],
  consumer,
);
console.log('PASS installed memory entry point runs without SQLite or native artifacts');
console.log('RESULT 7/7 passed');
