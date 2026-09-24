import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import {
  openMessaging,
  upgradeMessaging,
  inspectStore,
} from '../../packages/messaging/dist/src/index.js';
await mkdir('.tmp/messaging', { recursive: true });
const root = await mkdtemp(resolve('.tmp/messaging/upgrade-'));
const path = join(root, 'store');
let client = await openMessaging({ path });
await client.createMailbox('worker');
const pending = await client.send({ to: 'worker', body: 'pending', dedupeKey: 'stable' });
const claimed = (await client.receive('worker'))[0];
await client.send({ to: 'worker', body: 'second' });
await client.close();
const downgrade = () => {
  const db = new DatabaseSync(join(path, 'state.sqlite'));
  db.exec(
    "DROP TABLE subscription_topics; DROP TABLE subscriptions; ALTER TABLE messages DROP COLUMN trace; UPDATE config SET format='semaphile-messaging/1.0';",
  );
  db.close();
};
const snapshot = () => {
  const db = new DatabaseSync(join(path, 'state.sqlite'));
  try {
    return Object.fromEntries(
      ['messages', 'deliveries', 'agents', 'mailboxes', 'events'].map((name) => [
        name,
        db
          .prepare(`SELECT * FROM ${name}`)
          .all()
          .map(({ trace: _trace, ...row }) => row),
      ]),
    );
  } finally {
    db.close();
  }
};
downgrade();
const before = snapshot();
await assert.rejects(openMessaging({ path }), /Unsupported messaging store format/);
assert.equal((await inspectStore(path)).format, 'semaphile-messaging/1.0');
assert.deepEqual(snapshot(), before);
console.log('PASS ordinary open rejects 1.0 without migrating or changing messages');
// Inject a crash into a private copy, after ALTER but before format update/COMMIT.
const copy = join(root, 'package');
await cp(resolve('packages/messaging/dist'), join(copy, 'dist'), { recursive: true });
await writeFile(join(copy, 'package.json'), JSON.stringify({ type: 'module' }));
const worker = join(copy, 'dist/src/inspect-worker.js');
await writeFile(
  worker,
  "import { writeSync } from 'node:fs';\n" +
    (await readFile(worker, 'utf8')).replace(
      "db.exec('ALTER TABLE messages ADD COLUMN trace TEXT;');",
      "db.exec('ALTER TABLE messages ADD COLUMN trace TEXT;'); writeSync(1, 'after-alter\\n'); process.kill(process.pid, 'SIGSTOP');",
    ),
);
const entry = join(root, 'upgrade-child.mjs');
await writeFile(
  entry,
  `import {upgradeMessaging} from ${JSON.stringify(pathToFileURL(join(copy, 'dist/src/index.js')).href)}; await upgradeMessaging({path:${JSON.stringify(path)}});`,
);
const child = spawn(process.execPath, ['--no-warnings', entry], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const exited = once(child, 'exit');
try {
  await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => {
      throw Error('Upgrade child exited before injected crash');
    }),
  ]);
  child.kill('SIGKILL');
  await exited;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}
assert.equal((await inspectStore(path)).format, 'semaphile-messaging/1.0');
assert.deepEqual(snapshot(), before);
console.log('PASS interrupted offline ALTER rolls back and preserves old schema and records');
assert.equal((await upgradeMessaging({ path })).format, 'semaphile-messaging/1.2');
assert.deepEqual(snapshot(), before);
client = await openMessaging({ path });
try {
  assert((await client.history()).every((message) => message.trace === undefined));
  assert.equal(
    (await client.send({ to: 'worker', body: 'pending', dedupeKey: 'stable' })).id,
    pending.id,
  );
  assert.equal((await client.ack(claimed.receipt)).status, 'acked');
  const registration = await client.register('worker');
  await assert.rejects(upgradeMessaging({ path }), /Stop registered clients/);
  await client.unregister(registration.id);
} finally {
  await client.close();
}
assert.equal((await upgradeMessaging({ path })).format, 'semaphile-messaging/1.2');
console.log(
  'PASS upgrade preserves dedupe and valid receipts, rejects live registrations, and is idempotent',
);
// A 1.1 store already has trace columns. Preserve them and its valid receipts.
client = await openMessaging({ path });
await client.createMailbox('@subscription:legacy');
const carrier = { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' };
await client.send({ to: '@subscription:legacy', body: 'trace survives', trace: carrier });
const legacyClaim = (await client.receive('@subscription:legacy'))[0];
await client.close();
const db11 = new DatabaseSync(join(path, 'state.sqlite'));
db11.exec(
  "DROP TABLE subscription_topics; DROP TABLE subscriptions; UPDATE config SET format='semaphile-messaging/1.1';",
);
db11.close();
const prior11 = snapshot();
await assert.rejects(openMessaging({ path }), /Unsupported messaging store format/);
await writeFile(
  worker,
  "import { writeSync } from 'node:fs';\n" +
    (await readFile('packages/messaging/dist/src/inspect-worker.js', 'utf8')).replace(
      'db.exec(TOPICS_SCHEMA);',
      "db.exec(TOPICS_SCHEMA); writeSync(1, 'after-topics\\n'); process.kill(process.pid, 'SIGSTOP');",
    ),
);
const child11 = spawn(process.execPath, ['--no-warnings', entry], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const exited11 = once(child11, 'exit');
try {
  await Promise.race([
    once(child11.stdout, 'data'),
    exited11.then(() => {
      throw Error('Upgrade exited before topic-schema crash');
    }),
  ]);
  child11.kill('SIGKILL');
  await exited11;
} finally {
  if (child11.exitCode === null && child11.signalCode === null) {
    child11.kill('SIGKILL');
    await exited11;
  }
}
assert.equal((await inspectStore(path)).format, 'semaphile-messaging/1.1');
assert.deepEqual(snapshot(), prior11);
console.log('PASS interrupted topic-schema upgrade rolls back to usable 1.1 records');
assert.equal((await upgradeMessaging({ path })).format, 'semaphile-messaging/1.2');
assert.deepEqual(snapshot(), prior11);
client = await openMessaging({ path });
try {
  assert.deepEqual((await client.history({ recipient: '@subscription:legacy' }))[0].trace, carrier);
  assert.equal((await client.ack(legacyClaim.receipt)).status, 'acked');
  const agent = await client.register('@subscription:legacy');
  await client.unregister(agent.id);
} finally {
  await client.close();
}
console.log('PASS explicit 1.1 upgrade preserves existing records without adding trace twice');
console.log('RESULT 5/5 passed');
