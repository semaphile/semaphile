// Explicit contributor build only. Installed packages load verified prebuilt addons.
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const nativeInputs = [
  'native-build.mjs',
  'native/Cargo.toml',
  'native/Cargo.lock',
  'native/build.rs',
  'native/rust-toolchain.toml',
  'native/src/lib.rs',
  'native/os/Cargo.toml',
  'native/os/src/lib.rs',
  'native/os/src/linux.rs',
  'native/os/src/macos.rs',
];

export async function nativeSourceDigest(core) {
  const hash = createHash('sha256');
  for (const path of [...nativeInputs].sort()) {
    const bytes = await readFile(join(core, path));
    hash.update(`${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

// Encoding our remaps takes precedence over Cargo's config-file rustflags.
// Refuse lower-priority sources unless the caller explicitly selects env flags.
export async function nativeRustFlags() {
  if (process.env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    return process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean);
  }
  if (process.env.RUSTFLAGS !== undefined) {
    return process.env.RUSTFLAGS.split(/\s+/).filter(Boolean);
  }
  const guidance =
    'Set RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS explicitly to preserve the required flags';
  if (Object.keys(process.env).some((key) => /^CARGO_(?:BUILD|TARGET_.+)_RUSTFLAGS$/.test(key))) {
    throw new Error(`Cargo build/target rustflags require explicit selection. ${guidance}`);
  }
  const directories = new Set([resolve(process.env.CARGO_HOME ?? join(homedir(), '.cargo'))]);
  for (let directory = process.cwd(); ; directory = dirname(directory)) {
    directories.add(join(directory, '.cargo'));
    if (dirname(directory) === directory) {
      break;
    }
  }
  for (const directory of directories) {
    await checkCargoConfig(directory, guidance);
  }
  return [];
}

async function checkCargoConfig(directory, guidance) {
  for (const name of ['config', 'config.toml']) {
    let text;
    try {
      text = await readFile(join(directory, name), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    // Full-line comments cannot contain effective keys. Scan one line at a time
    // so long runs of whitespace cannot cause multiline regex backtracking.
    const config = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    if (/\\[uU]/.test(config)) {
      throw new Error(
        `Cargo configuration Unicode escapes require explicit selection. ${guidance}`,
      );
    }
    if (/\brustflags["']?\s*=/.test(config)) {
      throw new Error(`Cargo configuration rustflags require explicit selection. ${guidance}`);
    }
  }
}

export async function buildNative(core, output, temporary) {
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error('Only macOS and Linux supported');
  }
  const target = resolve(
    process.env.CARGO_TARGET_DIR ?? join(core, '../../.tmp/rust-build-target'),
  );
  await mkdir(target, { recursive: true });
  // Panic locations and dependency paths are embedded even in release binaries.
  // Keep caller flags, then remap build roots to stable, non-personal prefixes.
  const inherited = await nativeRustFlags();
  const roots = [
    [homedir(), '/build-home'],
    [resolve(core, '../..'), '/semaphile'],
    [resolve(process.env.CARGO_HOME ?? join(homedir(), '.cargo')), '/cargo'],
  ];
  const rustflags = [
    ...inherited,
    ...roots.map(([from, to]) => `--remap-path-prefix=${from}=${to}`),
  ].join('\x1f');
  const build = spawnSync(
    'cargo',
    [
      '+1.93.1',
      'build',
      '--release',
      '--locked',
      '--offline',
      '--manifest-path',
      join(core, 'native/Cargo.toml'),
    ],
    {
      env: {
        ...process.env,
        CARGO_TARGET_DIR: target,
        CARGO_ENCODED_RUSTFLAGS: rustflags,
        TMPDIR: temporary,
      },
      stdio: 'inherit',
    },
  );
  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    throw new Error(`Rust native build failed (${build.status ?? build.signal})`);
  }
  const extension = process.platform === 'darwin' ? 'dylib' : 'so';
  await copyFile(join(target, 'release', `libsemaphile_native.${extension}`), output);
}
