// SEM-3 fixture controller: owns Redis administration, provisions per-run
// credentials through each participant, runs the fixture checks and the
// fixed 100-case inventory, and writes sanitized receipts.
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { relative } from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import {
  ACCOUNTS,
  PREFIX,
  PROFILES,
  byRole,
  credentialFile,
  configDir,
  grants,
  inventory,
  namespaceFor,
  paths,
  projectConfig,
  redisUser,
  workDir,
} from './lib/layout.mjs';
import { Participant } from './lib/launch.mjs';
import { startRedis } from './lib/service.mjs';
import { CASES, Invalid, profileFor } from './lib/cases.mjs';
import {
  exec,
  identityProblems,
  installedCandidateCheck,
  loginCheck,
  ownershipCheck,
  participantChecks,
  runtimePaths,
  switchCheck,
  trustedFiles,
  writeTargets,
} from './lib/checks.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: 'string' },
    receipts: { type: 'string' },
    'redis-binary': { type: 'string' },
    dev: { type: 'string' },
    'dev-node': { type: 'string' },
    'dev-bun': { type: 'string' },
    only: { type: 'string' },
    'skip-checks': { type: 'boolean' },
    'skip-cases': { type: 'boolean' },
  },
});
if (positionals[0] !== 'run' || !/^[a-z0-9-]{6,48}$/.test(values.run ?? '') || !values.receipts) {
  console.error(
    'usage: controller.mjs run --run ID --receipts DIR [--redis-binary PATH] [--only REGEX]',
  );
  process.exit(64);
}
const platform = process.platform;
const mode = values.dev ? 'dev' : platform === 'darwin' ? 'sudo' : 'setpriv';
if ((mode === 'sudo' && process.getuid() === 0) || (mode === 'setpriv' && process.getuid() !== 0)) {
  console.error(`controller: ${mode} mode must not run as uid ${process.getuid()}`);
  process.exit(77);
}
const prefix = values.dev ?? PREFIX;
const layout = paths(prefix);
const run = values.run;
const namespace = namespaceFor(run);
const started = Date.now();

const secrets = new Set();
const sanitize = (value) => {
  let text = JSON.stringify(value);
  for (const secret of secrets) {
    text = text.split(secret).join('<redacted>');
  }
  return text;
};
const receipts = values.receipts;
await mkdir(receipts, { recursive: false, mode: 0o700 });
const write = (file, value) =>
  appendFile(`${receipts}/${file}`, sanitize(value) + '\n', { mode: 0o600 });
const save = (file, value) =>
  writeFile(`${receipts}/${file}`, sanitize(value) + '\n', { mode: 0o600, flag: 'wx' });
let currentCase = 'setup';
const log = (entry) => void write('events.jsonl', { case: currentCase, at: Date.now(), ...entry });

const controllerDir = `${layout.controller}/${run}`;
await mkdir(controllerDir, { mode: 0o700 });
const sha256 = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const runtimes =
  mode === 'dev'
    ? { node: await realpath(values['dev-node']), bun: await realpath(values['dev-bun']) }
    : await runtimePaths(prefix);
const redisBinary =
  values['redis-binary'] ?? (platform === 'linux' ? '/usr/local/bin/redis-server' : undefined);
if (!redisBinary) {
  throw new Error('--redis-binary is required on macOS');
}
const versionOf = async (file) => (await exec(file, ['--version'])).stdout.trim();
let source;
try {
  source = JSON.parse(await readFile(`${layout.checkout}/SOURCE.json`, 'utf8'));
} catch {
  source = { commit: 'unrecorded (dev checkout)' };
}
await save('run.json', {
  run,
  namespace,
  platform,
  arch: process.arch,
  mode,
  evidence: mode !== 'dev',
  osRelease: os.release(),
  osVersion: os.version(),
  hostname: os.hostname(),
  controller: {
    uid: process.getuid(),
    gid: process.getgid(),
    user: os.userInfo().username,
    runtime: process.version,
    execPath: await realpath(process.execPath),
  },
  source,
  runtimes: {
    node: {
      path: runtimes.node,
      version: await versionOf(runtimes.node),
      sha256: await sha256(runtimes.node),
    },
    bun: {
      path: runtimes.bun,
      version: await versionOf(runtimes.bun),
      sha256: await sha256(runtimes.bun),
    },
  },
  redisBinary: {
    path: await realpath(redisBinary),
    sha256: await sha256(redisBinary),
    version: await versionOf(redisBinary),
  },
  started,
});

