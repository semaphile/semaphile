// Fixture checks, counted separately from the messaging inventory. Denials
// must be real permission errors observed from the denied identity.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  ACCOUNTS,
  ARCHIVES,
  CANDIDATE,
  HANDOFF_GROUP,
  PROFILES,
  RUNTIMES,
  credentialFile,
  configDir,
  paths,
} from './layout.mjs';
import { tarEntries } from './tar.mjs';

const DENIED = new Set(['EACCES', 'EPERM']);
// Bun's transpiler cache is disabled so no runtime cache lands in homes.
const RUNNER_ENV = [
  'BUN_RUNTIME_TRANSPILER_CACHE_PATH',
  'HOME',
  'LANG',
  'LOGNAME',
  'PATH',
  'TMPDIR',
  'USER',
];
// macOS adds these computed memberships to every local account.
const IMPLICIT_GROUPS = { darwin: [12, 61], linux: [] };

export const mappedFiles = (account, prefix) =>
  Object.keys(PROFILES).flatMap((profile) => [
    `${configDir(account, profile, prefix)}/semaphile.json`,
    credentialFile(account, profile, prefix),
  ]);

export function identityProblems(identity, account, runtime, ctx) {
  const problems = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) {
      problems.push(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    }
  };
  const layout = paths(ctx.prefix);
  if (ctx.mode !== 'dev') {
    for (const field of ['uid', 'euid']) {
      expect(field, identity[field], account.uid);
    }
    for (const field of ['gid', 'egid']) {
      expect(field, identity[field], account.gid);
    }
    const allowed = new Set([
      account.gid,
      ...(account.handoff ? [HANDOFF_GROUP.gid] : []),
      ...IMPLICIT_GROUPS[ctx.platform],
    ]);
    for (const group of identity.groups) {
      if (!allowed.has(group)) {
        problems.push(`unexpected supplementary group ${group}`);
      }
    }
    if (account.handoff !== identity.groups.includes(HANDOFF_GROUP.gid)) {
      problems.push('handoff group membership differs from the manifest');
    }
    expect('user', identity.user, account.name);
    const extra = identity.envNames.filter((name) => !RUNNER_ENV.includes(name));
    if (extra.length) {
      problems.push('environment outside the runner allowlist: ' + extra.join(','));
    }
    if (ctx.platform === 'linux') {
      for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
        expect(field, identity.capabilities?.[field], '0000000000000000');
      }
      expect('NoNewPrivs', identity.capabilities?.NoNewPrivs, '1');
    }
  }
  expect('home', identity.home, layout.home(account.name));
  expect('cwd', identity.cwd, ctx.realHome?.[account.name] ?? layout.home(account.name));
  expect('platform', identity.platform, ctx.platform);
  expect('arch', identity.arch, RUNTIMES[ctx.platform].arch);
  expect('runtime', identity.runtime.name, runtime);
  expect('version', identity.runtime.version, RUNTIMES[ctx.platform][runtime]);
  expect('execPath', identity.execPath, ctx.runtimePaths[runtime]);
  for (const [name, path] of Object.entries(identity.modules)) {
    if (typeof path !== 'string' || !path.startsWith(ctx.realModules + '/')) {
      problems.push(
        `module ${name} resolved outside the installed consumer: ${JSON.stringify(path)}`,
      );
    }
  }
  if (identity.tty.controlling === true || identity.tty.stdin) {
    problems.push('participant has a terminal');
  }
  return problems;
}

const allDenied = (results) => results.every((result) => !result.ok && DENIED.has(result.code));

