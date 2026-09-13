import { readSync, writeSync } from 'node:fs';
import { Database } from '../../packages/messaging/dist/src/database.js';
import { Presence } from '../../packages/messaging/dist/src/presence.js';
import { normalize } from '../../packages/messaging/dist/src/config.js';
import { send } from '../../packages/messaging/dist/src/send.js';
const [operation, path, stage, encoded] = process.argv.slice(2);
const store = new Database(path, normalize(encoded ? JSON.parse(encoded) : {}), 'warn');
if (operation === 'gate') {
  store.gate.withGate(() => {
    writeSync(1, 'ready\n');
    readSync(0, Buffer.alloc(1), 0, 1, null);
  });
  store.close();
} else if (operation === 'wait') {
  const subscription = store.locked(() => store.native.subscribe(store.notifyPath('a')));
  process.stdout.write('armed\n');
  try {
    const result = await new Promise((resolve, reject) => {
      subscription.start(150, (error, value) => (error ? reject(error) : resolve(value)));
    });
    process.stdout.write(JSON.stringify({ result }) + '\n');
  } finally {
    subscription.close();
    store.close();
  }
} else if (operation === 'writer') {
  let signaled = false,
    committed = false;
  const kill = () => process.kill(process.pid, 'SIGKILL');
  const open = store.native.open.bind(store.native),
    withGate = store.gate.withGate.bind(store.gate),
    exec = store.db.exec.bind(store.db);
  store.native.open = (path, role) => {
    const file = open(path, role),
      pulse = file.pulse.bind(file);
    file.pulse = () => {
      if (stage === 'beforeSignal') {
        kill();
      }
      pulse();
      signaled = true;
      if (stage === 'afterSignal') {
        kill();
      }
    };
    return file;
  };
  store.db.exec = (sql) => {
    if (signaled && sql === 'COMMIT' && ['afterMutation', 'beforeCommit'].includes(stage)) {
      kill();
    }
    const result = exec(sql);
    if (signaled && sql === 'COMMIT') {
      committed = true;
      if (stage === 'afterCommit') {
        kill();
      }
    }
    return result;
  };
  store.gate.withGate = (operation) =>
    withGate(() => {
      const value = operation();
      if (committed && stage === 'beforeUnlock') {
        kill();
      }
      return value;
    });
  store.locked(() => send(store, new Presence(store), { to: 'a', body: stage }));
  store.close();
}