const redis = await startRedis({
  binary: redisBinary,
  directory: `${layout.redis}/${run}`,
  controllerDir,
  serviceUser: mode === 'setpriv' ? { uid: 999, gid: 999 } : undefined,
  log,
});
secrets.add(redis.password);
await write('redis.jsonl', {
  stage: 'started',
  identity: redis.identity,
  endpoint: `${redis.host}:${redis.port}`,
});

const { messagingKey } = await import('@semaphile/redis/messaging');
const spawnParticipant = (role, runtime, options = {}) =>
  new Participant({
    mode,
    role,
    runtime,
    prefix,
    devRuntimes: runtimes,
    log: (entry) => log({ pid: undefined, ...entry }),
    ...options,
  });

// Per-run restricted users and the files each identity consumes.
const provisioned = {};
const users = [];
for (const account of ACCOUNTS) {
  const home = layout.home(account.name);
  const files = [],
    directories = [];
  for (const [profile, spec] of Object.entries(PROFILES)) {
    const key = messagingKey(namespace, spec.store);
    const user = redisUser(account.name, profile);
    const password = randomBytes(24).toString('hex');
    secrets.add(password);
    await redis.command(
      'ACL',
      'SETUSER',
      user,
      'reset',
      'on',
      '>' + password,
      ...grants(key, profile),
    );
    users.push(user);
    directories.push(relative(home, workDir(account.name, profile, prefix)));
    files.push(
      {
        path: relative(home, `${configDir(account.name, profile, prefix)}/semaphile.json`),
        content: JSON.stringify(projectConfig(run, profile), null, 2) + '\n',
        mode: 0o600,
      },
      {
        path: relative(home, credentialFile(account.name, profile, prefix)),
        content:
          JSON.stringify({ url: `redis://${user}:${password}@${redis.host}:${redis.port}` }) + '\n',
        mode: 0o600,
      },
    );
  }
  const participant = spawnParticipant(account.role, 'node');
  try {
    await participant.hello;
    const written = await participant.ok('provision', { directories, files });
    provisioned[account.name] = new Set(files.map((file) => file.path));
    await write('provision.jsonl', { account: account.name, written });
  } finally {
    await participant.close();
  }
}
for (const user of users) {
  await write('redis.jsonl', { stage: 'acl', user, rules: await redis.aclUser(user) });
}

const personalHomes = [];
if (platform === 'darwin') {
  const ids = (
    await exec('/usr/bin/dscl', ['.', '-list', '/Users', 'UniqueID'], { limit: Infinity })
  ).stdout;
  const homes = (
    await exec('/usr/bin/dscl', ['.', '-list', '/Users', 'NFSHomeDirectory'], { limit: Infinity })
  ).stdout;
  const uidOf = Object.fromEntries(
    ids
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/)),
  );
  for (const line of homes.trim().split('\n')) {
    const [name, home] = line.trim().split(/\s+/);
    if (
      Number(uidOf[name]) >= 500 &&
      home.startsWith('/Users/') &&
      !ACCOUNTS.some((a) => a.name === name)
    ) {
      personalHomes.push(home);
    }
  }
}
const ctx = {
  mode,
  platform,
  prefix,
  run,
  namespace,
  redis,
  runtimePaths: runtimes,
  realModules: await realpath(layout.modules),
  personalHomes,
  trustedFiles: await trustedFiles(prefix),
  writeTargets: writeTargets(prefix),
  serviceFiles: [
    `${layout.redis}/${run}/redis.conf`,
    `${controllerDir}/redis.log`,
    `${controllerDir}/admin.credential`,
  ],
  serviceDirectories: [
    `${layout.redis}/${run}`,
    `${layout.redis}/${run}/appendonlydir`,
    controllerDir,
  ],
  spawn: spawnParticipant,
  observations: {},
  observe(key, value) {
    this.observations[key] = value;
  },
};

