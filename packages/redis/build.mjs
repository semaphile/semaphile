// Pure-JavaScript package build: compile declarations and include the Lua source.
import { spawnSync } from 'node:child_process';
import { copyFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url)),
  staging = join(root, '.build');
await rm(staging, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules/typescript/bin/tsc'),
    '--project',
    join(root, 'tsconfig.json'),
    '--outDir',
    staging,
  ],
  { stdio: 'inherit' },
);
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error('Redis TypeScript build failed');
}
await copyFile(join(root, 'src/protocol.lua'), join(staging, 'protocol.lua'));
await copyFile(join(root, 'src/control.lua'), join(staging, 'control.lua'));
await rm(join(root, 'dist'), { recursive: true, force: true });
await rename(staging, join(root, 'dist'));
console.log('Built @semaphile/redis (TypeScript and Lua; no native build or install hook)');
