import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativePackage } from './package-build.mjs';
await buildNativePackage({ root: dirname(fileURLToPath(import.meta.url)), name: 'core' });
