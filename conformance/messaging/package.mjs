import assert from 'node:assert/strict';
import { assertNoBuildHomePaths } from '../../packages/core/native-artifact.mjs';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, cp, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/package-');
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
function command(executable, args, cwd = process.cwd()) {
  const r = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      npm_config_cache: process.env.npm_config_cache ?? resolve('.tmp/npm-cache'),
    },
  });
  assert.equal(
    r.status,
    0,
    `${executable} ${args.join(' ')}\n${r.stdout}\n${r.stderr}\n${r.error ?? ''}`,
  );
  return r.stdout;
}
let passed = 0;
const pass = (label) => {
  console.log('PASS ' + label);
  passed++;
};
const supplied = process.env.SEMAPHILE_MESSAGING_ARCHIVE;
const packed = supplied
  ? null
  : JSON.parse(
      command('npm', [
        'pack',
        './packages/messaging',
        '--offline',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        directory,
      ]),
    )[0];
const archive = supplied ? resolve(supplied) : join(directory, packed.filename);
const files = packed
  ? packed.files.map((f) => f.path)
  : command('tar', ['-tf', archive])
      .trim()
      .split('\n')
      .map((name) => name.replace(/^package\//, ''));
for (const name of [
  'dist/src/index.d.ts',
  'dist/src/cli.js',
  'dist/src/coordinator.js',
  `dist/native/${process.platform}-${process.arch}.node`,
]) {
  assert.ok(files.includes(name), name);
}
assert.ok(!files.includes('dist/src/wait-worker.js'));
assert.ok(!files.some((name) => /\.scratch|node_modules|\.env/.test(name)));
pass('archive includes declarations CLI workers and native target without private files');
const app = join(directory, 'consumer');
await mkdir(app);
const core = JSON.parse(
  command('npm', [
    'pack',
    './packages/core',
    '--offline',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    directory,
  ]),
)[0];
await writeFile(join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
command(
  'npm',
  [
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    archive,
    join(directory, core.filename),
  ],
  app,
);
const manifest = JSON.parse(
  await readFile(join(app, 'node_modules/@semaphile/messaging/package.json'), 'utf8'),
);
assert.equal(manifest.scripts?.install, undefined);
assert.equal(manifest.scripts?.postinstall, undefined);
await access(join(app, 'node_modules/.bin/semaphile'));
for (const file of files.filter((name) => /^dist\/native\/[^/]+\.node$/.test(name))) {
  const binary = await readFile(join(app, 'node_modules/@semaphile/messaging', file));
  assertNoBuildHomePaths(binary);
}
pass('offline installation preserves executable artifacts without install hooks');
// Copy compiler fixture dependencies only. Public API types resolve from the
// installed archives, without source aliases or repository tsconfig inheritance.
await mkdir(join(app, 'node_modules/@types'), { recursive: true });
await cp('packages/core/node_modules/@types/node', join(app, 'node_modules/@types/node'), {
  recursive: true,
});
await cp('packages/core/node_modules/undici-types', join(app, 'node_modules/undici-types'), {
  recursive: true,
});
await copyFile('conformance/messaging/consumer.ts', join(app, 'consumer.ts'));
command(
  process.execPath,
  [
    resolve('packages/messaging/node_modules/typescript/bin/tsc'),
    '--strict',
    '--noEmit',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    'consumer.ts',
  ],
  app,
);
pass('independent strict consumer accepts API and rejects invalid usage');
await writeFile(
  join(app, 'runtime.mjs'),
  `import assert from 'node:assert/strict';
import { openMessaging } from '@semaphile/messaging';
const c=await openMessaging({path:'./store'});await c.createMailbox('a');
const waiting=c.wait('a');await c.send({to:'a',body:'installed'});const d=await waiting;
assert.equal(d.message.body,'installed');assert.equal((await c.ack(d.receipt)).status,'acked');await c.close();
await assert.rejects(import('@semaphile/messaging/dist/src/database.js'),e=>e.code===(process.versions.bun ? 'ERR_MODULE_NOT_FOUND' : 'ERR_PACKAGE_PATH_NOT_EXPORTED'));
`,
);
command(process.execPath, ['--no-warnings', 'runtime.mjs'], app);
pass('installed runtime coordinates native wake and hides private backend exports');
const cli = join(app, 'node_modules/@semaphile/messaging/dist/src/cli.js');
command(process.execPath, ['--no-warnings', cli, 'init'], app);
const result = JSON.parse(command(process.execPath, ['--no-warnings', cli, 'info'], app));
assert.equal(result.stores[0].format, 'semaphile-messaging/1.1');
pass('installed CLI initializes and inspects a messaging-only project');
console.log(`RESULT ${passed}/${passed} passed`);
