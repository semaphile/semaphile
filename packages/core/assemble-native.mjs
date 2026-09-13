import { readFile, readdir, mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBinaryTarget } from './native-artifact.mjs';
import { nativeSourceDigest } from './native-build.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const targets = new Set(['darwin-arm64', 'linux-x64']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readArtifact(directory, name, sourceSha256) {
  const manifest = JSON.parse(await readFile(join(directory, name), 'utf8'));
  if (!targets.has(manifest.target) || name !== `${manifest.target}.json`) {
    throw new Error(`Invalid native target manifest: ${name}`);
  }
  if (manifest.sourceSha256 !== sourceSha256) {
    throw new Error(`Stale native source for ${manifest.target}`);
  }
  const binary = await readFile(join(directory, `${manifest.target}.node`));
  if (sha256(binary) !== manifest.binarySha256) {
    throw new Error(`Native binary hash mismatch for ${manifest.target}`);
  }
  assertBinaryTarget(binary, manifest.target);
  return { manifest, binary };
}

// Explicit build tooling, never invoked by installation or the runtime.
export async function assembleNative(core, directories) {
  const sourceSha256 = await nativeSourceDigest(core);
  const artifacts = new Map();
  for (const directory of [join(core, 'dist/native'), ...directories]) {
    const manifests = (await readdir(directory)).filter((name) => name.endsWith('.json'));
    if (manifests.length === 0) {
      throw new Error(`No native manifests in ${directory}`);
    }
    for (const name of manifests) {
      const artifact = await readArtifact(directory, name, sourceSha256);
      const prior = artifacts.get(artifact.manifest.target);
      if (prior && prior.manifest.binarySha256 !== artifact.manifest.binarySha256) {
        throw new Error(`Conflicting native artifacts for ${artifact.manifest.target}`);
      }
      artifacts.set(artifact.manifest.target, artifact);
    }
  }
  // Validate every input before modifying the built package.
  await mkdir(join(core, 'dist'), { recursive: true });
  const staging = await mkdtemp(join(core, 'dist/.native-'));
  try {
    for (const [target, { manifest, binary }] of artifacts) {
      await writeFile(join(staging, `${target}.node`), binary);
      await writeFile(join(staging, `${target}.json`), JSON.stringify(manifest, null, 2) + '\n');
    }
    await rm(join(core, 'dist/native'), { recursive: true });
    await rename(staging, join(core, 'dist/native'));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return [...artifacts.keys()].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    `Assembled native targets: ${(await assembleNative(root, process.argv.slice(2))).join(', ')}`,
  );
}