export async function participantChecks(ctx, runtime) {
  const layout = paths(ctx.prefix);
  const records = [];
  const record = (check, account, pass, detail) =>
    records.push({ check, runtime, account: account.name, status: pass ? 'PASS' : 'FAIL', detail });
  const parts = {};
  for (const account of ACCOUNTS) {
    parts[account.role] = ctx.spawn(account.role, runtime);
  }
  try {
    for (const account of ACCOUNTS) {
      const participant = parts[account.role];
      await participant.hello;
      const problems = identityProblems(participant.identity, account, runtime, ctx);
      record('identity', account, problems.length === 0, {
        identity: participant.identity,
        problems,
      });
    }
    for (const reader of ACCOUNTS) {
      const participant = parts[reader.role];
      const own = await participant.ok('read', { paths: mappedFiles(reader.name, ctx.prefix) });
      record('own-inputs', reader, own.length === 38 && own.every((r) => r.ok), {
        files: own.length,
        results: own,
      });
      for (const owner of ACCOUNTS.filter((other) => other !== reader)) {
        const cross = await participant.ok('read', { paths: mappedFiles(owner.name, ctx.prefix) });
        records.push({
          check: 'cross-inputs',
          runtime,
          account: reader.name,
          owner: owner.name,
          status: cross.length === 38 && allDenied(cross) ? 'PASS' : 'FAIL',
          detail: { files: cross.length, codes: [...new Set(cross.map((r) => r.code ?? 'READ'))] },
        });
      }
      const [shared] = await participant.ok('read', { paths: [layout.shared] });
      record(
        'handoff-share',
        reader,
        reader.handoff ? shared.ok : !shared.ok && DENIED.has(shared.code),
        shared,
      );
      const trusted = await participant.ok('read', { paths: ctx.trustedFiles });
      record(
        'trusted-readable',
        reader,
        trusted.every((r) => r.ok),
        { files: trusted.length, failures: trusted.filter((r) => !r.ok) },
      );
      const writes = await participant.ok('write-probe', ctx.writeTargets);
      record('trusted-write-denied', reader, allDenied(writes), {
        attempts: writes.length,
        results: writes,
      });
      const auth = await participant.ok('unauth', { profile: 'd1' });
      record(
        'redis-authentication',
        reader,
        auth.store.error === 'NOAUTH' &&
          auth.authDefault.error === 'WRONGPASS' &&
          auth.named.value === 'PONG',
        auth,
      );
      const serviceReads = await participant.ok('read', { paths: ctx.serviceFiles });
      const serviceLists = await participant.ok('readdir', { paths: ctx.serviceDirectories });
      record('redis-files-denied', reader, allDenied([...serviceReads, ...serviceLists]), {
        results: [...serviceReads, ...serviceLists],
      });
      if (ctx.platform === 'darwin') {
        const homes = await participant.ok('readdir', { paths: ctx.personalHomes });
        record('personal-home-boundary', reader, homes.length > 0 && allDenied(homes), {
          homes: homes.length,
          codes: homes.map((r) => r.code),
        });
      }
      const native = await participant.ok('native');
      record(
        'native-free-import',
        reader,
        native.addons.length === 0 && native.dlopened.length === 0,
        native,
      );
    }
  } finally {
    for (const participant of Object.values(parts)) {
      await participant.close();
    }
  }
  return records;
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
async function walk(root, skip = new Set()) {
  const found = [];
  const visit = async (path) => {
    const info = await lstat(path);
    found.push({ path, info });
    if (info.isDirectory() && !skip.has(path)) {
      for (const name of await readdir(path)) {
        await visit(join(path, name));
      }
    }
  };
  await visit(root);
  return found;
}

// Trusted code for identity switching: root-owned, never group/world-writable.
export async function ownershipCheck(ctx) {
  const layout = paths(ctx.prefix);
  const problems = [];
  const ancestors = [
    '/',
    ...layout.prefix
      .split('/')
      .filter(Boolean)
      .map((_, i, all) => '/' + all.slice(0, i + 1).join('/')),
  ];
  for (const path of ancestors) {
    const info = await lstat(path);
    if (info.uid !== 0 || info.mode & 0o022) {
      problems.push(`${path} uid=${info.uid} mode=${(info.mode & 0o7777).toString(8)}`);
    }
  }
  const skip = new Set([`${layout.prefix}/home`, layout.tmp, `${layout.prefix}/shared`]);
  const entries = await walk(layout.prefix, skip);
  for (const { path, info } of entries) {
    const owned = info.uid === 0 && (info.isSymbolicLink() || (info.mode & 0o022) === 0);
    const special = info.mode & 0o6000;
    if (!owned || special) {
      problems.push(`${path} uid=${info.uid} mode=${(info.mode & 0o7777).toString(8)}`);
    }
  }
  return {
    status: problems.length ? 'FAIL' : 'PASS',
    entries: entries.length,
    problems: problems.slice(0, 50),
  };
}

// Installed Semaphile files equal the exact archive contents; the installed
// tree matches the committed consumer lock and the candidate's pins.
export async function installedCandidateCheck(ctx) {
  const layout = paths(ctx.prefix);
  const problems = [];
  const archives = {};
  for (const [name, expected] of Object.entries(ARCHIVES)) {
    const file = `${layout.archives}/semaphile-${name}-0.3.0.tgz`;
    const actual = await sha256(file);
    archives[name] = actual;
    if (actual !== expected) {
      problems.push(`archive ${name} ${actual}`);
    }
    const entries = tarEntries(await readFile(file));
    const root = `${layout.modules}/@semaphile/${name}`;
    const installed = (await walk(root)).filter(({ info }) => info.isFile());
    if (installed.length !== entries.size) {
      problems.push(`${name}: ${installed.length} installed files, ${entries.size} archived`);
    }
    for (const { path } of installed) {
      const relative = path.slice(root.length + 1);
      if (entries.get(relative) !== (await sha256(path))) {
        problems.push(`${name}/${relative} differs from the archive`);
      }
    }
  }
  const lock = JSON.parse(await readFile(`${layout.harness}/package-lock.json`, 'utf8'));
  const pins = JSON.parse(await readFile(`${layout.harness}/candidate-pins.json`, 'utf8'));
  if (pins.candidate !== CANDIDATE) {
    problems.push('candidate pins name another commit');
  }
  const locked = Object.entries(lock.packages).filter(([key]) => key.startsWith('node_modules/'));
  for (const [key, entry] of locked) {
    const manifest = JSON.parse(await readFile(`${layout.harness}/${key}/package.json`, 'utf8'));
    if (manifest.version !== entry.version) {
      problems.push(`${key} installed ${manifest.version}, locked ${entry.version}`);
    }
    const name = key.slice('node_modules/'.length);
    if (name.startsWith('@semaphile/')) {
      const expected =
        'sha512-' +
        createHash('sha512')
          .update(await readFile(`${layout.archives}/semaphile-${name.slice(11)}-0.3.0.tgz`))
          .digest('base64');
      if (entry.integrity !== expected) {
        problems.push(`${key} lock integrity is not the archive digest`);
      }
    } else {
      const pin = pins.packages[key];
      if (
        !pin ||
        pin.version !== entry.version ||
        pin.resolved !== entry.resolved ||
        pin.integrity !== entry.integrity
      ) {
        problems.push(`${key} is not pinned by the candidate locks`);
      }
    }
  }
  const installedNames = (await readdir(layout.modules, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap((entry) => entry.name);
  for (const name of installedNames) {
    const scoped = name.startsWith('@')
      ? (await readdir(`${layout.modules}/${name}`)).map((child) => `${name}/${child}`)
      : [name];
    for (const child of scoped) {
      if (!lock.packages[`node_modules/${child}`]) {
        problems.push(`node_modules/${child} is installed but not locked`);
      }
    }
  }
  return {
    status: problems.length ? 'FAIL' : 'PASS',
    archives,
    lockedPackages: locked.length,
    problems,
  };
}

export function exec(
  file,
  args,
  { stdin = 'ignore', env = { PATH: '/usr/bin:/bin' }, timeoutMs = 20000, limit = 4000 } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: [stdin, 'pipe', 'pipe'], env, detached: true });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, error: error.code, stdout, stderr });
    });
    void once(child, 'close').then(([code, signal]) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: stdout.slice(0, limit), stderr: stderr.slice(0, 2000) });
    });
  });
}

