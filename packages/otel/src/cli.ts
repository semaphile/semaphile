import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { startCollector, type CollectorOptions, type CollectorSource } from './collector.js';
import { startTelemetry } from './sdk.js';
export async function collectorCommand(
  argv: string[],
  defaults: Partial<CollectorOptions> & {
    otel?: boolean;
    serviceName?: string;
    baggageAllowlist?: string[];
  } = {},
) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', multiple: true },
      source: { type: 'string', multiple: true },
      'redis-url-env': { type: 'string', multiple: true },
      namespace: { type: 'string' },
      pool: { type: 'string', multiple: true },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      host: { type: 'string' },
      port: { type: 'string' },
      'interval-ms': { type: 'string' },
      'watch-pools': { type: 'boolean' },
      'no-watch-pools': { type: 'boolean' },
      'allow-overlap': { type: 'boolean' },
      otel: { type: 'boolean' },
      'no-otel': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (v.help) {
    process.stdout.write(
      'semaphile telemetry collect [--root DIR ...] [--source NAME ...] [--redis-url-env ENV ...] [--namespace NAME] [--pool NAME ...] [--include GLOB ...] [--exclude GLOB ...] [--no-watch-pools] [--allow-overlap] [--host HOST] [--port PORT] [--otel]\n',
    );
    return;
  }
  if (v['watch-pools'] && v['no-watch-pools']) {
    throw new Error('Choose --watch-pools or --no-watch-pools');
  }
  const explicit: CollectorSource[] = [
    ...(v.root ?? []).map((directory, i) => ({
      name: `local${i}`,
      backend: 'sqlite' as const,
      directory: resolve(directory),
    })),
    ...(v['redis-url-env'] ?? []).map((urlEnv, i) => ({
      name: `redis${i}`,
      backend: 'redis' as const,
      urlEnv,
      namespace: v.namespace,
    })),
  ];
  let sources = explicit.length ? explicit : (defaults.sources ?? []);
  if (v.source) {
    const selected = new Set(v.source);
    if ([...selected].some((name) => !sources.some((source) => source.name === name))) {
      throw new Error('Unknown collector source');
    }
    sources = sources.filter((source) => selected.has(source.name));
  }
  const collectorId = randomUUID();
  if (v.otel && v['no-otel']) {
    throw new Error('Choose --otel or --no-otel');
  }
  const sdk = (v['no-otel'] ? false : (v.otel ?? defaults.otel))
    ? await startTelemetry({
        serviceName: defaults.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'semaphile-collector',
        baggageAllowlist: defaults.baggageAllowlist,
        instanceId: collectorId,
        intervalMs: v['interval-ms'] ? Number(v['interval-ms']) : defaults.intervalMs,
      })
    : undefined;
  let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    collector = await startCollector({
      ...defaults,
      collectorId,
      sources,
      pools: v.pool ?? defaults.pools,
      include: v.include ?? defaults.include,
      exclude: v.exclude ?? defaults.exclude,
      host: v.host ?? defaults.host,
      port: v.port === undefined ? defaults.port : Number(v.port),
      intervalMs: v['interval-ms'] === undefined ? defaults.intervalMs : Number(v['interval-ms']),
      watchPools: v['no-watch-pools'] ? false : (v['watch-pools'] ?? defaults.watchPools),
      allowOverlap: v['allow-overlap'] ?? defaults.allowOverlap,
      meter: sdk?.meter,
      onWarning: (warning) =>
        process.stderr.write(
          JSON.stringify({
            warning,
            ...(warning.kind === 'overlap'
              ? { message: 'Overlapping collectors may export duplicate shared metrics' }
              : {}),
          }) + '\n',
        ),
    });
    process.stdout.write(
      JSON.stringify({ collectorId: collector.id, address: collector.address }) + '\n',
    );
    if (!controller.signal.aborted) {
      await once(controller.signal, 'abort');
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    // Flush while registrations and gauge callbacks are still valid.
    try {
      await sdk?.shutdown();
    } finally {
      await collector?.close();
    }
  }
}
