// Starts participants as fixture identities and speaks the line protocol.
// Barriers are request/reply pairs over the controller-owned pipes.
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { byRole, paths } from './layout.mjs';

const participantScript = fileURLToPath(new URL('../participant.mjs', import.meta.url));

// mode: 'sudo' (macOS), 'setpriv' (Linux container), 'dev' (same UID; never evidence).
export function command(mode, account, runtime, { prefix, runner, devRuntimes } = {}) {
  const layout = paths(prefix);
  if (mode === 'sudo') {
    return ['/usr/bin/sudo', ['-n', '-u', account.name, runner ?? layout.runner, runtime]];
  }
  if (mode === 'setpriv') {
    return [
      '/usr/bin/setpriv',
      [
        `--reuid=${account.uid}`,
        `--regid=${account.gid}`,
        '--init-groups',
        '--inh-caps=-all',
        '--bounding-set=-all',
        '--no-new-privs',
        '--reset-env',
        '--',
        runner ?? layout.runner,
        runtime,
      ],
    ];
  }
  if (mode === 'dev') {
    return [devRuntimes[runtime], [participantScript]];
  }
  throw new Error('Unknown launch mode ' + mode);
}

export class Participant extends EventEmitter {
  constructor({ mode, role, runtime, prefix, runner, devRuntimes, log, stdin = 'pipe' }) {
    super();
    this.role = role;
    this.account = byRole[role];
    this.runtime = runtime;
    this.log = log;
    this.next = 0;
    this.waiting = new Map();
    this.stderr = '';
    const [file, args] = command(mode, this.account, runtime, { prefix, runner, devRuntimes });
    this.argv = [file, ...args];
    const env =
      mode === 'dev'
        ? {
            PATH: '/usr/bin:/bin',
            HOME: paths(prefix).home(this.account.name),
            SEM3_DEV_PREFIX: prefix,
            SEM3_DEV_ACCOUNT: this.account.name,
            ...(runtime === 'bun' ? { BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' } : {}),
          }
        : { PATH: '/usr/bin:/bin', LANG: 'C' };
    this.child = spawn(file, args, {
      cwd: mode === 'dev' ? paths(prefix).home(this.account.name) : '/',
      env,
      stdio: [stdin, 'pipe', 'pipe'],
      // A new session has no controlling terminal: sudo cannot prompt.
      detached: true,
    });
    this.exited = once(this.child, 'exit').then(([code, signal]) => ({ code, signal }));
    this.child.stderr.on('data', (data) => {
      this.stderr += data;
    });
    const lines = createInterface({ input: this.child.stdout });
    this.hello = new Promise((resolve, reject) => {
      this.once('hello', (message) => resolve(message.identity));
      this.child.once('error', reject);
      void this.exited.then(({ code, signal }) =>
        reject(
          Object.assign(new Error(`participant exited before hello (${code ?? signal})`), {
            code: 'LAUNCH',
            stderr: this.stderr.slice(0, 2000),
          }),
        ),
      );
    });
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.log?.({ role, runtime, unparsed: line.slice(0, 500) });
        return;
      }
      if (message.event) {
        this.log?.({ role, runtime, event: message });
        this.emit(message.event, message);
        if (message.event === 'hello') {
          this.identity = message.identity;
        }
        return;
      }
      const waiter = this.waiting.get(message.id);
      if (waiter) {
        this.waiting.delete(message.id);
        waiter(message);
      }
    });
    void this.exited.then(({ code, signal }) => {
      for (const waiter of this.waiting.values()) {
        waiter({
          ok: false,
          error: { code: 'EXITED', message: `participant exited (${code ?? signal})` },
        });
      }
      this.waiting.clear();
    });
  }

  // Resolves to the reply; ok:false replies are returned so cases can assert them.
  request(op, args = {}, { timeoutMs = 30000 } = {}) {
    const id = ++this.next;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve({
          ok: false,
          error: { code: 'CONTROLLER_DEADLINE', message: `${op} exceeded ${timeoutMs} ms` },
        });
      }, timeoutMs);
      this.waiting.set(id, (reply) => {
        clearTimeout(timer);
        this.log?.({
          role: this.role,
          runtime: this.runtime,
          op,
          args: redactArgs(op, args),
          reply,
        });
        resolve(reply);
      });
      this.child.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  // Throws on ok:false; used where failure means the case cannot continue.
  async ok(op, args, options) {
    const reply = await this.request(op, args, options);
    if (!reply.ok) {
      throw Object.assign(
        new Error(`${this.role}.${op} failed: ${reply.error?.code} ${reply.error?.message}`),
        {
          reply,
        },
      );
    }
    return reply.result;
  }

  waitFor(event, predicate = () => true, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(
          Object.assign(new Error(`${this.role} did not emit ${event}`), {
            code: 'CONTROLLER_DEADLINE',
          }),
        );
      }, timeoutMs);
      const handler = (message) => {
        if (predicate(message)) {
          clearTimeout(timer);
          this.off(event, handler);
          resolve(message);
        }
      };
      this.on(event, handler);
    });
  }

  async close(timeoutMs = 20000) {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGTERM'), timeoutMs);
    try {
      return await this.exited;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Provisioning payloads carry credentials; they are never logged.
function redactArgs(op, args) {
  if (op === 'provision') {
    return { files: args.files.map((file) => ({ path: file.path, mode: file.mode })) };
  }
  return args;
}
