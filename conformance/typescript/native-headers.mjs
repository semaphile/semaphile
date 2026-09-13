import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { elfFixture, machoFixture } from './fixtures/native-headers.mjs';
import { binaryTarget } from '../../packages/core/native-artifact.mjs';
import { assembleNative } from '../../packages/core/assemble-native.mjs';
import { nativeSourceDigest } from '../../packages/core/native-build.mjs';

await mkdir('.tmp/native-headers', { recursive: true });
const root = await mkdtemp(resolve('.tmp/native-headers/run-'));
const core = join(root, 'package');
const native = join(core, 'dist/native');
if (process.env.SEMAPHILE_TEST_ARCHIVE) {
  const unpack = spawnSync(
    'tar',
    ['-xf', resolve(process.env.SEMAPHILE_TEST_ARCHIVE), '-C', root],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (unpack.error) {
    throw unpack.error;
  }
  assert.equal(unpack.status, 0, unpack.stderr);
} else {
  // A fresh checkout can exercise all header bounds without a private archive.
  await mkdir(native, { recursive: true });
  const sourceSha256 = await nativeSourceDigest(resolve('packages/core'));
  for (const [target, bytes] of [
    ['linux-x64', elfFixture()],
    ['darwin-arm64', machoFixture()],
  ]) {
    await writeFile(join(native, target + '.node'), bytes);
    await writeFile(
      join(native, target + '.json'),
      JSON.stringify({
        target,
        sourceSha256,
        binarySha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
  }
}
await cp('packages/core/native', join(core, 'native'), { recursive: true });
await cp('packages/core/native-build.mjs', join(core, 'native-build.mjs'));
const linux = await readFile(join(native, 'linux-x64.node'));
const mac = await readFile(join(native, 'darwin-arm64.node'));
console.log(
  `runtime=${process.versions.bun ? 'bun ' + process.versions.bun : 'node ' + process.version} platform=${process.platform} store=${root}`,
);
assert.equal(binaryTarget(linux), 'linux-x64');
assert.equal(binaryTarget(mac), 'darwin-arm64');
console.log(
  `PASS ${process.env.SEMAPHILE_TEST_ARCHIVE ? 'actual build' : 'synthetic fixture'} Linux and macOS headers identify their target`,
);
const incoming = join(root, 'incoming');
await mkdir(incoming);
async function rejected(target, bytes, pattern) {
  const manifest = JSON.parse(await readFile(join(native, target + '.json'), 'utf8'));
  manifest.binarySha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(incoming, target + '.json'), JSON.stringify(manifest));
  await writeFile(join(incoming, target + '.node'), bytes);
  await assert.rejects(assembleNative(core, [incoming]), pattern);
  // Failed verification must preserve both trusted native artifacts.
  assert.deepEqual(await readFile(join(native, 'linux-x64.node')), linux);
  assert.deepEqual(await readFile(join(native, 'darwin-arm64.node')), mac);
  const { unlink } = await import('node:fs/promises');
  await unlink(join(incoming, target + '.json'));
}
let platformOffset;
const commands = new Map();
for (
  let offset = 32, i = 0;
  i < mac.readUInt32LE(16);
  i++, offset += mac.readUInt32LE(offset + 4)
) {
  commands.set(mac.readUInt32LE(offset), offset);
  if (mac.readUInt32LE(offset) === 0x32) {
    platformOffset = offset + 8;
  }
}
assert.notEqual(platformOffset, undefined, 'tested macOS build has LC_BUILD_VERSION');
for (const platform of [2, 7]) {
  const altered = Buffer.from(mac);
  altered.writeUInt32LE(platform, platformOffset);
  await rejected('darwin-arm64', altered, /platform must be macOS/);
}
console.log('PASS same-architecture iOS and simulator artifacts reject despite matching hashes');
await rejected('linux-x64', linux.subarray(0, 32), /Truncated/);
await rejected('linux-x64', linux.subarray(0, 64), /Truncated/);
console.log('PASS truncated ELF header and program table reject despite matching hashes');
await rejected('darwin-arm64', mac.subarray(0, 32), /Truncated/);
await rejected('darwin-arm64', mac.subarray(0, 32 + mac.readUInt32LE(20) - 1), /Truncated/);
console.log('PASS truncated Mach-O command table rejects despite matching hashes');
const outside = Buffer.from(linux);
outside.writeBigUInt64LE(BigInt(linux.length + 1), 32);
await rejected('linux-x64', outside, /Truncated/);
const invalid = Buffer.from(mac);
invalid.writeUInt32LE(0, 36);
await rejected('darwin-arm64', invalid, /load command bounds/);
console.log('PASS out-of-bounds ELF and zero-length Mach-O tables reject');
const symtab = commands.get(2);
assert.notEqual(symtab, undefined, 'tested artifact contains LC_SYMTAB');
for (const field of [8, 16]) {
  const altered = Buffer.from(mac);
  altered.writeUInt32LE(mac.length + 1, symtab + field);
  await rejected('darwin-arm64', altered, /Truncated/);
}
// Keep each starting offset valid: these cases prove that the full extent,
// including 16 bytes per nlist_64 symbol, participates in the bounds check.
const symbolExtent = Buffer.from(mac);
symbolExtent.writeUInt32LE(mac.length - 16, symtab + 8);
symbolExtent.writeUInt32LE(2, symtab + 12);
await rejected('darwin-arm64', symbolExtent, /Truncated/);
symbolExtent.writeUInt32LE(1, symtab + 12);
assert.equal(binaryTarget(symbolExtent), 'darwin-arm64', 'symbol span may end exactly at EOF');
const stringExtent = Buffer.from(mac);
stringExtent.writeUInt32LE(mac.length - 1, symtab + 16);
stringExtent.writeUInt32LE(2, symtab + 20);
await rejected('darwin-arm64', stringExtent, /Truncated/);
stringExtent.writeUInt32LE(1, symtab + 20);
assert.equal(binaryTarget(stringExtent), 'darwin-arm64', 'string span may end exactly at EOF');
console.log('PASS Mach-O symbol and string table spans are bounded');
const program = Number(linux.readBigUInt64LE(32));
const sections = Number(linux.readBigUInt64LE(40));
const elfMutations = [
  (bytes) => bytes.writeBigUInt64LE(BigInt(bytes.length + 1), program + 8),
  (bytes) => bytes.writeBigUInt64LE(BigInt(bytes.length + 1), 40),
  (bytes) => bytes.writeUInt16LE(1, 58),
  (bytes) => bytes.writeBigUInt64LE(BigInt(bytes.length + 1), sections + 24),
  (bytes) => bytes.writeBigUInt64LE(2n ** 63n, 32),
];
for (const change of elfMutations) {
  const altered = Buffer.from(linux);
  change(altered);
  await rejected('linux-x64', altered, /Truncated|Invalid ELF/);
}
console.log('PASS ELF payloads, section tables and unsafe offsets are rejected');
const segment = commands.get(0x19);
assert.notEqual(segment, undefined, 'tested artifact contains LC_SEGMENT_64');
const machMutations = [
  (bytes) => bytes.writeUInt32LE(0xffffffff, 16),
  (bytes) => bytes.writeUInt32LE(0xffffffff, platformOffset + 12),
  (bytes) => bytes.writeUInt32LE(0xffffffff, segment + 64),
  (bytes) => bytes.writeBigUInt64LE(BigInt(bytes.length + 1), segment + 40),
];
for (const change of machMutations) {
  const altered = Buffer.from(mac);
  change(altered);
  await rejected('darwin-arm64', altered, /Truncated|Invalid Mach-O/);
}
console.log('PASS Mach-O command counts, build tools, sections and segment payloads are bounded');
console.log('RESULT 8/8 passed');
