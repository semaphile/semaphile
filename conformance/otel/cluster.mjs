// A real three-primary Redis Cluster, including discovery across hash slots.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { openLimiter } from '../../packages/redis/dist/index.js';
import { openObservationSource, poolKey } from '../../packages/redis/dist/observation.js';
const { createCluster, createClient } = createRequire(
  new URL('../../packages/redis/package.json', import.meta.url),
)('@redis/client');
const nodes = [],
  pools = [];
let source, cluster;
const port = async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return value;
};
try {
  await mkdir('.tmp/otel', { recursive: true });
  for (let i = 0; i < 3; i++) {
    const directory = await mkdtemp(resolve('.tmp/otel/cluster-')),
      listen = await port(),
      bus = await port(),
      name = `semaphile-otel-${randomUUID()}`;
    const args = [
      '--port',
      String(listen),
      '--cluster-enabled',
      'yes',
      '--cluster-port',
      String(bus),
      '--cluster-announce-ip',
      '127.0.0.1',
      '--cluster-announce-port',
      String(listen),
      '--cluster-announce-bus-port',
      String(bus),
      '--cluster-config-file',
      'nodes.conf',
      '--appendonly',
      'no',
      '--save',
      '',
      '--bind',
      '127.0.0.1',
    ];
    const child =
      process.platform === 'linux'
        ? spawn(
            'docker',
            [
              'run',
              '--rm',
              '--network',
              'host',
              '--name',
              name,
              '-v',
              `${directory}:/data`,
              'redis:8.4.0-alpine',
              'redis-server',
              ...args,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          )
        : spawn('redis-server', [...args, '--dir', directory], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
    let logs = '';
    const listeners = new Set();
    const update = (chunk) => {
      logs += chunk;
      for (const listener of listeners) {
        listener();
      }
    };
    child.stdout.on('data', update);
    child.stderr.on('data', update);
    const node = {
      child,
      name,
      listen,
      bus,
      exited: once(child, 'exit'),
      client: undefined,
      wait: (pattern) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            listeners.delete(check);
            reject(Error(`Cluster timeout: ${logs.slice(-1500)}`));
          }, 30000);
          const check = () => {
            if (logs.includes(pattern)) {
              clearTimeout(timer);
              listeners.delete(check);
              resolve();
            }
          };
          listeners.add(check);
          check();
        }),
    };
    nodes.push(node);
    await node.wait('Ready to accept connections');
    node.client = createClient({ url: `redis://127.0.0.1:${listen}` });
    node.client.on('error', () => {});
    await node.client.connect();
  }
  for (let i = 0; i < 3; i++) {
    await nodes[i].client.sendCommand(['CLUSTER', 'SET-CONFIG-EPOCH', String(i + 1)]);
    await nodes[i].client.sendCommand([
      'CLUSTER',
      'ADDSLOTSRANGE',
      String(Math.floor((i * 16384) / 3)),
      String(Math.floor(((i + 1) * 16384) / 3) - 1),
    ]);
    for (let j = 0; j < 3; j++) {
      if (i !== j) {
        await nodes[i].client.sendCommand([
          'CLUSTER',
          'MEET',
          '127.0.0.1',
          String(nodes[j].listen),
          String(nodes[j].bus),
        ]);
      }
    }
  }
  await Promise.all(nodes.map((node) => node.wait('Cluster state changed: ok')));
  const rootUrls = nodes.map((node) => `redis://127.0.0.1:${node.listen}`);
  cluster = createCluster({ rootNodes: rootUrls.map((url) => ({ url })) });
  cluster.on('error', () => {});
  await cluster.connect();
  const namespace = randomUUID(),
    servers = new Set(),
    names = [];
  for (let i = 0; servers.size < 3 && i < 100; i++) {
    const name = `pool-${i}`,
      node = await cluster.getNodeClientForKey(poolKey(namespace, name));
    const serverId = await node.sendCommand(['CLUSTER', 'MYID']);
    if (servers.has(serverId)) {
      continue;
    }
    const owner = await Promise.all(
      nodes.map(async (candidate) => ({
        candidate,
        id: await candidate.client.sendCommand(['CLUSTER', 'MYID']),
      })),
    );
    const found = owner.find((candidate) => candidate.id === serverId).candidate;
    pools.push(
      await openLimiter({
        url: `redis://127.0.0.1:${found.listen}`,
        namespace,
        pool: name,
        config: { maxConcurrent: 2 },
      }),
    );
    servers.add(serverId);
    names.push(name);
  }
  assert.equal(servers.size, 3);
  source = await openObservationSource({ rootUrls, namespace });
  assert.deepEqual((await source.discover()).sort(), names.sort());
  console.log('PASS real Redis Cluster discovers metadata on all three primary nodes');
  for (const name of names) {
    const observer = await source.open(name, randomUUID());
    try {
      assert.equal((await observer.sample()).maxConcurrent, 2);
    } finally {
      await observer.close();
    }
  }
  console.log('PASS registration and read-only projection route within each pool hash slot');
} finally {
  await source?.close();
  await Promise.allSettled(pools.map((pool) => pool.close()));
  cluster?.destroy();
  for (const node of nodes) {
    node.client?.destroy();
    if (process.platform === 'linux') {
      const stop = spawn('docker', ['stop', '--time', '1', node.name], { stdio: 'ignore' });
      await once(stop, 'exit');
    } else {
      node.child.kill('SIGTERM');
    }
    await node.exited;
  }
}
console.log('RESULT 2/2 passed');