const helloOf = (output) => {
  const line = output.split('\n').find((entry) => entry.includes('"event":"hello"'));
  return line ? JSON.parse(line).identity : undefined;
};

// Identity switching is noninteractive and nothing broader is permitted.
export async function switchCheck(ctx) {
  const layout = paths(ctx.prefix);
  const results = [];
  if (ctx.mode === 'sudo') {
    results.push({ step: 'invalidate-timestamp', ...(await exec('/usr/bin/sudo', ['-K'])) });
  }
  for (const account of ACCOUNTS) {
    const argv =
      ctx.mode === 'sudo'
        ? ['/usr/bin/sudo', ['-n', '-u', account.name, layout.runner, 'node']]
        : [
            '/usr/bin/setpriv',
            [
              `--reuid=${account.uid}`,
              `--regid=${account.gid}`,
              '--init-groups',
              '--inh-caps=-all',
              '--bounding-set=-all',
              '--no-new-privs',
              '--reset-env',
              '--',
              layout.runner,
              'node',
            ],
          ];
    const result = await exec(...argv);
    const identity = helloOf(result.stdout);
    results.push({
      step: `noninteractive-${account.name}`,
      expected: 'hello then exit 0 with closed input',
      pass:
        result.code === 0 && identity?.uid === account.uid && identity?.tty.controlling !== true,
      code: result.code,
      identity: identity && {
        uid: identity.uid,
        gid: identity.gid,
        groups: identity.groups,
        tty: identity.tty,
      },
      stderr: result.stderr,
    });
  }
  const refusals =
    ctx.mode === 'sudo'
      ? [
          ['root target', '/usr/bin/sudo', ['-n', '-u', 'root', layout.runner, 'node']],
          ['shell', '/usr/bin/sudo', ['-n', '-u', 'sem3a', '/bin/sh', '-c', 'id']],
          [
            'extra argument',
            '/usr/bin/sudo',
            ['-n', '-u', 'sem3a', layout.runner, 'node', 'extra'],
          ],
          ['other runtime', '/usr/bin/sudo', ['-n', '-u', 'sem3a', layout.runner, 'python']],
          [
            'preserved environment',
            '/usr/bin/sudo',
            ['-n', '-E', '-u', 'sem3a', layout.runner, 'node'],
          ],
          ['other program', '/usr/bin/sudo', ['-n', '-u', 'sem3a', layout.node, '-e', '1']],
          ['runner without switch', layout.runner, ['node']],
        ]
      : [
          ['runner as root', layout.runner, ['node']],
          [
            'runner as nobody',
            '/usr/bin/setpriv',
            ['--reuid=65534', '--regid=65534', '--clear-groups', '--', layout.runner, 'node'],
          ],
          [
            'runner as service',
            '/usr/bin/setpriv',
            ['--reuid=999', '--regid=999', '--clear-groups', '--', layout.runner, 'node'],
          ],
          [
            'other runtime',
            '/usr/bin/setpriv',
            ['--reuid=3601', '--regid=3601', '--init-groups', '--', layout.runner, 'python'],
          ],
        ];
  for (const [step, file, args] of refusals) {
    const result = await exec(file, args);
    results.push({
      step,
      expected: 'refused before any participant starts',
      pass: result.code !== 0 && !helloOf(result.stdout),
      code: result.code,
      stderr: result.stderr.split('\n')[0],
    });
  }
  return { status: results.every((r) => r.pass !== false) ? 'PASS' : 'FAIL', results };
}

