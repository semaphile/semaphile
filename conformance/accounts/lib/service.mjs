// The run's own Redis: loopback only, default user disabled in the startup
// configuration, AOF always-fsync and noeviction. The controller alone holds
// the named administrator credential.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, chown, mkdir, open as openFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { open as respOpen, RespError } from './resp.mjs';
import { REDIS_VERSION } from './layout.mjs';

const ADMIN = 'sem3admin';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// serviceUser: undefined runs Redis as the controller; {uid,gid} uses setpriv.
export async function startRedis({ binary, directory, controllerDir, serviceUser, log }) {
  const port = await freePort();
  const password = randomBytes(24).toString('hex');
  const digest = createHash('sha256').update(password).digest('hex');
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const config = [
    'bind 127.0.0.1',
    `port ${port}`,
    'protected-mode yes',
    'daemonize no',
    `dir ${directory}`,
    'logfile ""',
    'save ""',
    'appendonly yes',
    'appendfsync always',
    'no-appendfsync-on-rewrite no',
    'appenddirname appendonlydir',
    'maxmemory 256mb',
    'maxmemory-policy noeviction',
    'enable-debug-command no',
    'enable-module-command no',
    'user default off',
    `user ${ADMIN} on #${digest} ~* &* +@all`,
    '',
  ].join('\n');
  const configFile = join(directory, 'redis.conf');
  await writeFile(configFile, config, { mode: 0o600 });
  const adminFile = join(controllerDir, 'admin.credential');
  await writeFile(adminFile, JSON.stringify({ user: ADMIN, password }), { mode: 0o600 });
  let file = binary,
    args = [configFile];
  if (serviceUser) {
    await chown(configFile, serviceUser.uid, serviceUser.gid);
    await chmod(directory, 0o700);
    await chown(directory, serviceUser.uid, serviceUser.gid);
    file = '/usr/bin/setpriv';
    args = [
      `--reuid=${serviceUser.uid}`,
      `--regid=${serviceUser.gid}`,
      '--clear-groups',
      '--inh-caps=-all',
      '--bounding-set=-all',
      '--no-new-privs',
      '--reset-env',
      '--',
      binary,
      configFile,
    ];
  }
  const logHandle = await openFile(join(controllerDir, 'redis.log'), 'wx', 0o600);
  const child = spawn(file, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin' },
  });
  const exited = once(child, 'exit');
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Redis readiness deadline: ' + output)), 30000);
    const receive = (data) => {
      output += data;
      void logHandle.write(data);
      if (output.includes('Ready to accept connections')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Redis exited ${code}: ${output}`));
    });
  });
  const admin = await respOpen({ host: '127.0.0.1', port });
  const auth = await admin.command('AUTH', ADMIN, password);
  if (auth !== 'OK') {
    throw new Error('Administrator AUTH failed');
  }
  const command = async (...args) => {
    const reply = await admin.command(...args);
    if (reply instanceof RespError) {
      throw reply;
    }
    return reply;
  };
  const infoMap = async (section) =>
    Object.fromEntries(
      (await command('INFO', section))
        .split('\r\n')
        .filter((line) => line.includes(':'))
        .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]),
    );
  const server = await infoMap('server');
  // Reject any endpoint that is not the process this controller started.
  if (
    // setpriv execs in place, so the Redis PID is the spawned PID either way.
    Number(server.process_id) !== child.pid ||
    Number(server.tcp_port) !== port ||
    server.redis_version !== REDIS_VERSION
  ) {
    throw new Error('Redis endpoint identity mismatch: ' + JSON.stringify(server));
  }
  const settings = {};
  for (const name of [
    'appendonly',
    'appendfsync',
    'no-appendfsync-on-rewrite',
    'maxmemory-policy',
    'bind',
    'protected-mode',
    'requirepass',
    'masterauth',
    'aclfile',
  ]) {
    const [, value] = await command('CONFIG', 'GET', name);
    settings[name] = value ?? null;
  }
  const persistence = await infoMap('persistence');
  log?.({ redis: 'started', port, pid: server.process_id });
  return {
    port,
    host: '127.0.0.1',
    pid: Number(server.process_id),
    password,
    configFile,
    adminFile,
    identity: {
      version: server.redis_version,
      runId: server.run_id,
      executable: server.executable,
      configFile: server.config_file,
      processId: Number(server.process_id),
      tcpPort: port,
      settings,
      persistence: {
        aof_enabled: persistence.aof_enabled,
        aof_last_write_status: persistence.aof_last_write_status,
        aof_last_bgrewrite_status: persistence.aof_last_bgrewrite_status,
      },
    },
    command,
    infoMap,
    async clientList() {
      return (await command('CLIENT', 'LIST'))
        .trim()
        .split('\n')
        .map((line) => Object.fromEntries(line.split(' ').map((pair) => pair.split('=', 2))))
        .filter((client) => client.user !== ADMIN)
        .map(({ id, name, user, addr, cmd, sub }) => ({ id, name, user, addr, cmd, sub }));
    },
    async aclUser(name) {
      const fields = await command('ACL', 'GETUSER', name);
      const out = {};
      for (let index = 0; index < fields.length; index += 2) {
        if (fields[index] !== 'passwords') {
          out[fields[index]] = fields[index + 1];
        }
      }
      return out;
    },
    async stop() {
      admin.close();
      child.kill('SIGTERM');
      await exited;
      await logHandle.close();
    },
  };
}
