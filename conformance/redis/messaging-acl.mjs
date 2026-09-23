import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { server } from './harness.mjs';
import { messagingKey, openRedisMessaging } from '../../packages/redis/dist/messaging.js';
const require = createRequire(new URL('../../packages/redis/package.json', import.meta.url));
const { createClient } = require('@redis/client');
assert.notEqual(process.getuid(), 0, 'Deployment proof must run unprivileged');
console.log(
  `platform=${process.platform} arch=${process.arch} uid=${process.getuid()} node=${process.version} bun=${process.versions.bun ?? '-'} pid=${process.pid}`,
);
await mkdir('.tmp/redis', { recursive: true });
const root = await mkdtemp(resolve('.tmp/redis/acl-'));
const redis = await server();
const namespace = 'acl-deployment',
  store = randomUUID(),
  key = messagingKey(namespace, store);
const admin = createClient({ url: redis.url });
admin.on('error', () => {});
await admin.connect();
const users = [],
  connections = [];
const commands = [
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
const cli = resolve('packages/messaging/dist/src/cli.js');
async function account(label, keys = [`~${key}`, `~${key}:*`], channels = [`&${key}:notify`]) {
  const username = label + '-' + randomUUID(),
    password = randomUUID();
  await admin.sendCommand([
    'ACL',
    'SETUSER',
    username,
    'reset',
    'on',
    '>' + password,
    ...keys,
    ...channels,
    ...commands.map((c) => '+' + c),
  ]);
  users.push(username);
  const url = new URL(redis.url);
  url.username = username;
  url.password = password;
  return url.href;
}
async function raw(url) {
  const c = createClient({ url, socket: { reconnectStrategy: false } });
  c.on('error', () => {});
  connections.push(c);
  await c.connect();
  return c;
}
async function run(directory, url, args, input = '') {
  return await new Promise((yes, no) => {
    const child = spawn(process.execPath, ['--no-warnings', cli, ...args], {
      cwd: directory,
      env: { ...process.env, SEMAPHILE_ACL_URL: url },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      no(Error('ACL CLI deadline exceeded'));
    }, 15000);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.once('error', (e) => {
      clearTimeout(timer);
      no(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      yes({ code, out, err });
    });
    child.stdin.end(input);
  });
}
try {
  const sender = await account('sender'),
    receiver = await account('receiver');
  const configs = [];
  for (const name of ['sender', 'receiver']) {
    const dir = join(root, name);
    await mkdir(dir);
    configs.push(dir);
    await writeFile(
      join(dir, 'semaphile.json'),
      JSON.stringify({
        version: 1,
        messaging: {
          backend: 'redis',
          redis: { urlEnv: 'SEMAPHILE_ACL_URL', namespace, store, readiness: 'warn' },
          clientDefaults: { configMismatch: 'error' },
        },
      }),
    );
  }
  const ok = async (which, args, input) => {
    const r = await run(configs[which], which ? receiver : sender, args, input);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  await ok(1, ['message', 'create', '--name', 'relay']);
  await ok(0, ['message', 'send', '--to', 'relay', '--body', 'restricted exchange']);
  const delivery = await ok(1, ['message', 'wait', '--as', 'relay', '--timeout', '2000']);
  assert.equal(delivery.message.body, 'restricted exchange');
  assert.equal(
    (await ok(1, ['message', 'ack', '--receipt-file', '-'], JSON.stringify(delivery))).status,
    'acked',
  );
  console.log(
    'PASS distinct restricted Redis credentials exchange across independently configured CLI processes',
  );
  for (const dir of configs) {
    assert.deepEqual(await readdir(dir), ['semaphile.json']);
  }
  console.log('PASS Redis-only configs create no local coordination files under one OS account');
  const restricted = await raw(sender);
  await assert.rejects(restricted.hGet('outside-store', 'meta'), /NOPERM/);
  await assert.rejects(restricted.publish('outside-channel', 'denied'), /NOPERM/);
  await assert.rejects(
    restricted.subscribe('outside-channel', () => {}),
    /NOPERM/,
  );
  console.log('PASS out-of-scope keys, publication channels, and subscription channels are denied');
  let warnings = [];
  const warn = await openRedisMessaging({
    url: sender,
    namespace,
    store,
    onReadinessWarning: (issues) => {
      warnings = issues;
    },
  });
  await warn.close();
  assert.ok(warnings.some((s) => s.includes('could not be inspected')));
  await assert.rejects(
    openRedisMessaging({ url: sender, namespace, store, readiness: 'strict' }),
    (e) => e.code === 'READINESS',
  );
  console.log('PASS denied CONFIG/INFO inspection warns in warn mode and rejects strict startup');
  const rootOnly = await account('root-only', [`~${key}`]);
  await assert.rejects(
    openRedisMessaging({ url: rootOnly, namespace, store, onReadinessWarning: () => {} }),
  );
  console.log('PASS a root-key grant alone cannot read computed store keys');
  const noChannel = await account('no-channel', [`~${key}`, `~${key}:*`], []);
  await assert.rejects(
    openRedisMessaging({
      url: noChannel,
      namespace,
      store,
      operationTimeoutMs: 2000,
      onReadinessWarning: () => {},
    }),
  );
  console.log('PASS missing notification-channel permission prevents startup');
  console.log('RESULT 6/6 passed');
} finally {
  for (const c of connections) {
    c.destroy();
  }
  for (const user of users) {
    await admin.sendCommand(['ACL', 'DELUSER', user]);
  }
  admin.destroy();
  await redis.close();
}
