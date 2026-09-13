// Each suite owns its Redis server/container; readiness blocks on log output.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { normalizePoolConfig } from '../../packages/core/dist/src/client.js';
export const { createClient } = createRequire(
  new URL('../../packages/redis/package.json', import.meta.url),
)('@redis/client');
export const script = (
  await readFile(new URL('../../packages/redis/src/protocol.lua', import.meta.url), 'utf8')
).replace(
  '-- semaphile-control-module',
  await readFile(new URL('../../packages/redis/src/control.lua', import.meta.url), 'utf8'),
);
export const config = (extra = {}) => {
  const { ownerTimeoutMs = 2000, ...pool } = extra;
  return JSON.stringify({
    ...normalizePoolConfig({
      maxConcurrent: 5,
      expirationMs: null,
      minTime: 0,
      reservoir: null,
      reservoirRefreshAmount: null,
      reservoirRefreshInterval: null,
      ...pool,
    }),
    ownerTimeoutMs,
  });
};
export const key = () => `semaphile-test:${randomUUID()}`;
export async function connect(url) {
  const client = createClient({
    url,
    socket: { reconnectStrategy: false, connectTimeout: 3000 },
    disableOfflineQueue: true,
  });
  client.on('error', () => {});
  await client.connect();
  return client;
}
export async function owner(url, pool, settings = config()) {
  const client = await connect(url),
    id = randomUUID();
  let sequence = 0;
  const invoke = async (action, input = {}, seq = ++sequence) =>
    JSON.parse(
      await client.sendCommand([
        'EVAL',
        script,
        '2',
        pool,
        pool + ':notify',
        action,
        id,
        String(seq),
        settings,
        JSON.stringify(input),
      ]),
    );
  try {
    await invoke('open');
  } catch (error) {
    client.destroy();
    throw error;
  }
  return {
    client,
    id,
    invoke,
    destroy() {
      if (client.isOpen) {
        client.destroy();
      }
    },
  };
}
export async function server() {
  if (process.env.SEMAPHILE_REDIS_TEST_URL) {
    return { url: process.env.SEMAPHILE_REDIS_TEST_URL, close: async () => {} };
  }
  await mkdir('.tmp/redis', { recursive: true });
  const directory = resolve(await mkdtemp('.tmp/redis/run-'));
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
  const command = process.platform === 'linux' ? 'docker' : 'redis-server';
  const name = 'semaphile-' + randomUUID();
  const args =
    command === 'docker'
      ? [
          'run',
          '--rm',
          '--name',
          name,
          '-p',
          `127.0.0.1:${port}:6379`,
          'redis:8.4.0-alpine',
          'redis-server',
          '--save',
          '',
          '--appendonly',
          'no',
        ]
      : [
          '--bind',
          '127.0.0.1',
          '--port',
          String(port),
          '--save',
          '',
          '--appendonly',
          'no',
          '--dir',
          directory,
        ];
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    await new Promise((yes, no) => {
      let output = '';
      const timer = setTimeout(() => no(new Error('Redis startup timed out: ' + output)), 30000);
      const receive = (data) => {
        output += data;
        if (output.includes('Ready to accept connections')) {
          clearTimeout(timer);
          yes();
        }
      };
      child.stdout.on('data', receive);
      child.stderr.on('data', receive);
      child.once('error', (error) => {
        clearTimeout(timer);
        no(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        no(new Error(`Redis exited ${code}: ${output}`));
      });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    url: `redis://127.0.0.1:${port}`,
    async close() {
      if (command === 'docker') {
        const stop = spawn('docker', ['stop', '--time', '2', name], { stdio: 'ignore' });
        await once(stop, 'exit');
      } else {
        child.kill('SIGTERM');
      }
      await exited;
    },
  };
}
