import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { server } from '../redis/harness.mjs';
import { assertBinaryTarget } from '../../packages/core/native-artifact.mjs';
const archives = process.env.SEMAPHILE_CANDIDATE_DIR;
const oldArchive = process.env.SEMAPHILE_020_MESSAGING_ARCHIVE;
assert.ok(
  archives && oldArchive,
  'Set SEMAPHILE_CANDIDATE_DIR and SEMAPHILE_020_MESSAGING_ARCHIVE',
);
console.log(
  `platform=${process.platform} arch=${process.arch} uid=${process.getuid()} node=${process.version} bun=${process.versions.bun ?? '-'} source=${process.env.SEMAPHILE_TESTED_COMMIT ?? 'unrecorded'}`,
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir('.tmp/release', { recursive: true });
const root = await mkdtemp(resolve('.tmp/release/candidate-'));
function run(command, args, cwd = root, env = process.env, expected = 0) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, expected, `${command}: ${r.stdout}\n${r.stderr}\n${r.error ?? ''}`);
  return r.stdout;
}
const names = ['core', 'redis', 'messaging', 'otel'];
const paths = names.map((name) => resolve(archives, `semaphile-${name}-0.3.0.tgz`));
const originalHashes = new Map();
for (const path of paths) {
  const hash = sha(await readFile(path));
  originalHashes.set(path, hash);
  console.log(`archive=${path} sha256=${hash}`);
}
const app = join(root, 'app'),
  old = join(root, 'old');
