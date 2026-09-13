// Administrative inspection takes the existing gate but never creates schemas,
// participants or leases. SQLite may recover a hot journal after a writer crash.
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nativePath } from './native-path.js';
import type { Native } from './native.js';
try {
  const path = String(workerData.path);
  if (!existsSync(join(path, 'state.sqlite')) || !existsSync(join(path, 'coordination.lock'))) {
    throw new Error('Store does not exist');
  }
  const binding: Native = createRequire(import.meta.url)(nativePath());
  const native = new binding.NativeContext();
  const gate = native.open(join(path, 'coordination.lock'), 'gate');
  try {
    gate.withGate(() => {
      const db = new DatabaseSync(join(path, 'state.sqlite'));
      try {
        db.exec('PRAGMA busy_timeout=0;');
        const row = db.prepare('SELECT format,value FROM config WHERE singleton=1').get();
        if (
          !row ||
          !['semaphile-messaging/1.0', 'semaphile-sqlite-poc/1.4'].includes(String(row.format))
        ) {
          throw new Error('Unsupported store format');
        }
        parentPort!.postMessage({
          value: { path, format: row.format, config: JSON.parse(String(row.value)) as unknown },
        });
      } finally {
        db.close();
      }
    });
  } finally {
    native.close();
  }
} catch (error) {
  parentPort!.postMessage({ error: String(error) });
}
parentPort!.close();
