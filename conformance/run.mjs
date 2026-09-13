// One entry point for contributors; the invoking runtime also runs each suite.
import { spawnSync } from 'node:child_process';
const suites = {
  otel: [
    'native-gate',
    'lifecycle',
    'local-observer',
    'http-lifecycle',
    'adapter',
    'exporter',
    'collector',
    'collector-faults',
    'redis-observer',
    'redis-timeout',
    'cli',
    'cluster',
    'messaging',
    'messaging-cli',
    'package',
  ],
  core: [
    'native-binding',
    'telemetry',
    'recovery',
    'recovery-backend',
    'maintenance-state',
    'queue-deadlines',
    'execution',
    'http',
    'http-sqlite',
    'memory',
    'memory-recovery',
    'artifacts',
    'native-headers',
    'admission',
    'budgets',
    'min-time',
    'test',
    'package',
    'backend-regression',
  ],
  redis: [
    'backend-order',
    'primitive',
    'recovery',
    'execution',
    'http',
    'client',
    'faults',
    'startup-race',
    'package',
  ],
  administration: ['pool-cli'],
  messaging: [
    'upgrade',
    'trace-store',
    'telemetry',
    'primitive',
    'retention',
    'review-regressions',
    'client-regressions',
    'faults',
    'listener',
    'cli',
    'package',
  ],
};
const backend = process.argv[2];
if (!Object.hasOwn(suites, backend)) {
  throw new Error('Usage: node conformance/run.mjs core|redis|messaging|administration|otel');
}
for (const suite of suites[backend]) {
  const directory =
    backend === 'core' ? 'typescript' : backend === 'administration' ? 'messaging' : backend;
  const result = spawnSync(
    process.execPath,
    [
      ...(suite === 'native-binding' ? ['--expose-gc'] : []),
      '--no-warnings',
      `conformance/${directory}/${suite}.mjs`,
    ],
    { stdio: 'inherit', timeout: 120_000 },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
