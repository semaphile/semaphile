// Controller-side staging, run unprivileged before the administrator step.
// It exports the harness at a commit, copies and verifies the candidate
// archives, fetches the pinned runtimes and verifies their checksums, builds
// an offline npm cache from the local cache by integrity, installs the
// consumer offline (macOS; Linux installs inside the container) and writes
// the listing whose SHA-256 the owner verifies before setup copies it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ARCHIVES, CANDIDATE, RUNTIMES } from './lib/layout.mjs';
import { installedCandidateCheck } from './lib/checks.mjs';

// Official archives and the SHA-256 published in each release's SHASUMS256.txt.
const DOWNLOADS = {
  darwin: {
    node: {
      url: 'https://nodejs.org/dist/v22.21.1/node-v22.21.1-darwin-arm64.tar.gz',
      sha256: 'c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af',
    },
    bun: {
      url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-darwin-aarch64.zip',
      sha256: '90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f',
      member: 'bun-darwin-aarch64/bun',
    },
  },
  linux: {
    node: {
      url: 'https://nodejs.org/dist/v22.23.0/node-v22.23.0-linux-x64.tar.gz',
      sha256: '535eeb608ca1e0b71d49a0e36991d449d5f935fbb04eca61677519b010cd673a',
    },
    bun: {
      url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip',
      sha256: '36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913',
      member: 'bun-linux-x64/bun',
    },
  },
};

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    commit: { type: 'string' },
    out: { type: 'string' },
    candidates: { type: 'string' },
    downloads: { type: 'string' },
    'npm-cache': { type: 'string', default: join(process.env.HOME, '.npm', '_cacache') },
  },
});
const platform = values.platform;
assert.ok(DOWNLOADS[platform], '--platform darwin|linux');
assert.match(values.commit ?? '', /^[0-9a-f]{40}$/, '--commit FULL_SHA');
const out = resolve(values.out);
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: 'utf8',
}).trim();
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
const sha256 = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: ['ignore', 'pipe', 'inherit'], ...options });

await mkdir(out, { recursive: false });
const tree = join(out, 'tree');
const checkout = join(tree, 'checkout');
await mkdir(checkout, { recursive: true });

// 1. The harness exactly as committed.
const harnessTree = git('rev-parse', `${values.commit}:conformance/accounts`).trim();
execFileSync('/bin/sh', [
  '-c',
  `git -C "$1" archive --format=tar "$2" conformance/accounts | tar -x -C "$3"`,
  'sh',
  repo,
  values.commit,
  checkout,
]);
const harness = join(checkout, 'conformance/accounts');
await mkdir(join(tree, 'bin'));
await copyFile(join(harness, 'bin/sem3-participant'), join(tree, 'bin/sem3-participant'));
await chmod(join(tree, 'bin/sem3-participant'), 0o755);

// 2. Candidate pins regenerate identically from the candidate's own locks.
const pins = {};
for (const name of ['redis', 'messaging', 'otel']) {
  const lock = JSON.parse(git('show', `${CANDIDATE}:packages/${name}/package-lock.json`));
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (
      !key.startsWith('node_modules/') ||
      entry.dev ||
      entry.link ||
      key.startsWith('node_modules/@semaphile/')
    ) {
      continue;
    }
    const pin = { version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
    assert.ok(
      !pins[key] || JSON.stringify(pins[key]) === JSON.stringify(pin),
      `conflicting pin ${key}`,
    );
    pins[key] = pin;
  }
}
const committedPins = JSON.parse(await readFile(join(harness, 'candidate-pins.json'), 'utf8'));
assert.equal(committedPins.candidate, CANDIDATE);
assert.deepEqual(Object.keys(committedPins.packages).toSorted(), Object.keys(pins).toSorted());
for (const [key, pin] of Object.entries(pins)) {
  const { lockfiles: _lockfiles, ...committed } = committedPins.packages[key];
  assert.deepEqual(committed, pin, `committed pin ${key} differs from the candidate lock`);
}
const consumerLock = JSON.parse(await readFile(join(harness, 'package-lock.json'), 'utf8'));
const thirdParty = Object.entries(consumerLock.packages).filter(
  ([key]) => key.startsWith('node_modules/') && !key.startsWith('node_modules/@semaphile/'),
);
assert.equal(
  thirdParty.length,
  Object.keys(pins).length,
  'consumer lock and candidate pins differ in coverage',
);
for (const [key, entry] of thirdParty) {
  const pin = pins[key];
  assert.ok(
    pin &&
      pin.version === entry.version &&
      pin.resolved === entry.resolved &&
      pin.integrity === entry.integrity,
    `${key} unpinned`,
  );
}

// 3. The exact candidate archives, hashed before and after the copy.
const archiveDir = join(checkout, `releases/candidates/redis-messaging/0.3.0/${CANDIDATE}`);
await mkdir(archiveDir, { recursive: true });
const archives = {};
for (const [name, expected] of Object.entries(ARCHIVES)) {
  const file = `semaphile-${name}-0.3.0.tgz`;
  const before = await sha256(join(values.candidates, file));
  assert.equal(before, expected, `${file} source hash`);
  await copyFile(join(values.candidates, file), join(archiveDir, file));
  const after = await sha256(join(archiveDir, file));
  assert.equal(after, expected, `${file} staged hash`);
  archives[name] = { file, before, after };
}
await copyFile(join(values.candidates, 'SHA256SUMS'), join(archiveDir, 'SHA256SUMS'));
run('/bin/sh', ['-c', 'cd "$1" && shasum -a 256 -c SHA256SUMS', 'sh', archiveDir]);