const tally = { checks: { PASS: 0, FAIL: 0 }, cases: { PASS: 0, FAIL: 0, INVALID: 0 } };
const check = async (name, body) => {
  let result;
  try {
    result = await body();
  } catch (error) {
    result = { status: 'FAIL', error: error.message };
  }
  tally.checks[result.status === 'PASS' ? 'PASS' : 'FAIL']++;
  await write('checks.jsonl', { check: name, ...result });
};
if (!values['skip-checks']) {
  currentCase = 'fixture-checks';
  for (const runtime of ['node', 'bun']) {
    let records;
    try {
      records = await participantChecks(ctx, runtime);
    } catch (error) {
      records = [{ check: 'participant-checks', runtime, status: 'FAIL', error: error.message }];
    }
    for (const record of records) {
      tally.checks[record.status === 'PASS' ? 'PASS' : 'FAIL']++;
      await write('checks.jsonl', record);
    }
  }
  await check('installed-candidate', () => installedCandidateCheck(ctx));
  await check('redis-startup', async () => {
    const defaultUser = await redis.aclUser('default');
    const settings = redis.identity.settings;
    const pass =
      defaultUser.flags.includes('off') &&
      !defaultUser.flags.includes('on') &&
      settings.requirepass === '' &&
      settings.masterauth === '' &&
      settings.bind === '127.0.0.1' &&
      redis.identity.persistence.aof_enabled === '1';
    return {
      status: pass ? 'PASS' : 'FAIL',
      defaultUser,
      settings,
      persistence: redis.identity.persistence,
    };
  });
  await check('service-access', async () => {
    const own = await Promise.all(
      [`${controllerDir}/admin.credential`, `${controllerDir}/redis.log`].map((path) =>
        readFile(path).then(
          () => ({ path, ok: true }),
          (error) => ({ path, ok: false, code: error.code }),
        ),
      ),
    );
    let service;
    if (mode === 'setpriv') {
      const asService = (args) =>
        exec('/usr/bin/setpriv', ['--reuid=999', '--regid=999', '--clear-groups', '--', ...args]);
      service = [
        await asService(['/bin/cat', `${layout.redis}/${run}/redis.conf`]).then((r) => ({
          file: 'redis.conf',
          code: r.code,
        })),
        await asService(['/bin/ls', `${layout.redis}/${run}/appendonlydir`]).then((r) => ({
          file: 'appendonlydir',
          code: r.code,
        })),
      ];
    } else {
      // On macOS the service runs as the controller itself.
      const attempt = (file, body) =>
        body.then(
          () => ({ file, code: 0 }),
          (error) => ({ file, code: error.code }),
        );
      service = [
        await attempt('redis.conf', readFile(`${layout.redis}/${run}/redis.conf`)),
        await attempt('appendonlydir', readdir(`${layout.redis}/${run}/appendonlydir`)),
      ];
    }
    const pass = own.every((r) => r.ok) && service.every((r) => r.code === 0);
    return { status: pass ? 'PASS' : 'FAIL', controller: own, service };
  });
  if (mode !== 'dev') {
    await check('trusted-ownership', () => ownershipCheck(ctx));
    await check('identity-switch', () => switchCheck(ctx));
    if (platform === 'darwin') {
      await check('login-attributes', () => loginCheck());
    }
  }
}

