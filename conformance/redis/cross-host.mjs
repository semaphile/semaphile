// Tunnel only to loopback ports. Both application hosts share one real Redis
// and HTTP fixture; the test driver owns neither application admission queue.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { server, key } from './harness.mjs';
const host = process.env.SEMAPHILE_TEST_SSH_HOST;
const remote = process.env.SEMAPHILE_TEST_REMOTE_REPO;
if (!host || !remote) {
  throw new Error('Set SEMAPHILE_TEST_SSH_HOST and SEMAPHILE_TEST_REMOTE_REPO (absolute path)');
}
const redis = await server();
let active = 0,
  peak = 0,
  completed = 0,
  overlap = false;
const capacityBarrier = [];
let capacityProved = false;
const activeHosts = new Map(),
  first = [],
  sockets = new Set();
const http = createServer((request, response) => {
  const label = request.headers['x-worker'];
  active++;
  peak = Math.max(peak, active);
  activeHosts.set(label, (activeHosts.get(label) ?? 0) + 1);
  if (activeHosts.size > 1) {
    overlap = true;
  }
  const finish = () =>
    setTimeout(() => {
      active--;
      completed++;
      const left = activeHosts.get(label) - 1;
      if (left) {
        activeHosts.set(label, left);
      } else {
        activeHosts.delete(label);
      }
      response.end('ok');
    }, 80);
  if (request.url.includes('first=1')) {
    first.push(finish);
    if (first.length === 2) {
      for (const start of first.splice(0)) {
        start();
      }
    }
  } else if (!capacityProved) {
    // Hold the first full batch until all five slots are in use. A fixed
    // response delay alone cannot guarantee saturation over a slow tunnel.
    capacityBarrier.push(finish);
    if (capacityBarrier.length === 5) {
      capacityProved = true;
      for (const start of capacityBarrier.splice(0)) {
        start();
      }
    }
  } else {
    finish();
  }
});
http.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
http.listen(0, '127.0.0.1');
await once(http, 'listening');
const redisPort = new URL(redis.url).port,
  httpPort = String(http.address().port);
const tunnel = spawn(
  'ssh',
  [
    '-NT',
    '-o',
    'ExitOnForwardFailure=yes',
    '-R',
    `127.0.0.1:0:127.0.0.1:${redisPort}`,
    '-R',
    `127.0.0.1:0:127.0.0.1:${httpPort}`,
    host,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const tunnelExit = once(tunnel, 'exit');
const children = [];
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  const ports = await new Promise((resolvePorts, reject) => {
    let output = '';
    const map = new Map();
    const timer = setTimeout(() => reject(new Error('Tunnel startup timeout: ' + output)), 15000);
    tunnel.stderr.on('data', (data) => {
      output += data;
      for (const match of output.matchAll(
        /Allocated port (\d+) for remote forward to 127\.0\.0\.1:(\d+)/g,
      )) {
        map.set(match[2], match[1]);
      }
      if (map.has(redisPort) && map.has(httpPort)) {
        clearTimeout(timer);
        resolvePorts(map);
      }
    });
    tunnel.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    tunnel.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Tunnel exited: ' + output));
    });
  });
  function launch(command, args, env) {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    return new Promise((yes, no) => {
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        no(new Error('Cross-host worker timed out: ' + output));
      }, 30000);
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        no(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          yes();
        } else {
          no(new Error(`Worker exit ${code}: ${output}`));
        }
      });
    });
  }
  const localBun = process.env.SEMAPHILE_TEST_LOCAL_BUN
    ? resolve(process.env.SEMAPHILE_TEST_LOCAL_BUN)
    : 'bun';
  const remoteBun = process.env.SEMAPHILE_TEST_REMOTE_BUN ?? 'bun';
  for (const [localRuntime, remoteRuntime, label] of [
    [process.execPath, remoteBun, 'macOS Node / Linux Bun'],
    [localBun, 'node', 'macOS Bun / Linux Node'],
  ]) {
    active = 0;
    peak = 0;
    completed = 0;
    overlap = false;
    capacityProved = false;
    const pool = key(),
      common = {
        POOL: pool,
        CONFIG: JSON.stringify({ maxConcurrent: 5 }),
        OWNER_TIMEOUT: '6000',
        FIRST_JOB_BARRIER: '1',
        MODE: 'jobs',
      };
    const localEnv = {
      ...process.env,
      ...common,
      REDIS_URL: redis.url,
      HTTP_URL: `http://127.0.0.1:${httpPort}`,
      WORKER_LABEL: 'macOS',
    };
    const remoteEnv = {
      ...common,
      REDIS_URL: `redis://127.0.0.1:${ports.get(redisPort)}`,
      HTTP_URL: `http://127.0.0.1:${ports.get(httpPort)}`,
      WORKER_LABEL: 'Linux',
    };
    const command = `cd ${quote(remote)} && ${Object.entries(remoteEnv)
      .map(([name, value]) => `${name}=${quote(value)}`)
      .join(' ')} ${quote(remoteRuntime)} conformance/redis/worker.mjs`;
    await Promise.all([
      launch(localRuntime, ['conformance/redis/worker.mjs'], localEnv),
      launch('ssh', [host, command], process.env),
    ]);
    assert.equal(completed, 20);
    assert.equal(peak, 5);
    assert.equal(overlap, true);
    console.log(`PASS ${label}: requests=${completed} peak=${peak} hostsOverlap=${overlap}`);
  }
  console.log('RESULT 2/2 passed');
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  tunnel.kill();
  await tunnelExit;
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise((resolveClose) => http.close(resolveClose));
  await redis.close();
}