export async function loginCheck() {
  const results = [];
  for (const account of ACCOUNTS) {
    const read = async (attribute) =>
      (
        await exec('/usr/bin/dscl', ['.', '-read', `/Users/${account.name}`, attribute])
      ).stdout.trim();
    const ssh = await exec('/usr/sbin/dseditgroup', [
      '-o',
      'checkmember',
      '-m',
      account.name,
      'com.apple.access_ssh',
    ]);
    const shell = await read('UserShell');
    const authority = await read('AuthenticationAuthority');
    const hidden = await read('IsHidden');
    const primary = await read('PrimaryGroupID');
    results.push({
      account: account.name,
      shell,
      authority: authority || '(none)',
      hidden,
      primary,
      ssh: ssh.stdout.trim() || ssh.stderr.trim(),
      pass:
        shell === 'UserShell: /usr/bin/false' &&
        !authority.includes('ShadowHash') &&
        hidden === 'IsHidden: 1' &&
        primary === `PrimaryGroupID: ${account.gid}` &&
        !ssh.stdout.startsWith('yes'),
    });
  }
  return { status: results.every((r) => r.pass) ? 'PASS' : 'FAIL', results };
}

export async function trustedFiles(prefix) {
  const layout = paths(prefix);
  const harness = (await readdir(layout.harness))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `${layout.harness}/${name}`);
  const lib = (await readdir(`${layout.harness}/lib`)).map(
    (name) => `${layout.harness}/lib/${name}`,
  );
  return [
    layout.runner,
    ...harness,
    ...lib,
    `${layout.harness}/package.json`,
    `${layout.harness}/package-lock.json`,
    layout.cli,
    `${layout.modules}/@semaphile/redis/dist/messaging.js`,
    `${layout.modules}/@semaphile/messaging/dist/src/index.js`,
    `${layout.modules}/@semaphile/core/dist/src/index.js`,
    `${layout.modules}/@redis/client/package.json`,
    ...Object.keys(ARCHIVES).map((name) => `${layout.archives}/semaphile-${name}-0.3.0.tgz`),
  ];
}

export function writeTargets(prefix) {
  const layout = paths(prefix);
  return {
    directories: [
      layout.prefix,
      `${layout.prefix}/bin`,
      `${layout.prefix}/runtime`,
      `${layout.prefix}/runtime/node/bin`,
      `${layout.prefix}/runtime/bun`,
      layout.checkout,
      layout.harness,
      `${layout.harness}/lib`,
      layout.modules,
      `${layout.modules}/@semaphile/messaging/dist/src`,
      layout.archives,
      `${layout.prefix}/home`,
      `${layout.prefix}/shared`,
      layout.tmp,
      `${layout.tmp}/participants`,
    ],
    files: [
      layout.runner,
      layout.node,
      layout.bun,
      `${layout.harness}/participant.mjs`,
      layout.cli,
      layout.shared,
    ],
  };
}

export async function runtimePaths(prefix) {
  const layout = paths(prefix);
  return { node: await realpath(layout.node), bun: await realpath(layout.bun) };
}
