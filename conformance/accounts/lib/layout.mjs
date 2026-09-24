// Fixed fixture identities, paths and the case → profile → grant mapping.
// Everything here is reviewed before provisioning; nothing is discovered.
export const PREFIX = '/opt/semaphile-sem3';
export const CANDIDATE = '800c8c53b8548250da6bf4a684bf796f1e9e1a73';
export const ARCHIVES = {
  core: '6f944338dbe1d5ce01170902d453e73d474a54e0f43f366b8ca1a303598f89eb',
  redis: 'bfdc9c5a678c90e6947674e0b1d5542cb8fcebc8fc7f0c7a68b789d555fcb640',
  messaging: '35d3a0e0bc262923a9ca2155e317eb8726efbb763a55609fb3473161a63808aa',
  otel: '19a33a67d66abcc68bb0be3fce93e3f3dae86a5620fc80e3c882331e630dc3e4',
};
export const RUNTIMES = {
  darwin: { node: 'v22.21.1', bun: '1.4.2', arch: 'arm64' },
  linux: { node: 'v22.23.0', bun: '1.4.2', arch: 'x64' },
};
export const REDIS_VERSION = '8.4.0';
export const ACCOUNTS = [
  { name: 'sem3a', role: 'A', uid: 3601, gid: 3601, handoff: true },
  { name: 'sem3b', role: 'B', uid: 3602, gid: 3602, handoff: true },
  { name: 'sem3c', role: 'C', uid: 3603, gid: 3603, handoff: false },
];
export const HANDOFF_GROUP = { name: 'sem3ab', gid: 3610 };
export const byRole = Object.fromEntries(ACCOUNTS.map((account) => [account.role, account]));
export const URL_ENV = 'SEM3_REDIS_URL';

export function paths(prefix = PREFIX) {
  const checkout = `${prefix}/checkout`;
  return {
    prefix,
    runner: `${prefix}/bin/sem3-participant`,
    node: `${prefix}/runtime/node/bin/node`,
    bun: `${prefix}/runtime/bun/bun`,
    checkout,
    harness: `${checkout}/conformance/accounts`,
    modules: `${checkout}/conformance/accounts/node_modules`,
    cli: `${checkout}/conformance/accounts/node_modules/@semaphile/messaging/dist/src/cli.js`,
    archives: `${checkout}/releases/candidates/redis-messaging/0.3.0/${CANDIDATE}`,
    tmp: `${checkout}/.tmp`,
    controller: `${checkout}/.tmp/controller`,
    redis: `${checkout}/.tmp/redis`,
    scratch: (account) => `${checkout}/.tmp/participants/${account}`,
    home: (account) => `${prefix}/home/${account}`,
    shared: `${prefix}/shared/handoff.txt`,
  };
}

// The documented messaging allowlist (docs/redis-messaging.md); variants
// below remove or add exactly what their case needs.
export const MESSAGING_COMMANDS = [
  'ping',
  'hello',
  'client|setinfo',
  'quit',
  'time',
  'eval',
  'subscribe',
  'unsubscribe',
  'publish',
  'type',
  'exists',
  'hget',
  'hset',
  'hdel',
  'zcard',
  'zrangebyscore',
  'zscore',
  'zadd',
  'zrem',
];

// One profile = one semaphile.json + one 0600 credential file + one Redis
// user per account. Stores differ where normalized settings differ.
export const PROFILES = {
  d1: { store: 'd1' },
  t1: { store: 't1' },
  t2: { store: 't2', config: { maxPendingPerRecipient: 1 } },
  t3: { store: 't3' },
  t4: { store: 't4' },
  t5: { store: 't5' },
  t6: { store: 't6' },
  t7: { store: 't7' },
  t8: { store: 't8', config: { claimTtlMs: 1500 } },
  l1: { store: 'l1' },
  l2: { store: 'l2', config: { claimTtlMs: 1500, retryDelayMs: 1000, maxAttempts: 3 } },
  l3: { store: 'l3', redis: { sessionTimeoutMs: 3000 } },
  acl: { store: 'acl' },
  'acl-rootonly': { store: 'acl', grant: 'root-only' },
  'acl-nochannel': { store: 'acl', grant: 'no-channel' },
  'acl-revoke': { store: 'acl' },
  'ready-warn': { store: 'ready' },
  'ready-strict': { store: 'ready', redis: { readiness: 'strict' } },
  'ready-inspect': { store: 'ready', grant: 'inspect', redis: { readiness: 'strict' } },
};

