// Minimal binary structures for parser tests, never executable native addons.
// Real compiler output is verified separately by archive installation tests.
export function elfFixture() {
  const bytes = Buffer.alloc(256);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
  bytes.writeUInt16LE(3, 16); // ET_DYN
  bytes.writeUInt16LE(62, 18); // EM_X86_64
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(64n, 32); // Program table
  bytes.writeBigUInt64LE(120n, 40); // Section table
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(1, 60);
  bytes.writeUInt32LE(1, 64); // PT_LOAD
  bytes.writeBigUInt64LE(184n, 72);
  bytes.writeBigUInt64LE(16n, 96);
  bytes.writeUInt32LE(1, 124); // SHT_PROGBITS
  bytes.writeBigUInt64LE(200n, 144);
  bytes.writeBigUInt64LE(16n, 152);
  return bytes;
}
export function machoFixture() {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  bytes.writeUInt32LE(8, 12); // MH_BUNDLE
  bytes.writeUInt32LE(3, 16);
  bytes.writeUInt32LE(120, 20);
  bytes.writeUInt32LE(0x32, 32); // LC_BUILD_VERSION
  bytes.writeUInt32LE(24, 36);
  bytes.writeUInt32LE(1, 40); // PLATFORM_MACOS
  bytes.writeUInt32LE(0x19, 56); // LC_SEGMENT_64
  bytes.writeUInt32LE(72, 60);
  bytes.writeBigUInt64LE(152n, 96);
  bytes.writeBigUInt64LE(16n, 104);
  bytes.writeUInt32LE(2, 128); // LC_SYMTAB
  bytes.writeUInt32LE(24, 132);
  bytes.writeUInt32LE(168, 136);
  bytes.writeUInt32LE(1, 140);
  bytes.writeUInt32LE(184, 144);
  bytes.writeUInt32LE(8, 148);
  return bytes;
}
