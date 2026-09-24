// One fixture participant: runs as a dedicated OS identity and answers the
// controller's JSON-lines requests on stdin/stdout. The operation set is
// fixed; nothing here executes caller-supplied programs or shell text.
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  open as openFile,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
  mkdir,
  chmod,
  stat,
} from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import os from 'node:os';
import { isatty } from 'node:tty';
import { open as respOpen, describe } from './lib/resp.mjs';
import {
  ACCOUNTS,
  PREFIX,
  URL_ENV,
  paths,
  configDir,
  credentialFile,
  workDir,
} from './lib/layout.mjs';

const dlopened = [];
const nativeDlopen = process.dlopen;
process.dlopen = function (module, filename, ...rest) {
  dlopened.push(String(filename));
  return nativeDlopen.call(this, module, filename, ...rest);
};

const devPrefix = process.env.SEM3_DEV_PREFIX;
const prefix = devPrefix ?? PREFIX;
const layout = paths(prefix);
const account = devPrefix
  ? ACCOUNTS.find((entry) => entry.name === process.env.SEM3_DEV_ACCOUNT)
  : ACCOUNTS.find((entry) => entry.uid === process.getuid());
if (!account) {
  process.stderr.write('participant: not a fixture identity\n');
  process.exit(77);
}
const home = layout.home(account.name);
const secrets = new Set();
const sanitize = (text) => {
  let result = String(text);
  for (const secret of secrets) {
    result = result.split(secret).join('<redacted>');
  }
  return result;
};
const emit = (message) => process.stdout.write(sanitize(JSON.stringify(message)) + '\n');
const failure = (error) => ({
  code: error?.code ?? error?.name ?? 'ERROR',
  errno: error?.errno,
  syscall: error?.syscall,
  message: sanitize(error?.message ?? String(error)).slice(0, 500),
});

const semaphile = {};
async function load() {
  semaphile.messaging = await import('@semaphile/messaging');
  semaphile.redis = await import('@semaphile/redis/messaging');
}
function resolved(specifier) {
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch (error) {
    return { error: failure(error) };
  }
}

async function identity() {
  let controlling;
  try {
    const handle = await openFile('/dev/tty', 'r');
    await handle.close();
    controlling = true;
  } catch (error) {
    controlling = error.code;
  }
  const redisEntry = resolved('@semaphile/redis/messaging');
  let client;
  try {
    client = await realpath(createRequire(redisEntry).resolve('@redis/client'));
  } catch (error) {
    client = { error: failure(error) };
  }
  const real = async (path) => (typeof path === 'string' ? await realpath(path) : path);
  let capabilities;
  if (process.platform === 'linux') {
    const status = await readFile('/proc/self/status', 'utf8');
    capabilities = Object.fromEntries(
      status
        .split('\n')
        .filter((line) => /^(Cap(Inh|Prm|Eff|Bnd|Amb)|NoNewPrivs):/.test(line))
        .map((line) => line.split(/:\s+/)),
    );
  }
  return {
    account: account.name,
    role: account.role,
    pid: process.pid,
    ppid: process.ppid,
    uid: process.getuid(),
    euid: process.geteuid(),
    gid: process.getgid(),
    egid: process.getegid(),
    groups: process.getgroups().toSorted((a, b) => a - b),
    user: os.userInfo().username,
    home: process.env.HOME,
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    execPath: await realpath(process.execPath),
    runtime: process.versions.bun
      ? { name: 'bun', version: process.versions.bun }
      : { name: 'node', version: process.version },
    modules: {
      messaging: await real(resolved('@semaphile/messaging')),
      redisMessaging: await real(redisEntry),
      core: await real(resolved('@semaphile/core')),
      redisClient: client,
    },
    tty: { stdin: isatty(0), stdout: isatty(1), controlling },
    capabilities,
    envNames: Object.keys(process.env).toSorted(),
  };
}

// Native-free proof: list shared objects this process has actually mapped.
async function nativeObjects() {
  let mapped;
  if (process.platform === 'linux') {
    const maps = await readFile('/proc/self/maps', 'utf8');
    mapped = maps.split('\n').map((line) => line.split(/\s+/).slice(5).join(' '));
  } else {
    const output = await run('/usr/sbin/lsof', ['-n', '-P', '-p', String(process.pid), '-F', 'n'], {
      timeoutMs: 15000,
    });
    if (output.code !== 0) {
      throw Object.assign(new Error('lsof failed: ' + output.stderr), { code: 'LSOF' });
    }
    mapped = output.stdout
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1));
  }
  const addons = [...new Set(mapped.filter((path) => path.endsWith('.node')))];
  return { method: process.platform === 'linux' ? '/proc/self/maps' : 'lsof', addons, dlopened };
}

