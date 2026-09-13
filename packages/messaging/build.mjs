import { cp, chmod } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativePackage } from '../core/package-build.mjs';
const root = dirname(fileURLToPath(import.meta.url));
await buildNativePackage({
  root,
  name: 'messaging',
  nativeRoot: resolve(root, '../core'),
  async prepare(source) {
    await chmod(join(source, 'cli.js'), 0o755);
    // Bundle the pure normalizer for observational pool comparison.
    await cp(join(root, '../core/dist/src/config.js'), join(source, 'pool-config.js'));
    await cp(join(root, '../core/dist/src/recovery-policy.js'), join(source, 'recovery-policy.js'));
  },
});
