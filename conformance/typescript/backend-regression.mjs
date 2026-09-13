// Run the original crash-boundary scenarios directly against the built backend.
import { nativePath } from '../../packages/core/dist/src/native-path.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
console.log('Running the nineteen SQLite scenarios against the packaged backend');
const child = spawn(
  process.execPath,
  ['--no-warnings', 'conformance/typescript/fixtures/backend.ts', nativePath()],
  { stdio: 'inherit' },
);
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
