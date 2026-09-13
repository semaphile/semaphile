// Isolated blocking fixture process; the parent releases it by writing stdin.
import { createRequire } from 'node:module';
import { readSync, writeSync } from 'node:fs';
const native = new (createRequire(import.meta.url)(process.argv[2]).NativeContext)();
const gate = native.open(process.argv[3], 'gate');
try {
  gate.withGate(() => {
    writeSync(1, 'held\n');
    readSync(0, Buffer.alloc(1), 0, 1, null);
  });
} finally {
  native.close();
}
