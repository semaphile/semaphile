// Shared explicit contributor build. Neither package invokes this at install time.
import { mkdir, mkdtemp, cp, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { assertBinaryTarget, assertNoBuildHomePaths } from './native-artifact.mjs';
import { buildNative, nativeSourceDigest } from './native-build.mjs';

function compileTypescript(root, output, name) {
  const require = createRequire(join(root, 'package.json'));
  let compiler;
  try {
    compiler = require.resolve('typescript/bin/tsc');
  } catch {
    throw new Error(
      `Build dependencies missing: run npm ci --prefix packages/${name} --ignore-scripts`,
    );
  }
  const result = spawnSync(
    process.execPath,
    [compiler, '--project', join(root, 'tsconfig.json'), '--outDir', output],
    { stdio: 'inherit' },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`TypeScript build failed (${result.status ?? result.signal})`);
  }
}

export async function buildNativePackage({ root, name, nativeRoot = root, prepare }) {
  const staging = resolve(root, '../../.tmp', `${name}-build`);
  await mkdir(staging, { recursive: true });
  const temporary = await mkdtemp(join(staging, 'run-'));
  try {
    const source = join(temporary, 'src');
    compileTypescript(root, source, name);
    await buildNative(nativeRoot, join(temporary, 'native.node'), temporary);
    const target = `${process.platform}-${process.arch}`;
    const binary = await readFile(join(temporary, 'native.node'));
    assertBinaryTarget(binary, target);
    assertNoBuildHomePaths(binary);
    const manifest = {
      target,
      sourceSha256: await nativeSourceDigest(nativeRoot),
      binarySha256: createHash('sha256').update(binary).digest('hex'),
    };
    // Finish package-specific staging before replacing any prior output.
    await prepare?.(source);
    await publishOutput(root, temporary, manifest);
    console.log(
      `Built @semaphile/${name} (strict TypeScript, generated declarations; explicit native build)`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function publishOutput(root, temporary, manifest) {
  await mkdir(join(root, 'dist'), { recursive: true });
  await rm(join(root, 'dist/src'), { recursive: true, force: true });
  await cp(join(temporary, 'src'), join(root, 'dist/src'), { recursive: true });
  await rm(join(root, 'dist/index.d.ts'), { force: true });
  await rm(join(root, 'dist/native.node'), { force: true });
  await rm(join(root, 'dist/native'), { recursive: true, force: true });
  await mkdir(join(root, 'dist/native'));
  await rename(join(temporary, 'native.node'), join(root, `dist/native/${manifest.target}.node`));
  await writeFile(
    join(root, `dist/native/${manifest.target}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}