function insideHome(path) {
  const target = resolve(home, path);
  if (!target.startsWith(home + '/')) {
    throw Object.assign(new Error('Path escapes the participant home'), { code: 'INPUT' });
  }
  return target;
}

const credentials = new Map();
async function credential(profile) {
  if (!credentials.has(profile)) {
    const { url } = JSON.parse(
      await readFile(credentialFile(account.name, profile, prefix), 'utf8'),
    );
    const parsed = new URL(url);
    secrets.add(decodeURIComponent(parsed.password));
    secrets.add(url);
    credentials.set(profile, {
      url,
      host: parsed.hostname,
      port: Number(parsed.port),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    });
  }
  return credentials.get(profile);
}
async function projectOf(profile) {
  const file = join(configDir(account.name, profile, prefix), 'semaphile.json');
  return JSON.parse(await readFile(file, 'utf8')).messaging.redis;
}

function run(command, args, { cwd = home, env, input, timeoutMs = 30000 } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? { HOME: home, PATH: '/usr/bin:/bin', LANG: 'C' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

const CLI_COMMANDS = new Set(['create', 'send', 'wait', 'ack', 'history', 'receive', 'agents']);
const SELECTOR_FLAGS = new Set(['--store', '--redis-url-env', '--namespace', '--messaging-store']);
async function cli({ profile, args, input, timeoutMs = 30000 }) {
  const allowed =
    Array.isArray(args) &&
    args.every((arg) => typeof arg === 'string' && !SELECTOR_FLAGS.has(arg)) &&
    (args[0] === 'info' || (args[0] === 'message' && CLI_COMMANDS.has(args[1])));
  if (!allowed) {
    throw Object.assign(new Error('CLI arguments outside the fixture allowlist'), {
      code: 'INPUT',
    });
  }
  const { url } = await credential(profile);
  const cwd = workDir(account.name, profile, prefix);
  const started = Date.now();
  const result = await run(process.execPath, [layout.cli, ...args], {
    cwd,
    input,
    timeoutMs: Math.min(timeoutMs, 60000),
    env: {
      HOME: home,
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      TMPDIR: layout.scratch(account.name),
      ...(process.versions.bun ? { BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' } : {}),
      [URL_ENV]: url,
    },
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return {
    cwd,
    code: result.code,
    signal: result.signal,
    json,
    stdout: json === undefined ? sanitize(result.stdout).slice(0, 2000) : undefined,
    stderr: sanitize(result.stderr).slice(0, 2000),
    started,
    finished: Date.now(),
  };
}

const clients = new Map(),
  subscriptions = new Map(),
  listeners = new Map(),
  probes = new Map();
let opening = Promise.resolve();
async function openClient({ handle, profile }) {
  const previous = opening;
  let release;
  opening = new Promise((resolveOpen) => (release = resolveOpen));
  await previous;
  const warnings = [];
  const onWarning = (warning) => warnings.push({ code: warning.code, message: warning.message });
  process.on('warning', onWarning);
  try {
    const { url } = await credential(profile);
    process.env[URL_ENV] = url;
    const selected = await semaphile.messaging.messagingOptions({
      cwd: workDir(account.name, profile, prefix),
    });
    const client = await semaphile.messaging.openConfiguredMessaging(selected.open);
    clients.set(handle, client);
    const { url: _url, ...open } = selected.open;
    // Warnings are delivered asynchronously; let the queued ones arrive.
    await new Promise((resolveTick) => setImmediate(resolveTick));
    return { file: selected.project?.file, directory: selected.project?.directory, open, warnings };
  } catch (error) {
    await new Promise((resolveTick) => setImmediate(resolveTick));
    error.warnings = warnings;
    throw error;
  } finally {
    delete process.env[URL_ENV];
    process.off('warning', onWarning);
    release();
  }
}

const CLIENT_METHODS = new Set([
  'info',
  'createMailbox',
  'register',
  'unregister',
  'agents',
  'subscriptions',
  'publish',
  'send',
  'receive',
  'wait',
  'ack',
  'release',
  'renew',
  'fail',
  'retry',
  'history',
  'events',
]);
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
async function call({ handle, method, args = [], as }) {
  const client = clients.get(handle);
  if (!client) {
    throw Object.assign(new Error('Unknown client handle'), { code: 'INPUT' });
  }
  if (method === 'subscribe' || method === 'subscription') {
    const subscription = await client[method](...args);
    subscriptions.set(as, subscription);
    return plain(subscription.info);
  }
  if (!CLIENT_METHODS.has(method)) {
    throw Object.assign(new Error('Method outside the fixture allowlist'), { code: 'INPUT' });
  }
  return plain(await client[method](...args));
}
async function subscriptionCall({ sub, method, args = [] }) {
  const subscription = subscriptions.get(sub);
  if (!subscription || !['receive', 'wait', 'remove', 'close'].includes(method)) {
    throw Object.assign(new Error('Unknown subscription or method'), { code: 'INPUT' });
  }
  return plain(await subscription[method](...args));
}
function listen({ sub, listener, handlerMs }) {
  const subscription = subscriptions.get(sub);
  const active = subscription.listen(async (delivery, context) => {
    emit({ event: 'handler-started', listener, deliveryId: delivery.id, at: Date.now() });
    await new Promise((resolveHandler) => setTimeout(resolveHandler, handlerMs));
    emit({
      event: 'handler-finished',
      listener,
      deliveryId: delivery.id,
      aborted: context.signal.aborted,
      at: Date.now(),
    });
  });
  listeners.set(listener, active);
  return { listener };
}
function closeClientLater({ handle }) {
  const client = clients.get(handle);
  const started = Date.now();
  client.close().then(
    () => emit({ event: 'client-closed', handle, started, at: Date.now() }),
    (error) =>
      emit({ event: 'client-closed', handle, started, at: Date.now(), error: failure(error) }),
  );
  return { started };
}

function symbolic(value, key, nonce) {
  return String(value)
    .replace('{root}', key)
    .replace('{computed}', key + ':messages')
    .replace('{notify}', key + ':notify')
    .replace('{outside-channel}', `sem3-outside-${nonce}:notify`)
    .replace('{outside}', `sem3-outside-${nonce}`);
}
async function authenticated(profile) {
  const { host, port, user, password } = await credential(profile);
  const connection = await respOpen({ host, port });
  const auth = await connection.command('AUTH', user, password);
  if (auth !== 'OK') {
    connection.close();
    throw Object.assign(new Error('Participant AUTH failed'), {
      code: 'AUTH',
      reply: describe(auth),
    });
  }
  return connection;
}
async function aclProbe({ profile, commands }) {
  const redis = await projectOf(profile);
  const key = semaphile.redis.messagingKey(redis.namespace, redis.store);
  const nonce = randomBytes(4).toString('hex');
  const results = [];
  for (const command of commands) {
    const connection = await authenticated(profile);
    try {
      const args = command.map((part) => symbolic(part, key, nonce));
      results.push({ command: args, ...describe(await connection.command(...args)) });
    } finally {
      connection.close();
    }
  }
  return { key, results };
}
async function unauthenticated({ profile }) {
  const { host, port, user } = await credential(profile);
  const redis = await projectOf(profile);
  const key = semaphile.redis.messagingKey(redis.namespace, redis.store);
  const anonymous = await respOpen({ host, port });
  let store, authDefault;
  try {
    store = describe(await anonymous.command('HGET', key, 'meta'));
    authDefault = describe(
      await anonymous.command('AUTH', 'default', randomBytes(12).toString('hex')),
    );
  } finally {
    anonymous.close();
  }
  const named = await authenticated(profile);
  try {
    return {
      endpoint: `${host}:${port}`,
      user,
      store,
      authDefault,
      named: describe(await named.command('PING')),
    };
  } finally {
    named.close();
  }
}
async function probe({ profile, name }) {
  const { user, password } = await credential(profile);
  const connection = await authenticated(profile);
  const hello = await connection.command('HELLO', '2', 'AUTH', user, password, 'SETNAME', name);
  probes.set(name, connection);
  return { name, user, hello: Array.isArray(hello) ? 'OK' : describe(hello) };
}

async function readPaths({ paths: targets }) {
  const results = [];
  for (const path of targets) {
    try {
      const bytes = await readFile(path);
      results.push({
        path,
        ok: true,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } catch (error) {
      results.push({ path, ok: false, code: error.code });
    }
  }
  return results;
}
async function listPaths({ paths: targets }) {
  const results = [];
  for (const path of targets) {
    try {
      await readdir(path);
      results.push({ path, ok: true });
    } catch (error) {
      results.push({ path, ok: false, code: error.code });
    }
  }
  return results;
}
// Attempts writes that must be refused; any success is reported and undone.
async function writeProbe({ directories = [], files = [] }) {
  const results = [];
  for (const directory of directories) {
    const target = join(directory, `.sem3-write-probe-${randomBytes(4).toString('hex')}`);
    try {
      const handle = await openFile(target, 'wx');
      await handle.close();
      await unlink(target);
      results.push({ path: directory, kind: 'create', ok: true });
    } catch (error) {
      results.push({ path: directory, kind: 'create', ok: false, code: error.code });
    }
  }
  for (const file of files) {
    try {
      const handle = await openFile(file, 'r+');
      await handle.close();
      results.push({ path: file, kind: 'open-write', ok: true });
    } catch (error) {
      results.push({ path: file, kind: 'open-write', ok: false, code: error.code });
    }
  }
  return results;
}
async function inventory() {
  const found = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      found.push(relative(home, path) + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory()) {
        await walk(path);
      }
    }
  };
  await walk(home);
  let scratch = [];
  try {
    scratch = await readdir(layout.scratch(account.name));
  } catch (error) {
    scratch = { error: error.code };
  }
  return { home: found.toSorted(), scratch };
}
async function provision({ files, directories = [] }) {
  for (const directory of directories) {
    await mkdir(insideHome(directory), { recursive: true, mode: 0o700 });
  }
  const written = [];
  for (const file of files) {
    const target = insideHome(file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, file.content, { mode: file.mode });
    await chmod(target, file.mode);
    const info = await stat(target);
    written.push({
      path: target,
      mode: (info.mode & 0o777).toString(8),
      uid: info.uid,
      bytes: info.size,
    });
  }
  return written;
}
async function purge({ paths: targets }) {
  const removed = [];
  for (const path of targets) {
    try {
      await unlink(insideHome(path));
      removed.push({ path, removed: true });
    } catch (error) {
      removed.push({ path, removed: false, code: error.code });
    }
  }
  return removed;
}

async function shutdown() {
  for (const listener of listeners.values()) {
    await listener.close().catch(() => {});
  }
  for (const client of clients.values()) {
    await client.close().catch(() => {});
  }
  for (const connection of probes.values()) {
    connection.close();
  }
}

const operations = {
  identity,
  native: nativeObjects,
  read: readPaths,
  readdir: listPaths,
  'write-probe': writeProbe,
  inventory,
  provision,
  purge,
  cli,
  open: openClient,
  close: async ({ handle }) => {
    await clients.get(handle).close();
    clients.delete(handle);
    return { closed: handle };
  },
  'close-later': closeClientLater,
  call,
  sub: subscriptionCall,
  listen,
  'listener-close': async ({ listener }) => {
    await listeners.get(listener).close();
    return { closed: listener };
  },
  acl: aclProbe,
  unauth: unauthenticated,
  probe,
  'probe-close': ({ name }) => {
    probes.get(name)?.close();
    probes.delete(name);
    return { closed: name };
  },
  'exit-abrupt': () => {
    // Deliberately skip every close so presence and sockets are abandoned.
    process.exit(0);
  },
};

process.on('unhandledRejection', (error) => emit({ event: 'unhandled', error: failure(error) }));
await load();
emit({ event: 'hello', identity: await identity() });
const input = createInterface({ input: process.stdin });
const pending = new Set();
input.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    emit({ event: 'bad-request' });
    return;
  }
  const operation = operations[request.op];
  const started = Date.now();
  const task = (async () => {
    try {
      if (!operation) {
        throw Object.assign(new Error('Unknown operation'), { code: 'INPUT' });
      }
      const result = await operation(request.args ?? {});
      emit({ id: request.id, ok: true, result, started, finished: Date.now() });
    } catch (error) {
      emit({
        id: request.id,
        ok: false,
        error: { ...failure(error), warnings: error.warnings, reply: error.reply },
        started,
        finished: Date.now(),
      });
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
});
input.once('close', () => {
  void Promise.allSettled(pending)
    .then(shutdown)
    .finally(() => process.exit(0));
});
