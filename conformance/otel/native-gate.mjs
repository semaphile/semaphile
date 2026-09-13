import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { nativePath } from '../../packages/core/dist/src/native-path.js';
mkdirSync('.tmp/otel', { recursive: true, mode: 0o700 });
const store = mkdtempSync(resolve('.tmp/otel/gate-'));
const binding = createRequire(import.meta.url)(nativePath());
const native = new binding.NativeContext();
const gate = native.open(store + '/gate', 'gate');
const child = spawn(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
 import {createRequire} from 'node:module';
 const binding=createRequire(import.meta.url)(process.argv[1]);
 const native=new binding.NativeContext();
 native.open(process.argv[2], 'gate').withGate(()=>{
   process.stdout.write('locked\\n');
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);
 });
`,
    nativePath(),
    store + '/gate',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
try {
  await once(child.stdout, 'data');
  let called = false;
  const start = performance.now();
  assert.throws(
    () =>
      gate.tryWithGate(() => {
        called = true;
      }),
    /busy/,
  );
  assert(!called);
  assert(performance.now() - start < 500);
  console.log('PASS nonblocking observation refuses a gate held by another process');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  assert.equal(
    gate.tryWithGate(() => 42),
    42,
  );
  assert.throws(
    () =>
      gate.tryWithGate(() => {
        throw Error('callback');
      }),
    /callback/,
  );
  assert.equal(
    gate.tryWithGate(() => 43),
    43,
  );
  console.log('PASS SIGKILL and callback failure preserve nonblocking gate recovery');
} finally {
  child.kill('SIGKILL');
  native.close();
}
console.log('RESULT 2/2 passed');