export const namespaceFor = (run) => `sem3-${run}`;
export const redisUser = (account, profile) => `${account}-${profile}`;
export const configDir = (account, profile, prefix = PREFIX) =>
  `${paths(prefix).home(account)}/projects/${profile}`;
// CLI and library cases run below the config directory so discovery walks up.
export const workDir = (account, profile, prefix = PREFIX) =>
  `${configDir(account, profile, prefix)}/work`;
export const credentialFile = (account, profile, prefix = PREFIX) =>
  `${paths(prefix).home(account)}/.sem3/credentials/${profile}.json`;

export function projectConfig(run, profile) {
  const spec = PROFILES[profile];
  return {
    version: 1,
    messaging: {
      backend: 'redis',
      redis: {
        urlEnv: URL_ENV,
        namespace: namespaceFor(run),
        store: spec.store,
        readiness: 'warn',
        operationTimeoutMs: 10000,
        ...spec.redis,
      },
      ...(spec.config ? { config: spec.config } : {}),
      clientDefaults: { configMismatch: 'error' },
    },
  };
}

export function grants(key, profile) {
  const grant = PROFILES[profile].grant ?? 'standard';
  const keys = grant === 'root-only' ? [`~${key}`] : [`~${key}`, `~${key}:*`];
  const channels = grant === 'no-channel' ? [] : [`&${key}:notify`];
  const commands = [...MESSAGING_COMMANDS, ...(grant === 'inspect' ? ['info', 'config|get'] : [])];
  return [...keys, ...channels, ...commands.map((command) => '+' + command)];
}

// Mixed-runtime assignments for the cooperating T/L families.
export const ASSIGNMENTS = {
  X: { A: 'node', B: 'bun', C: 'node' },
  Y: { A: 'bun', B: 'node', C: 'bun' },
};
export const RUNTIME_PAIRS = [
  ['node', 'node'],
  ['node', 'bun'],
  ['bun', 'node'],
  ['bun', 'bun'],
];
export const DIRECTED_PAIRS = ACCOUNTS.flatMap((sender) =>
  ACCOUNTS.filter((receiver) => receiver !== sender).map((receiver) => [
    sender.role,
    receiver.role,
  ]),
);
export const TOPIC_CASES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
export const LIFETIME_CASES = ['L1', 'L2', 'L3'];
export const ACL_CASES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
export const READINESS_CASES = ['R1', 'R2', 'R3'];

// The fixed 100-instance inventory; ids are stable across runs.
export function inventory() {
  const cases = [];
  for (const [sender, receiver] of DIRECTED_PAIRS) {
    for (const [sendRuntime, receiveRuntime] of RUNTIME_PAIRS) {
      cases.push({
        id: `D1-${sender}${receiver}-${sendRuntime[0]}${receiveRuntime[0]}`,
        family: 'D1',
        roles: { [sender]: sendRuntime, [receiver]: receiveRuntime },
        sender,
        receiver,
      });
    }
  }
  for (const family of [...TOPIC_CASES, ...LIFETIME_CASES]) {
    for (const [assignment, roles] of Object.entries(ASSIGNMENTS)) {
      cases.push({ id: `${family}-${assignment}`, family, roles: { ...roles } });
    }
  }
  for (const family of [...ACL_CASES, ...READINESS_CASES]) {
    for (const account of ACCOUNTS) {
      for (const runtime of ['node', 'bun']) {
        cases.push({
          id: `${family}-${account.role}-${runtime}`,
          family,
          roles: { [account.role]: runtime },
          rerun: true,
        });
      }
    }
  }
  return cases;
}
