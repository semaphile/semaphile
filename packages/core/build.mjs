import { mkdir, mkdtemp, cp, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBinaryTarget, assertNoBuildHomePaths } from './native-artifact.mjs';
import { buildNative, nativeSourceDigest } from './native-build.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
await mkdir(join(repo, '.tmp/core-build'), { recursive: true });
const temporary = await mkdtemp(join(repo, '.tmp/core-build/run-'));
try {
  const require = createRequire(import.meta.url);
  let compiler;
  try {
    compiler = require.resolve('typescript/bin/tsc');
  } catch {
    throw new Error(
      'Build dependencies missing: run npm ci --prefix packages/core --ignore-scripts',
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
    throw new Error(`TypeScript build failed (${compilation.status ?? compilation.signal})`);
  }
  await buildNative(root, join(temporary, 'native.node'), temporary);
  const target = `${process.platform}-${process.arch}`;
  const binary = await readFile(join(temporary, 'native.node'));
  assertBinaryTarget(binary, target);
  assertNoBuildHomePaths(binary);
  const digest = async (path) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const manifest = {
    target,
    sourceSha256: await nativeSourceDigest(root),
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
  await writeFile(
    join(root, `dist/native/${target}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    'Built @semaphile/core (strict TypeScript, generated declarations; explicit native build)',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