const withDeadline = (promise, ms, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

async function runCase(c) {
  currentCase = c.id;
  ctx.observations = {};
  const record = {
    case: c.id,
    family: c.family,
    platform,
    run,
    rerun: Boolean(c.rerun),
    roles: {},
    status: 'PASS',
    started: Date.now(),
  };
  const p = { prefix };
  const profile = profileFor(c.family);
  try {
    for (const [role, runtime] of Object.entries(c.roles)) {
      p[role] = spawnParticipant(role, runtime);
    }
    for (const [role, runtime] of Object.entries(c.roles)) {
      const identity = await p[role].hello;
      const problems = identityProblems(identity, byRole[role], runtime, ctx);
      record.roles[role] = {
        account: byRole[role].name,
        runtime,
        pid: identity.pid,
        uid: identity.uid,
        gid: identity.gid,
        groups: identity.groups,
        version: identity.runtime.version,
      };
      if (problems.length) {
        throw new Invalid(`${role} identity does not match the manifest: ${problems.join('; ')}`);
      }
    }
    // Corroborate each identity's credential with the server's own view.
    const probes = {};
    for (const role of Object.keys(c.roles)) {
      probes[role] = `sem3-${c.id}-${role}-${randomBytes(3).toString('hex')}`.toLowerCase();
      await p[role].ok('probe', { profile, name: probes[role] });
    }
    const clients = await redis.clientList();
    for (const [role, name] of Object.entries(probes)) {
      const seen = clients.find((client) => client.name === name);
      const expected = redisUser(byRole[role].name, profile);
      if (seen?.user !== expected) {
        throw new Invalid(
          `${role} credential authenticated as ${seen?.user}, expected ${expected}`,
        );
      }
      record.roles[role].redisUser = seen.user;
      await p[role].ok('probe-close', { name });
    }
    await withDeadline(CASES[c.family](ctx, c, p), 120000, c.id);
    for (const role of Object.keys(c.roles)) {
      if (p[role].child.exitCode !== null) {
        continue;
      }
      const native = await p[role].ok('native');
      if (native.addons.length || native.dlopened.length) {
        throw new Error(
          `${role} loaded a native addon: ${[...native.addons, ...native.dlopened].join(',')}`,
        );
      }
      const files = await p[role].ok('inventory');
      const allowed = provisioned[byRole[role].name];
      const extra = files.home.filter((path) => !path.endsWith('/') && !allowed.has(path));
      if (extra.length || (Array.isArray(files.scratch) && files.scratch.length)) {
        throw new Error(
          `${role} created local files: ${[...extra, ...[files.scratch].flat()].join(',')}`,
        );
      }
    }
  } catch (error) {
    record.status = error instanceof Invalid ? 'INVALID' : 'FAIL';
    record.error = error.message;
    record.stack = error.stack?.split('\n').slice(1, 4).join(' | ');
  } finally {
    record.observations = ctx.observations;
    for (const role of Object.keys(c.roles)) {
      if (p[role]) {
        const exit = await p[role].close();
        record.roles[role] = { ...record.roles[role], exit };
        if (p[role].stderr.trim()) {
          await write('stderr.jsonl', { case: c.id, role, stderr: p[role].stderr.slice(0, 4000) });
        }
      }
    }
    record.finished = Date.now();
  }
  tally.cases[record.status]++;
  await write('cases.jsonl', record);
  console.log(`${record.status} ${c.id}${record.error ? ' — ' + record.error : ''}`);
}

if (!values['skip-cases']) {
  const pattern = values.only ? new RegExp(values.only) : undefined;
  for (const c of inventory().filter((entry) => !pattern || pattern.test(entry.id))) {
    await runCase(c);
  }
}

// Per-run credentials and users never outlive the run.
currentCase = 'cleanup';
const cleanup = [];
for (const account of ACCOUNTS) {
  const participant = spawnParticipant(account.role, 'node');
  try {
    await participant.hello;
    const credentialPaths = Object.keys(PROFILES).map((profile) =>
      relative(layout.home(account.name), credentialFile(account.name, profile, prefix)),
    );
    const removed = await participant.ok('purge', { paths: credentialPaths });
    const left = await participant.ok('inventory');
    cleanup.push({
      account: account.name,
      removed: removed.filter((r) => r.removed).length,
      credentialsLeft: left.home.filter(
        (path) => path.startsWith('.sem3/credentials/') && !path.endsWith('/'),
      ),
    });
  } finally {
    await participant.close();
  }
}
for (const user of users) {
  await redis.command('ACL', 'DELUSER', user);
}
const remainingUsers = (await redis.command('ACL', 'USERS')).filter((user) => users.includes(user));
await redis.stop();
await unlink(`${controllerDir}/admin.credential`);
await write('cleanup.jsonl', {
  credentials: cleanup,
  remainingUsers,
  adminCredentialRemoved: true,
  redisStopped: true,
});
const summary = {
  run,
  platform,
  mode,
  evidence: mode !== 'dev',
  checks: { ...tally.checks, total: tally.checks.PASS + tally.checks.FAIL },
  cases: { ...tally.cases, total: tally.cases.PASS + tally.cases.FAIL + tally.cases.INVALID },
  started,
  finished: Date.now(),
};
await save('summary.json', summary);
console.log(JSON.stringify(summary));
const clean =
  cleanup.every((entry) => entry.credentialsLeft.length === 0) && remainingUsers.length === 0;
process.exit(tally.checks.FAIL || tally.cases.FAIL || tally.cases.INVALID || !clean ? 1 : 0);
