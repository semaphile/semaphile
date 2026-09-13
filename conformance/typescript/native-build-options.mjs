// Build-only regressions: effective compiler flags must not disappear during
// privacy remapping, and binary diagnostics must not echo contaminated bytes.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { nativeRustFlags } from '../../packages/core/native-build.mjs';
import { assertNoBuildHomePaths } from '../../packages/core/native-artifact.mjs';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
await mkdir('.tmp/native-build-options', { recursive: true });
const root = resolve(await mkdtemp('.tmp/native-build-options/run-'));
const cwd = process.cwd(),
  saved = { ...process.env };
function scenario(name, task) {
  test(name, async () => {
    const directory = await mkdtemp(join(root, 'case-'));
    for (const key of Object.keys(process.env)) {
      if (/^(?:RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_(?:BUILD|TARGET_.+)_RUSTFLAGS)$/.test(key)) {
        delete process.env[key];
      }
    }
    process.env.CARGO_HOME = join(directory, 'cargo-home');
    process.chdir(directory);
    try {
      await task(directory);
    } finally {
      process.chdir(cwd);
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) {
          delete process.env[key];
        }
      }
      Object.assign(process.env, saved);
    }
  });
}
scenario(
  'explicit RUSTFLAGS preserve compiler options and override lower-priority settings',
  async () => {
    process.env.CARGO_BUILD_RUSTFLAGS = '--cfg ignored_by_cargo';
    process.env.RUSTFLAGS = '--cfg build_canary  -C opt-level=2';
    assert.deepEqual(await nativeRustFlags(), ['--cfg', 'build_canary', '-C', 'opt-level=2']);
  },
);
scenario('encoded flags retain embedded spaces and take precedence over RUSTFLAGS', async () => {
  process.env.RUSTFLAGS = '--cfg ignored';
  process.env.CARGO_ENCODED_RUSTFLAGS = '--cfg\x1fbuild_name="example project"';
  assert.deepEqual(await nativeRustFlags(), ['--cfg', 'build_name="example project"']);
});
scenario('build environment flags require explicit selection before compiling', async () => {
  process.env.CARGO_BUILD_RUSTFLAGS = '--cfg build_canary';
  await assert.rejects(nativeRustFlags(), /require explicit selection/);
});
scenario('target environment flags require explicit selection before compiling', async () => {
  process.env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS = '--cfg target_canary';
  await assert.rejects(nativeRustFlags(), /require explicit selection/);
});
scenario('ancestor Cargo config flags cannot be silently replaced', async (directory) => {
  await mkdir(join(directory, '.cargo'));
  await writeFile(
    join(directory, '.cargo/config.toml'),
    '[build]\nrustflags = ["--cfg", "config_canary"]\n',
  );
  await mkdir(join(directory, 'child'));
  process.chdir(join(directory, 'child'));
  await assert.rejects(nativeRustFlags(), /configuration rustflags require explicit selection/);
});
scenario('Cargo home inline quoted flags cannot be silently replaced', async () => {
  await mkdir(process.env.CARGO_HOME);
  await writeFile(
    join(process.env.CARGO_HOME, 'config'),
    'build = { "rustflags" = ["--cfg", "config_canary"] }\n',
  );
  await assert.rejects(nativeRustFlags(), /configuration rustflags require explicit selection/);
});
scenario(
  'escaped Cargo keys require explicit selection instead of bypassing inspection',
  async (directory) => {
    await mkdir(join(directory, '.cargo'));
    await writeFile(
      join(directory, '.cargo/config.toml'),
      '[build]\n"\\u0072ustflags" = ["--cfg", "config_canary"]\n',
    );
    await assert.rejects(nativeRustFlags(), /Unicode escapes require explicit selection/);
  },
);
test('contaminated native bytes reject even with spaces in a synthetic home name', () => {
  for (const prefix of ['Users', 'home']) {
    const bytes = Buffer.from(`binary\0/${prefix}/Example Person/project/source.rs\0suffix`);
    assert.throws(
      () => assertNoBuildHomePaths(bytes),
      (error) => {
        assert.equal(error.message, 'Native artifact contains a build-user home path');
        return true;
      },
    );
  }
});
test('remapped source and Cargo paths pass binary privacy checks', () => {
  assertNoBuildHomePaths(
    Buffer.from('/semaphile/native/src/lib.rs\0/cargo/registry/src/dependency.rs\0'),
  );
});
await run();
