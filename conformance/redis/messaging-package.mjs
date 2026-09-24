import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, cp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { server } from './harness.mjs';
await mkdir('.tmp/redis', { recursive: true });
const root = await mkdtemp(resolve('.tmp/redis/messaging-package-')),
  repo = resolve('.');
const run = (command, args, cwd = root, env = process.env) =>
  new Promise((yes, no) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      no(Error('Installed consumer timeout'));
    }, 60000);
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      no(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        yes(output);
      } else {
        no(Error(output));
      }
    });
  });
const archives = [];
for (const name of ['messaging', 'redis']) {
  const [pack] = JSON.parse(
    await run(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
      join(repo, 'packages', name),
    ),
  );
  archives.push(join(root, pack.filename));
}
await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
await run('npm', [
  'install',
  '--offline',
  '--ignore-scripts',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
  ...archives,
]);
const installed = join(root, 'node_modules/@semaphile');
await mkdir(join(root, 'node_modules/@types'), { recursive: true });
await cp('packages/messaging/node_modules/@types/node', join(root, 'node_modules/@types/node'), {
  recursive: true,
});
await cp('packages/messaging/node_modules/undici-types', join(root, 'node_modules/undici-types'), {
  recursive: true,
});
await writeFile(
  join(root, 'consumer.ts'),
  `
import {openRedisMessaging} from '@semaphile/redis/messaging';
import {encodeAgentMessage,validateAnswer} from '@semaphile/messaging/agent-messages';
const client=await openRedisMessaging({url:process.env.TEST_REDIS!,namespace:'installed',store:process.env.TEST_STORE!,onReadinessWarning:()=>{}});
const sub=await client.subscribe('relay',{topics:['q']});
const question={version:1 as const,type:'question' as const,question:'Which?',options:[{id:'a',label:'A'}]};
validateAnswer(question,{version:1,type:'answer',selectedOptionId:'a'});
await client.publish({topic:'q',body:encodeAgentMessage(question)});
const delivery=await sub.wait({timeoutMs:2000});
if(!delivery||delivery.message.body!==encodeAgentMessage(question))throw new Error('Missing publication');
await client.ack(delivery.receipt);await client.close();
if(false){
// @ts-expect-error missing required option label
encodeAgentMessage({version:1,type:'question',question:'?',options:[{id:'a'}]});
// @ts-expect-error missing required namespace
await openRedisMessaging({url:'redis://localhost',store:'x'});
}
`,
);
await writeFile(
  join(root, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmitOnError: true,
      types: ['node'],
      outDir: 'compiled',
    },
    include: ['consumer.ts'],
  }),
);
await run(process.execPath, [
  resolve('packages/messaging/node_modules/typescript/bin/tsc'),
  '--project',
  'tsconfig.json',
]);
console.log('PASS independent installed consumer checks Redis messaging and agent payload types');
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
await rm(join(installed, 'core'), { recursive: true, force: true });
const redis = await server();
try {
  await run(process.execPath, ['compiled/consumer.js'], root, {
    ...process.env,
    TEST_REDIS: redis.url,
    TEST_STORE: root,
  });
  console.log(
    'PASS installed Redis client publishes and acknowledges with SQLite native and core modules removed',
  );
  const out = await run(
    process.execPath,
    [
      '--no-warnings',
      'node_modules/@semaphile/messaging/dist/src/cli.js',
      'message',
      'subscriptions',
      '--redis-url-env',
      'TEST_REDIS',
      '--namespace',
      'installed',
      '--messaging-store',
      root,
    ],
    root,
    { ...process.env, TEST_REDIS: redis.url },
  );
  assert.equal(JSON.parse(out)[0].name, 'relay');
  console.log(
    'PASS installed Redis CLI works without SQLite implementation files or a config directory',
  );
  const manifest = JSON.parse(await readFile(join(installed, 'redis/package.json'), 'utf8'));
  assert.equal(manifest.scripts.install, undefined);
  console.log('RESULT 3/3 passed');
} finally {
  await redis.close();
}
