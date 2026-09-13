// Build-tool consistency checks, not a substitute for loading a trusted artifact
// on its target host. Bound every header/table read before inspecting it.
function span(bytes, offset, length) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length ||
    length > bytes.length - offset
  ) {
    throw new Error('Truncated or invalid native binary table');
  }
}

function elfTarget(bytes) {
  span(bytes, 0, 64);
  // ELF64, little endian, System V/Linux ABI, shared object, AMD64.
  if (
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1 ||
    ![0, 3].includes(bytes[7]) ||
    bytes.readUInt16LE(16) !== 3 ||
    bytes.readUInt16LE(18) !== 62 ||
    bytes.readUInt32LE(20) !== 1 ||
    bytes.readUInt16LE(52) !== 64
  ) {
    throw new Error('Unsupported ELF target or header');
  }
  const programs = Number(bytes.readBigUInt64LE(32));
  const programSize = bytes.readUInt16LE(54),
    programCount = bytes.readUInt16LE(56);
  if (programSize !== 56 || programCount === 0 || programs < 64) {
    throw new Error('Invalid ELF program table');
  }
  span(bytes, programs, programSize * programCount);
  for (let i = 0; i < programCount; i++) {
    const entry = programs + i * programSize;
    span(
      bytes,
      Number(bytes.readBigUInt64LE(entry + 8)),
      Number(bytes.readBigUInt64LE(entry + 32)),
    );
  }
  const sections = Number(bytes.readBigUInt64LE(40));
  const sectionSize = bytes.readUInt16LE(58),
    sectionCount = bytes.readUInt16LE(60);
  if (sections !== 0 || sectionCount !== 0) {
    if (sectionSize !== 64 || sectionCount === 0 || sections < 64) {
      throw new Error('Invalid ELF section table');
    }
    span(bytes, sections, sectionSize * sectionCount);
    for (let i = 0; i < sectionCount; i++) {
      const entry = sections + i * sectionSize;
      // SHT_NOBITS (.bss) occupies memory but has no payload in the file.
      if (bytes.readUInt32LE(entry + 4) !== 8) {
        span(
          bytes,
          Number(bytes.readBigUInt64LE(entry + 24)),
          Number(bytes.readBigUInt64LE(entry + 32)),
        );
      }
    }
  }
  return 'linux-x64';
}

function machoPlatform(bytes, offset, command, length) {
  if (command === 0x32) {
    // LC_BUILD_VERSION identifies the Apple platform.
    if (length < 24 || bytes.readUInt32LE(offset + 8) !== 1) {
      throw new Error('Mach-O platform must be macOS');
    }
    if (24 + bytes.readUInt32LE(offset + 20) * 8 > length) {
      throw new Error('Truncated Mach-O build tools');
    }
    return true;
  } else if ([0x24, 0x25, 0x2f, 0x30].includes(command)) {
    if (length < 16 || command !== 0x24) {
      throw new Error('Mach-O platform must be macOS');
    }
    return true; // Legacy LC_VERSION_MIN_MACOSX.
  }
  return false;
}

function validateMachoCommand(bytes, offset, command, length) {
  if (machoPlatform(bytes, offset, command, length)) {
    return true;
  }
  if (command === 0x19) {
    // LC_SEGMENT_64 payload and section table.
    if (length < 72) {
      throw new Error('Truncated Mach-O segment');
    }
    if (72 + bytes.readUInt32LE(offset + 64) * 80 > length) {
      throw new Error('Truncated Mach-O section table');
    }
    span(
      bytes,
      Number(bytes.readBigUInt64LE(offset + 40)),
      Number(bytes.readBigUInt64LE(offset + 48)),
    );
  } else if (command === 2) {
    // LC_SYMTAB's nlist_64 and string tables.
    if (length < 24) {
      throw new Error('Truncated Mach-O symbol command');
    }
    span(bytes, bytes.readUInt32LE(offset + 8), bytes.readUInt32LE(offset + 12) * 16);
    span(bytes, bytes.readUInt32LE(offset + 16), bytes.readUInt32LE(offset + 20));
  }
  return false;
}

function machoTarget(bytes) {
  if (bytes.readUInt32LE(4) !== 0x0100000c || ![6, 8].includes(bytes.readUInt32LE(12))) {
    throw new Error('Unsupported Mach-O architecture or file type');
  }
  const count = bytes.readUInt32LE(16),
    size = bytes.readUInt32LE(20);
  span(bytes, 32, size);
  if (count === 0 || count > Math.floor(size / 8)) {
    throw new Error('Invalid Mach-O command count');
  }
  let offset = 32,
    macos = false;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > 32 + size) {
      throw new Error('Truncated Mach-O load command');
    }
    const command = bytes.readUInt32LE(offset),
      length = bytes.readUInt32LE(offset + 4);
    if (length < 8 || length % 8 !== 0 || length > 32 + size - offset) {
      throw new Error('Invalid Mach-O load command bounds');
    }
    // Always validate the command, even after a prior platform command.
    if (validateMachoCommand(bytes, offset, command, length)) {
      macos = true;
    }
    offset += length;
  }
  if (offset !== 32 + size || !macos) {
    throw new Error('Missing or invalid macOS platform commands');
  }
  return 'darwin-arm64';
}

// Read the object headers independently of compiler flags or manifest labels.
export function binaryTarget(bytes) {
  if (bytes.length < 32) {
    throw new Error('Invalid native binary header');
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return elfTarget(bytes);
  } else if (bytes.readUInt32LE(0) === 0xfeedfacf) {
    return machoTarget(bytes);
  }
  throw new Error('Unsupported native binary format or architecture');
}

export function assertBinaryTarget(bytes, expected) {
  const actual = binaryTarget(bytes);
  if (actual !== expected) {
    throw new Error(`Native binary target mismatch: expected ${expected}, found ${actual}`);
  }
}

// Diagnostics contain only the category, never the contaminated binary contents.
export function assertNoBuildHomePaths(binary) {
  if (
    binary
      .toString('latin1')
      .split('\0')
      .some((text) => /\/(?:Users|home)\/[^/]+\//.test(text))
  ) {
    throw new Error('Native artifact contains a build-user home path');
  }
}
