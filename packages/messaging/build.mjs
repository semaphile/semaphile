import { mkdir, mkdtemp, cp, rename, rm, readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBinaryTarget } from '../core/native-artifact.mjs';
import { buildNative, nativeSourceDigest } from '../core/native-build.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
await mkdir(join(repo, '.tmp/messaging-build'), { recursive: true });
const temporary = await mkdtemp(join(repo, '.tmp/messaging-build/run-'));
const require = createRequire(import.meta.url);
let compiler;
try {
  compiler = require.resolve('typescript/bin/tsc');
} catch {
  throw new Error(
    'Build dependencies missing: run npm ci --prefix packages/messaging --ignore-scripts',
  );
}
const compilation = spawnSync(
  process.execPath,
  [compiler, '--project', join(root, 'tsconfig.json'), '--outDir', join(temporary, 'src')],
  { stdio: 'inherit' },
);
if (compilation.error) {
  throw compilation.error;
}
if (compilation.status !== 0) {
  process.exit(compilation.status ?? 1);
}
await buildNative(resolve(root, '../core'), join(temporary, 'native.node'), temporary);
const target = `${process.platform}-${process.arch}`;
assertBinaryTarget(await readFile(join(temporary, 'native.node')), target);
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const manifest = {
  target,
  sourceSha256: await nativeSourceDigest(resolve(root, '../core')),
  binarySha256: await digest(join(temporary, 'native.node')),
};
await mkdir(join(root, 'dist'), { recursive: true });
await rm(join(root, 'dist/src'), { recursive: true, force: true });
await cp(join(temporary, 'src'), join(root, 'dist/src'), { recursive: true });
await rm(join(root, 'dist/index.d.ts'), { force: true });
await rm(join(root, 'dist/native.node'), { force: true });
await rm(join(root, 'dist/native'), { recursive: true, force: true });
await mkdir(join(root, 'dist/native'));
await rename(join(temporary, 'native.node'), join(root, `dist/native/${target}.node`));
await writeFile(join(root, `dist/native/${target}.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  'Built @semaphile/messaging (strict TypeScript, generated declarations; explicit native build)',
);

await chmod(join(root, 'dist/src/cli.js'), 0o755);
// Bundle the core's pure policy normalizer for observational pool comparison.
await cp(join(root, '../core/dist/src/config.js'), join(root, 'dist/src/pool-config.js'));
await cp(
  join(root, '../core/dist/src/recovery-policy.js'),
  join(root, 'dist/src/recovery-policy.js'),
);