// 4. Pinned runtimes.
await mkdir(values.downloads, { recursive: true });
const runtimes = {};
for (const [name, pin] of Object.entries(DOWNLOADS[platform])) {
  const file = join(values.downloads, pin.url.split('/').pop());
  let present = false;
  try {
    present = (await stat(file)).isFile();
  } catch {
    present = false;
  }
  if (!present) {
    const response = await fetch(pin.url, { redirect: 'follow' });
    assert.equal(response.status, 200, `download ${pin.url}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  }
  assert.equal(await sha256(file), pin.sha256, `${file} does not match its pinned checksum`);
  const target = join(tree, 'runtime', name);
  await mkdir(target, { recursive: true });
  if (name === 'node') {
    run('/usr/bin/tar', ['-xzf', file, '-C', target, '--strip-components', '1']);
  } else {
    await writeFile(
      join(target, 'bun'),
      run('/usr/bin/unzip', ['-p', file, pin.member], { maxBuffer: 1 << 28 }),
    );
    await chmod(join(target, 'bun'), 0o755);
  }
  const binary = name === 'node' ? join(target, 'bin/node') : join(target, 'bun');
  runtimes[name] = {
    version: RUNTIMES[platform][name],
    url: pin.url,
    archiveSha256: pin.sha256,
    binarySha256: await sha256(binary),
  };
}

// 5. Offline npm cache: exactly the pinned tarballs, each copied with its
// own request-cache index entry and verified against the locked integrity.
const npmCache = join(out, 'npm-cache');
const cacache = createRequire(join(tree, 'runtime/node/lib/node_modules/npm/package.json'))(
  'cacache',
);
for (const [key, entry] of thirdParty) {
  const cacheKey = `make-fetch-happen:request-cache:${entry.resolved}`;
  const info = await cacache.get.info(values['npm-cache'], cacheKey);
  assert.ok(info, `${key} is not in the local npm cache; acquisition belongs to the bootstrap`);
  const data = await cacache.get.byDigest(values['npm-cache'], entry.integrity);
  await cacache.put(npmCache, cacheKey, data, {
    integrity: entry.integrity,
    metadata: info.metadata,
  });
  await write('npm-cache.jsonl', { key, integrity: entry.integrity, bytes: data.length });
}
async function write(file, value) {
  await writeFile(join(out, file), JSON.stringify(value) + '\n', { flag: 'a' });
}

// 6. macOS installs here with the staged runtime's own npm, offline.
let installed = 'performed inside the container';
if (platform === 'darwin') {
  const npmHome = join(out, 'npm-home');
  await mkdir(npmHome);
  const userConfig = join(npmHome, 'user.npmrc');
  const globalConfig = join(npmHome, 'global.npmrc');
  await writeFile(userConfig, '');
  await writeFile(globalConfig, '');
  run(
    join(tree, 'runtime/node/bin/node'),
    [
      join(tree, 'runtime/node/lib/node_modules/npm/bin/npm-cli.js'),
      'ci',
      '--offline',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--cache',
      npmCache,
      '--logs-max=0',
    ],
    {
      cwd: harness,
      env: {
        PATH: `${join(tree, 'runtime/node/bin')}:/usr/bin:/bin`,
        HOME: npmHome,
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
        npm_config_update_notifier: 'false',
      },
      stdio: 'inherit',
    },
  );
  const check = await installedCandidateCheck({ prefix: tree });
  assert.equal(check.status, 'PASS', JSON.stringify(check.problems));
  installed = check;
}

const source = {
  commit: values.commit,
  harnessTree,
  candidate: CANDIDATE,
  platform,
  archives,
  runtimes,
  stagedAt: new Date().toISOString(),
};
await writeFile(join(checkout, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
const listingScript =
  platform === 'darwin'
    ? ['macos/admin.sh', 'listing', '--staging', out]
    : ['linux/container.sh', 'listing', '--tree', tree];
const listing = run('/bin/sh', [join(harness, listingScript[0]), ...listingScript.slice(1)], {
  maxBuffer: 1 << 28,
});
await writeFile(join(out, 'STAGED-FILES.txt'), listing);
const result = {
  ...source,
  installed,
  files: listing.toString().split('\n').filter(Boolean).length,
  listingSha256: await sha256(join(out, 'STAGED-FILES.txt')),
};
if (platform === 'linux') {
  run(
    '/usr/bin/tar',
    [
      '--no-mac-metadata',
      '-czf',
      join(out, 'bundle.tgz'),
      '-C',
      out,
      'STAGED-FILES.txt',
      'tree',
      'npm-cache',
    ],
    { env: { COPYFILE_DISABLE: '1', PATH: '/usr/bin:/bin' } },
  );
  result.bundleSha256 = await sha256(join(out, 'bundle.tgz'));
}
await writeFile(join(out, 'stage.json'), JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    listingSha256: result.listingSha256,
    bundleSha256: result.bundleSha256,
    files: result.files,
  }),
);
