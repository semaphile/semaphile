// Include the foundational observation regressions in the standard core suite.
import { spawnSync } from 'node:child_process';
for (const suite of ['native-gate', 'lifecycle', 'http-lifecycle', 'local-observer']) {
  const result = spawnSync(process.execPath, ['--no-warnings', `conformance/otel/${suite}.mjs`], {
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