for (const dir of [app, old]) {
  await mkdir(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
}
run(
  'npm',
  ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', ...paths],
  app,
);
const installed = join(app, 'node_modules/@semaphile');
for (const name of names) {
  const m = JSON.parse(await readFile(join(installed, name, 'package.json'), 'utf8'));
  assert.equal(m.version, '0.3.0');
  assert.equal(m.scripts.install, undefined);
  assert.equal(m.scripts.postinstall, undefined);
  for (const [peer, version] of Object.entries(m.peerDependencies ?? {})) {
    if (peer.startsWith('@semaphile/')) {
      assert.equal(version, '0.3.0');
      assert.ok(names.includes(peer.slice(11)));
    }
  }
  assert.ok(!JSON.stringify(m).includes('@semaphile/proxy'));
  assert.ok(!JSON.stringify(m.exports).includes('http-policy'));
  if (name === 'core' || name === 'messaging') {
    for (const target of ['darwin-arm64', 'linux-x64']) {
      const native = join(installed, name, 'dist/native');
      const bytes = await readFile(join(native, target + '.node'));
      const meta = JSON.parse(await readFile(join(native, target + '.json'), 'utf8'));
      assert.equal(meta.binarySha256, sha(bytes));
      assert.equal(meta.target, target);
      assertBinaryTarget(bytes, target);
      console.log(
        `native=${name}/${target} sourceSha256=${meta.sourceSha256} binarySha256=${meta.binarySha256}`,
      );
    }
  }
}
console.log('PASS four exact archives have matching versions/peers and both real native targets');
await writeFile(
  join(app, 'local.mjs'),
  `
import assert from 'node:assert/strict';
import {openLimiter} from '@semaphile/core';
import {openLimiter as openMemoryLimiter} from '@semaphile/core/memory';
import {openMessaging} from '@semaphile/messaging';
import {createMessagingInstrumentation} from '@semaphile/otel/messaging';
assert.equal(typeof createMessagingInstrumentation,'function');
const limiter=await openLimiter({path:'./limiter',config:{maxConcurrent:1}});
assert.equal(await limiter.schedule(()=>42),42);await limiter.close();
const memory=await openMemoryLimiter({key:'installed',config:{maxConcurrent:1}});assert.equal(await memory.schedule(()=>43),43);await memory.close();
const bus=await openMessaging({path:'./messages'});const sub=await bus.subscribe('consumer',{topics:['event']});
await bus.publish({topic:'event',body:'installed'});const d=await sub.wait({timeoutMs:2000});assert.equal(d.message.body,'installed');await bus.ack(d.receipt);await bus.close();
for(const path of ['@semaphile/proxy','@semaphile/core/http-policy','@semaphile/core/http-policy.js'])await assert.rejects(import(path));
`,
);
run(process.execPath, ['--no-warnings', 'local.mjs'], app);
const cli = join(installed, 'messaging/dist/src/cli.js');
assert.doesNotMatch(run(process.execPath, [cli, '--help'], app), /\bproxy\b|http-policy/);
run(process.execPath, [cli, 'proxy', 'http'], app, process.env, 5);
console.log('PASS installed core, memory, SQLite topics, OTel entry and proxy exclusions');
await mkdir(join(app, 'node_modules/@types'), { recursive: true });
for (const [source, destination] of [
  ['packages/core/node_modules/@types/node', 'node_modules/@types/node'],
  ['packages/core/node_modules/undici-types', 'node_modules/undici-types'],
  ['conformance/typescript/consumer.ts', 'core-consumer.ts'],
  ['conformance/messaging/consumer.ts', 'messaging-consumer.ts'],
]) {
  await cp(source, join(app, destination), { recursive: true });
}
run(
  process.execPath,
  [
    resolve('packages/core/node_modules/typescript/bin/tsc'),
    '--strict',
    '--noEmit',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    'core-consumer.ts',
    'messaging-consumer.ts',
  ],
  app,
);
console.log('PASS strict installed core and messaging consumer types');
console.log(`oldArchiveSha256=${sha(await readFile(oldArchive))}`);
run(
  'npm',
  [
    'install',
    '--offline',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    resolve(oldArchive),
  ],
  old,
);
assert.equal(
  JSON.parse(await readFile(join(old, 'node_modules/@semaphile/messaging/package.json'))).version,
  '0.2.0',
);
const store = join(root, 'upgrade-store');
await writeFile(
  join(old, 'fixture.mjs'),
  `
import {writeFile} from 'node:fs/promises';import {openMessaging,inspectStore} from '@semaphile/messaging';
const bus=await openMessaging({path:process.env.TEST_STORE});await bus.createMailbox('relay');
const sent=await bus.send({to:'relay',body:'preserved',dedupeKey:'stable',trace:{traceparent:'00-11111111111111111111111111111111-2222222222222222-01'}});
const claimed=(await bus.receive('relay'))[0];await bus.send({to:'relay',body:'pending'});await bus.close();
await writeFile(process.env.TEST_STATE,JSON.stringify({sent,claimed,format:(await inspectStore(process.env.TEST_STORE)).format}));
`,
);
const state = join(root, 'old-state.json');
const env = { ...process.env, TEST_STORE: store, TEST_STATE: state };
run(process.execPath, ['--no-warnings', 'fixture.mjs'], old, env);
assert.equal(JSON.parse(await readFile(state)).format, 'semaphile-messaging/1.1');
const upgrade = JSON.parse(
  run(process.execPath, ['--no-warnings', cli, 'message', 'upgrade', '--store', store], app),
);
assert.equal(upgrade.format, 'semaphile-messaging/1.2');
await writeFile(
  join(app, 'upgrade.mjs'),
  `
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {openMessaging} from '@semaphile/messaging';
const old=JSON.parse(await readFile(process.env.TEST_STATE));const bus=await openMessaging({path:process.env.TEST_STORE});
assert.equal((await bus.send({to:'relay',body:'preserved',dedupeKey:'stable'})).id,old.sent.id);
assert.equal((await bus.ack(old.claimed.receipt)).status,'acked');
assert.equal((await bus.history()).find(m=>m.id===old.sent.id).trace.traceparent,'00-11111111111111111111111111111111-2222222222222222-01');
const d=(await bus.receive('relay'))[0];assert.equal(d.message.body,'pending');await bus.ack(d.receipt);await bus.close();
`,
);
run(process.execPath, ['--no-warnings', 'upgrade.mjs'], app, env);
console.log(
  'PASS real 0.2.0 store upgraded through installed candidate CLI preserves pending data, trace, dedupe and receipt',
);
await rm(join(installed, 'core'), { recursive: true, force: true });
await rm(join(installed, 'messaging/dist/native'), { recursive: true, force: true });
for (const name of [
  'database',
  'native',
  'native-path',
  'coordinator',
  'inspect-worker',
  'client',
]) {
  await rm(join(installed, `messaging/dist/src/${name}.js`), { force: true });
}
await writeFile(
  join(app, 'remote.mjs'),
  `
import assert from 'node:assert/strict';import {openRedisMessaging} from '@semaphile/redis/messaging';
import {encodeAgentMessage} from '@semaphile/messaging/agent-messages';
const c=await openRedisMessaging({url:process.env.TEST_REDIS,namespace:'candidate',store:process.env.TEST_REMOTE_STORE,onReadinessWarning:()=>{}});
await c.createMailbox('relay');await c.send({to:'relay',body:encodeAgentMessage({version:1,type:'answer',selectedOptionId:'yes'})});
const d=await c.wait('relay',{timeoutMs:2000});assert.ok(d);await c.ack(d.receipt);await c.close();
`,
);
const redis = await server();
try {
  const remoteEnv = { ...process.env, TEST_REDIS: redis.url, TEST_REMOTE_STORE: randomUUID() };
  run(process.execPath, ['--no-warnings', 'remote.mjs'], app, remoteEnv);
  run(
    process.execPath,
    [
      '--no-warnings',
      cli,
      'message',
      'agents',
      '--redis-url-env',
      'TEST_REDIS',
      '--namespace',
      'candidate',
      '--messaging-store',
      remoteEnv.TEST_REMOTE_STORE,
    ],
    app,
    remoteEnv,
  );
  console.log(
    'PASS exact-archive Redis library and CLI work with SQLite/native components removed only from installed copy',
  );
} finally {
  await redis.close();
}
for (const path of paths) {
  const hash = sha(await readFile(path));
  assert.equal(hash, originalHashes.get(path), 'Candidate archive changed during test');
  console.log(`unchangedArchive=${path} sha256=${hash}`);
}
console.log('RESULT 5/5 passed');
