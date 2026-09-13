import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleNative } from '../../packages/core/assemble-native.mjs';

await mkdir('.tmp/artifacts', { recursive: true });
const root = await mkdtemp(resolve('.tmp/artifacts/run-'));
const core = join(root, 'core');
await mkdir(core);
for (const path of ['dist', 'native', 'native-build.mjs']) {
  await cp(resolve('packages/core', path), join(core, path), { recursive: true });
}
await writeFile(join(core, 'package.json'), '{"type":"module"}');
const target = `${process.platform}-${process.arch}`;
const manifestName = `${target}.json`;
const binaryName = `${target}.node`;
const original = new Map();
for (const file of await readdir(join(core, 'dist/native'))) {
  original.set(file, await readFile(join(core, 'dist/native', file)));
}
async function unchanged() {
  assert.deepEqual((await readdir(join(core, 'dist/native'))).sort(), [...original.keys()].sort());
  for (const [file, bytes] of original) {
    assert.deepEqual(await readFile(join(core, 'dist/native', file)), bytes);
  }
}
const incoming = join(root, 'incoming');
await mkdir(incoming);
async function fixture(change, bytes = original.get(binaryName)) {
  const manifest = JSON.parse(original.get(manifestName).toString());
  change(manifest);
  await writeFile(join(incoming, manifestName), JSON.stringify(manifest));
  await writeFile(join(incoming, binaryName), bytes);
}
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform} store=${root}`,
);
await fixture((manifest) => {
  manifest.sourceSha256 = '0'.repeat(64);
});
await assert.rejects(assembleNative(core, [incoming]), /Stale native source/);
await unchanged();
console.log('PASS stale native source rejects without modifying built artifacts');
await fixture(() => {}, Buffer.from('corrupt binary'));
await assert.rejects(assembleNative(core, [incoming]), /binary hash mismatch/);
await unchanged();
console.log('PASS corrupt binary rejects without modifying built artifacts');
const different = Buffer.concat([
  original.get(binaryName),
  Buffer.from('different compiler output'),
]);
await fixture((manifest) => {
  manifest.binarySha256 = createHash('sha256').update(different).digest('hex');
}, different);
await assert.rejects(assembleNative(core, [incoming]), /Conflicting native artifacts/);
await unchanged();
console.log('PASS conflicting same-target artifact cannot replace an existing binary');
const mislabeled = Buffer.alloc(target === 'darwin-arm64' ? 120 : 56);
if (target === 'darwin-arm64') {
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(mislabeled);
  mislabeled.writeUInt32LE(1, 20);
  mislabeled.writeBigUInt64LE(64n, 32);
  mislabeled.writeUInt16LE(64, 52);
  mislabeled.writeUInt16LE(56, 54);
  mislabeled.writeUInt16LE(1, 56);
  mislabeled.writeUInt16LE(3, 16);
  mislabeled.writeUInt16LE(62, 18);
} else {
  mislabeled.writeUInt32LE(0xfeedfacf, 0);
  mislabeled.writeUInt32LE(0x0100000c, 4);
  mislabeled.writeUInt32LE(8, 12);
  mislabeled.writeUInt32LE(1, 16);
  mislabeled.writeUInt32LE(24, 20);
  mislabeled.writeUInt32LE(0x32, 32);
  mislabeled.writeUInt32LE(24, 36);
  mislabeled.writeUInt32LE(1, 40);
}
await fixture((manifest) => {
  manifest.binarySha256 = createHash('sha256').update(mislabeled).digest('hex');
}, mislabeled);
await assert.rejects(assembleNative(core, [incoming]), /binary target mismatch/);
await unchanged();
console.log('PASS correctly hashed binary with the wrong target is rejected');
await fixture((manifest) => {
  manifest.target = '../../escape';
});
await assert.rejects(assembleNative(core, [incoming]), /Invalid native target/);
await unchanged();
console.log('PASS invalid target cannot redirect artifact paths');
await fixture(() => {});
const assembled = await assembleNative(core, [incoming]);
assert.ok(assembled.includes(target));
await unchanged();
console.log('PASS repeated identical assembly preserves every artifact byte');
await rename(
  join(core, 'dist/native', binaryName),
  join(core, 'dist/native', binaryName + '.held'),
);
const missing = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import { nativePath } from './dist/src/native-path.js'; nativePath();",
  ],
  { cwd: core, encoding: 'utf8', timeout: 30_000 },
);
if (missing.error) {
  throw missing.error;
}
assert.notEqual(missing.status, 0);
assert.ok(missing.stderr.includes(`Semaphile native artifact missing for ${target}`));
console.log('PASS missing runtime target fails explicitly before worker startup');
console.log('RESULT 7/7 passed');
