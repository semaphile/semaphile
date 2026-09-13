import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  openMessaging,
  loadConfig,
  messagingOptions,
  info,
} from '../../packages/messaging/dist/src/index.js';
const root = resolve('.tmp/messaging');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(root + '/cli-');
const cli = resolve('packages/messaging/dist/src/cli.js');
const run = async (args, cwd = directory) => {
  const child = spawn(process.execPath, ['--no-warnings', cli, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '',
    err = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (err += b));
  const code = await new Promise((r, reject) => {
    child.once('error', reject);
    child.once('exit', r);
  });
  return { code, out, err };
};
let passed = 0;
async function scenario(label, fn) {
  await fn();
  console.log('PASS ' + label);
  passed++;
}
console.log(
  `platform=${process.platform} runtime=${process.version} bun=${globalThis.Bun?.version ?? '-'} store=${directory}`,
);
await scenario('init creates project config and is resumable without overwrite', async () => {
  const first = await run(['init']);
  assert.equal(first.code, 0, first.err);
  const original = await readFile(join(directory, 'semaphile.json'), 'utf8');
  assert.equal((await run(['init'])).code, 0);
  assert.equal(await readFile(join(directory, 'semaphile.json'), 'utf8'), original);
  assert.equal((await run(['init', '--directory', 'different'])).code, 4);
});
await scenario('nearest config and relative roots work from nested directories', async () => {
  const nested = join(directory, 'src', 'nested');
  await mkdir(nested, { recursive: true });
  const config = await loadConfig(nested);
  assert.equal(config.directory, join(directory, '.semaphile'));
  assert.equal((await run(['message', 'create', '--name', 'a'], nested)).code, 0);
  await writeFile(join(nested, 'semaphile.json'), '{invalid');
  await assert.rejects(loadConfig(nested));
  const explicit = await messagingOptions({ cwd: nested, store: '../../.semaphile/messaging' });
  assert.equal(explicit.open.path, join(directory, '.semaphile', 'messaging'));
});
await scenario('send wait and ack use durable receipt across CLI processes', async () => {
  const sent = await run([
    'message',
    'send',
    '--to',
    'a',
    '--body',
    'hello',
    '--correlation',
    'test',
  ]);
  assert.equal(sent.code, 0, sent.err);
  const received = await run(['message', 'wait', '--as', 'a', '--timeout', '1000']);
  assert.equal(received.code, 0, received.err);
  const envelope = JSON.parse(received.out);
  assert.equal(envelope.message.body, 'hello');
  const file = join(directory, 'receipt.json');
  await writeFile(file, received.out);
  const ack = await run(['message', 'ack', '--receipt-file', file]);
  assert.equal(ack.code, 0, ack.err);
  assert.equal(JSON.parse(ack.out).status, 'acked');
  assert.equal((await run(['message', 'wait', '--as', 'a', '--timeout', '10'])).code, 2);
  assert.equal((await run(['message', 'send', '--to', 'unknown', '--body', 'x'])).code, 5);
});
await scenario('info is observational and reports all persisted defaults', async () => {
  const c = await openMessaging({ path: join(directory, '.semaphile', 'messaging') });
  const before = await c.events();
  const result = await info({ cwd: directory });
  assert.equal(result.stores[0].config.claimTtlMs, 300000);
  assert.deepEqual(await c.events(), before);
  assert.deepEqual(await c.agents(), []);
  await c.close();
});
await scenario('file defaults warn and explicit error policy overrides them', async () => {
  const file = join(directory, 'semaphile.json'),
    config = JSON.parse(await readFile(file, 'utf8'));
  config.messaging.config.maxAttempts = 2;
  await writeFile(file, JSON.stringify(config));
  // --no-warnings suppresses the runtime warning here; effective settings remain inspectable.
  assert.equal((await run(['message', 'agents'])).code, 0);
  const error = await run(['message', 'agents', '--config-mismatch', 'error']);
  assert.equal(error.code, 4);
  assert.match(error.err, /CONFIG_MISMATCH|maxAttempts/);
  assert.equal((await run(['init'])).code, 4);
  const result = JSON.parse((await run(['info'])).out);
  assert.equal(result.stores[0].differences[0].field, 'maxAttempts');
});
await scenario(
  'configuration can initialize independent limiter and messaging stores',
  async () => {
    const project = join(directory, 'combined');
    await mkdir(project);
    await writeFile(
      join(project, 'semaphile.json'),
      JSON.stringify({
        version: 1,
        directory: './state',
        pools: { notion: { maxConcurrent: 5 } },
        messaging: {},
      }),
    );
    const initialized = await run(['init'], project);
    assert.equal(initialized.code, 0, initialized.err);
    const result = JSON.parse((await run(['info'], project)).out);
    assert.equal(result.stores.length, 2);
    assert.equal(result.stores[1].config.maxConcurrent, 5);
  },
);
await scenario(
  'malformed receipt JSON consistently reports input refusal without payloads',
  async () => {
    const file = join(directory, 'invalid-receipt.json');
    for (const contents of [
      'null',
      '42',
      'true',
      '"receipt"',
      '[]',
      '{}',
      '{"receipt":null}',
      '{"receipt":[]}',
      '{"deliveryId":42,"claimId":"x"}',
      '{"receipt":{"deliveryId":"x"}}',
      '{"private-canary":',
    ]) {
      await writeFile(file, contents);
      for (const action of ['ack', 'release', 'renew']) {
        const result = await run(['message', action, '--receipt-file', file]);
        assert.equal(result.code, 5, `${action}: ${result.err}`);
        assert.match(result.err, /MessagingError/);
        assert.ok(!result.err.includes('private-canary'));
        assert.ok(!result.err.includes('TypeError'));
      }
    }
  },
);

await scenario(
  'events rejects ignored options while preserving common options and filters',
  async () => {
    for (const key of ['reply-to', 'body', 'name', 'claim-ttl', 'pool', 'payload']) {
      const result = await run(['message', 'events', '--' + key, 'ignored']);
      assert.equal(result.code, 5, `${key}: ${result.err}`);
    }
    const result = await run([
      'message',
      'events',
      '--store',
      '.semaphile/messaging',
      '--config-mismatch',
      'error',
      '--after',
      '0',
      '--limit',
      '1',
      '--topic',
      'x',
      '--since',
      '0',
    ]);
    assert.equal(result.code, 0, result.err);
  },
);
console.log(`RESULT ${passed}/${passed} passed`);
