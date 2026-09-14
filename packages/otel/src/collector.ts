// Explicitly managed collector. Sampling is observational and coalesced; limiter
// clients never start this process or depend on it for admission.
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { opendir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolMeasurement, PoolObserver } from '@semaphile/core/observation';
import type { Meter } from '@opentelemetry/api';
export type CollectorSource =
  | { name: string; backend: 'sqlite'; directory: string }
  | { name: string; backend: 'redis'; urlEnv?: string; rootUrlsEnv?: string[]; namespace?: string };
export type CollectorOptions = {
  collectorId?: string;
  sources: CollectorSource[];
  pools?: string[];
  include?: string[];
  exclude?: string[];
  watchPools?: boolean;
  allowOverlap?: boolean;
  host?: string;
  port?: number;
  /** Compatibility field for CLI configuration; export cadence belongs to startTelemetry. */
  intervalMs?: number;
  meter?: Meter;
  onWarning?: (warning: CollectorWarning) => void;
};
export type CollectorWarning = {
  kind: 'conflict' | 'overlap' | 'collection-failed';
  pool: string;
  owners?: string[];
};
type Candidate = {
  id: string;
  pool: string;
  source: string;
  backend: string;
  open: () => Promise<PoolObserver>;
};
type Entry = {
  candidate: Candidate;
  observer?: PoolObserver;
  sample?: PoolMeasurement;
  error?: string;
  owners: string[];
};
interface Source {
  name: string;
  discover: (deadline: number) => Promise<Candidate[]>;
  close: () => Promise<void>;
}
// Iterative wildcard matching avoids exponential regex backtracking for
// selectors such as *a*a*a*a*b against long near-matching pool names.
const glob = (pattern: string, value: string) => {
  const p = Array.from(pattern),
    v = Array.from(value);
  let i = 0,
    j = 0,
    star = -1,
    retry = 0;
  while (j < v.length) {
    if (p[i] === '?' || p[i] === v[j]) {
      i++;
      j++;
    } else if (p[i] === '*') {
      star = i++;
      retry = j;
    } else if (star >= 0) {
      i = star + 1;
      j = ++retry;
    } else {
      return false;
    }
  }
  while (p[i] === '*') {
    i++;
  }
  return i === p.length;
};
const text = (value: string) => JSON.stringify(value); // Prometheus string escaping.
export async function startCollector(options: CollectorOptions) {
  for (const value of [options.watchPools, options.allowOverlap]) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new Error('Collector switches must be booleans');
    }
  }
  for (const value of [options.pools, options.include, options.exclude]) {
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        value.length > 1024 ||
        value.some((item) => typeof item !== 'string' || !item.length || item.length > 4096))
    ) {
      throw new Error('Invalid collector selectors');
    }
  }
  if (!Array.isArray(options.sources)) {
    throw new Error('Collector sources must be an array');
  }
  for (const source of options.sources) {
    if (
      !source ||
      typeof source.name !== 'string' ||
      !['sqlite', 'redis'].includes(source.backend)
    ) {
      throw new Error('Invalid collector source');
    }
    if (
      source.backend === 'sqlite' &&
      (typeof source.directory !== 'string' || !source.directory)
    ) {
      throw new Error('Local source requires directory');
    }
    if (source.backend === 'redis') {
      if (
        source.namespace !== undefined &&
        (typeof source.namespace !== 'string' || !source.namespace)
      ) {
        throw new Error('Invalid Redis namespace');
      }
      if (source.urlEnv !== undefined && (typeof source.urlEnv !== 'string' || !source.urlEnv)) {
        throw new Error('Invalid Redis environment name');
      }
      if (
        source.rootUrlsEnv !== undefined &&
        (!Array.isArray(source.rootUrlsEnv) ||
          !source.rootUrlsEnv.length ||
          source.rootUrlsEnv.length > 64 ||
          source.rootUrlsEnv.some((name) => typeof name !== 'string' || !name))
      ) {
        throw new Error('Invalid Redis Cluster environment names');
      }
    }
  }
  const id = options.collectorId ?? randomUUID(),
    host = options.host ?? '127.0.0.1',
    port = options.port ?? 9464;
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error('Invalid collector identity');
  }
  const interval = options.intervalMs ?? 15000;
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Number.isInteger(interval) ||
    interval < 1000 ||
    interval > 2147483647
  ) {
    throw new Error('Invalid collector port or interval');
  }
  if (
    !options.sources.length ||
    options.sources.length > 64 ||
    new Set(options.sources.map((s) => s.name)).size !== options.sources.length
  ) {
    throw new Error('Collector requires 1–64 uniquely named sources');
  }
  const sources: Source[] = [],
    entries = new Map<string, Entry>(),
    warnings = new Map<string, string>();
  let sampleStart = 0;
  let stopped = false,
    initialized = false,
    inFlight: Promise<void> | undefined,
    sourceFailure = false;
  const warn = (warning: CollectorWarning) => {
    const key = warning.pool,
      signature = JSON.stringify(warning);
    if (warnings.get(key) === signature) {
      return;
    }
    warnings.set(key, signature);
    try {
      options.onWarning?.(warning);
    } catch {
      /* Warning sinks cannot affect sampling. */
    }
  };
  const selected = (candidate: Candidate) => {
    const positive = [...(options.pools ?? []), ...(options.include ?? [])];
    const matches = (pattern: string) =>
      glob(pattern, candidate.pool) || glob(pattern, `${candidate.source}/${candidate.pool}`);
    return (!positive.length || positive.some(matches)) && !(options.exclude ?? []).some(matches);
  };
  const closeEntries = async () => {
    await Promise.allSettled(
      [...entries.values()]
        .filter((entry) => entry.observer)
        .map((entry) => entry.observer!.close()),
    );
    entries.clear();
  };
  try {
    for (const source of options.sources) {
      if (!source.name || source.name.length > 128) {
        throw new Error('Invalid source name');
      }
      if (source.backend === 'sqlite') {
        const moduleName = '@semaphile/core/observation';
        const implementation = (await import(moduleName)) as {
          openPoolObserver: (options: {
            path: string;
            collectorId: string;
            allowOverlap: boolean;
          }) => Promise<PoolObserver>;
        };
        const root = await realpath(source.directory);
        sources.push({
          name: source.name,
          close: async () => {},
          discover: async (deadline) => {
            const result: Candidate[] = [];
            const directories = await opendir(root);
            let count = 0;
            for await (const directory of directories) {
              if (++count > 4096 || performance.now() >= deadline) {
                throw new Error('Local discovery exceeds bound');
              }
              if (!directory.isDirectory() && !directory.isSymbolicLink()) {
                continue;
              }
              const path = await realpath(join(root, directory.name));
              // Aliases outside the configured boundary are not implicit sources.
              if (!path.startsWith(root + '/')) {
                continue;
              }
              const identity = await stat(path, { bigint: true });
              try {
                await stat(join(path, 'state.sqlite'));
              } catch {
                continue;
              }
              result.push({
                id: `sqlite:${identity.dev}:${identity.ino}`,
                pool: directory.name,
                source: source.name,
                backend: 'sqlite',
                open: () =>
                  implementation.openPoolObserver({
                    path,
                    collectorId: id,
                    allowOverlap: options.allowOverlap ?? false,
                  }),
              });
            }
            return result;
          },
        });
      } else {
        const env = (name: string) => {
          const value = process.env[name];
          if (!value) {
            throw new Error('Redis source environment variable is unset');
          }
          return value;
        };
        if (Boolean(source.urlEnv) === Boolean(source.rootUrlsEnv?.length)) {
          throw new Error('Redis source requires urlEnv or rootUrlsEnv');
        }
        const urls = source.rootUrlsEnv?.map(env),
          url = source.urlEnv ? env(source.urlEnv) : undefined;
        const moduleName = '@semaphile/redis/observation';
        const implementation = (await import(moduleName)) as {
          openObservationSource: (options: unknown) => Promise<{
            discover: (options?: { timeoutMs: number }) => Promise<string[]>;
            identity: (pool: string) => Promise<string>;
            open: (pool: string, id: string, overlap: boolean) => Promise<PoolObserver>;
            close: () => Promise<void>;
          }>;
        };
        const backend = await implementation.openObservationSource({
          url,
          rootUrls: urls,
          namespace: source.namespace,
        });
        sources.push({
          name: source.name,
          close: () => backend.close(),
          discover: async (deadline) => {
            const pools = new Set(
              await backend.discover({ timeoutMs: Math.max(1, deadline - performance.now()) }),
            );
            // Exact selectors also make legacy, hash-only pools addressable.
            for (const pool of options.pools ?? []) {
              if (!/[?*/]/.test(pool)) {
                pools.add(pool);
              }
            }
            const result: Candidate[] = [];
            for (const pool of pools) {
              if (performance.now() >= deadline) {
                throw new Error('Redis identity discovery timed out');
              }
              result.push({
                id: `redis:${await backend.identity(pool)}`,
                pool,
                source: source.name,
                backend: 'redis',
                open: () => backend.open(pool, id, options.allowOverlap ?? false),
              });
            }
            return result;
          },
        });
      }
    }
  } catch (error) {
    await Promise.allSettled(sources.map((source) => source.close()));
    throw error;
  }
  const collect = async () => {
    const deadline = performance.now() + 5000;
    sourceFailure = false;
    if (!initialized || options.watchPools !== false) {
      const found = new Map<string, Candidate>();
      const successful = new Set<string>();
      for (const source of sources) {
        if (performance.now() >= deadline) {
          sourceFailure = true;
          break;
        }
        try {
          for (const candidate of await source.discover(deadline)) {
            if (selected(candidate) && !found.has(candidate.id)) {
              found.set(candidate.id, candidate);
            }
          }
          successful.add(source.name);
        } catch {
          sourceFailure = true;
        }
      }
      // Retire disappeared entries only from sources successfully inspected.
      // A separate unavailable source must not prevent healthy-source cleanup.
      for (const [key, entry] of entries) {
        if (!found.has(key) && successful.has(entry.candidate.source)) {
          await entry.observer?.close().catch(() => {});
          warnings.delete(`${entry.candidate.source}/${entry.candidate.pool}`);
          entries.delete(key);
        }
      }
      const additions = [...found.values()].filter((candidate) => !entries.has(candidate.id));
      if (entries.size + additions.length > 1024) {
        sourceFailure = true;
        throw new Error('Collector exceeds retained pool bound');
      }
      for (const candidate of found.values()) {
        const existing = entries.get(candidate.id);
        if (existing && existing.candidate.source !== candidate.source) {
          warnings.delete(`${existing.candidate.source}/${existing.candidate.pool}`);
          existing.candidate = candidate;
        }
      }
      for (const candidate of additions) {
        entries.set(candidate.id, { candidate, owners: [] });
      }
    }
    const conflicts: string[] = [];
    const ordered = [...entries.values()];
    const start = sampleStart % Math.max(1, ordered.length);
    let skipped = false;
    for (let offset = 0; offset < ordered.length; offset++) {
      const position = (start + offset) % ordered.length;
      const entry = ordered[position];
      if (stopped || performance.now() >= deadline) {
        if (!skipped) {
          sampleStart = position;
          skipped = true;
        }
        entry.sample = undefined;
        entry.error = 'collection-failed';
        continue;
      }
      const name = `${entry.candidate.source}/${entry.candidate.pool}`;
      try {
        entry.observer ??= await entry.candidate.open();
        entry.owners = (await entry.observer.owners()).filter((owner) => owner !== id).sort();
        if (entry.owners.length) {
          warn({
            kind: options.allowOverlap ? 'overlap' : 'conflict',
            pool: name,
            owners: entry.owners,
          });
          // Another collector can deliberately overlap a default-mode owner. The
          // original owner remains active; a warning never evicts it.
        } else {
          warnings.delete(name);
        }
        entry.sample = await entry.observer.sample();
        entry.error = undefined;
      } catch (error) {
        entry.sample = undefined;
        const owners = (error as { owners?: string[] }).owners;
        entry.owners = owners ?? entry.owners;
        entry.error = owners ? 'conflict' : 'collection-failed';
        warn({
          kind: owners ? 'conflict' : 'collection-failed',
          pool: name,
          ...(owners ? { owners } : {}),
        });
        if (owners) {
          conflicts.push(name);
        }
        if (entry.observer && !entry.observer.valid()) {
          await entry.observer.close().catch(() => {});
          entry.observer = undefined;
        }
      }
    }
    if (!initialized && conflicts.length && !options.allowOverlap) {
      throw new Error(`Selected pools already have collectors: ${conflicts.join(', ')}`);
    }
    if (!initialized && (skipped || ordered.some((entry) => !entry.observer))) {
      throw new Error('Collector startup could not verify every selected pool');
    }
    if (!initialized && sourceFailure) {
      throw new Error('Collector source discovery failed');
    }
    initialized = true;
  };
  const refresh = () => {
    if (stopped) {
      return Promise.reject(new Error('Collector stopped'));
    }
    return (inFlight ??= (async () => {
      try {
        await collect();
      } finally {
        inFlight = undefined;
      }
    })());
  };
  const health = () => ({
    collectorId: id,
    allowOverlap: options.allowOverlap ?? false,
    watchPools: options.watchPools ?? true,
    healthy: !sourceFailure && [...entries.values()].every((e) => !e.error && e.observer?.valid()),
    pools: [...entries.values()].map((e) => ({
      source: e.candidate.source,
      pool: e.candidate.pool,
      owners: e.owners,
      error: e.error,
      sampledAt: e.sample?.at,
    })),
  });
  const measurements: Record<string, (sample: PoolMeasurement) => number | null> = {
    active: (s) => s.active,
    max_concurrent: (s) => s.maxConcurrent,
    reservoir: (s) => s.reservoir,
    pending: (s) => s.pending,
    unconfirmed: (s) => s.unconfirmed,
    draining: (s) => Number(s.maintenance === 'draining'),
    circuit_open: (s) => Number(s.circuit === 'open'),
    circuit_half_open: (s) => Number(s.circuit === 'half-open'),
    cooldown_until_seconds: (s) => s.cooldownUntil / 1000,
    open_until_seconds: (s) => s.openUntil / 1000,
  };
  const render = () => {
    const lines: string[] = [
      `target_info{service_name="semaphile-collector",service_instance_id=${text(id)}} 1`,
    ];
    for (const entry of entries.values()) {
      const labels = `source=${text(entry.candidate.source)},pool=${text(entry.candidate.pool)},backend=${text(entry.candidate.backend)}`;
      lines.push(
        `semaphile_pool_collection_success{${labels}} ${entry.sample && entry.observer?.valid() ? 1 : 0}`,
      );
      if (!entry.sample || !entry.observer?.valid()) {
        continue;
      }
      lines.push(
        `semaphile_pool_sample_age_seconds{${labels}} ${Math.max(0, Date.now() - entry.sample.at) / 1000}`,
      );
      for (const [name, value] of Object.entries(measurements)) {
        const number = value(entry.sample);
        if (number !== null) {
          lines.push(`semaphile_pool_${name}{${labels}} ${number}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  };
  let server: Server | undefined;
  const gaugeCallbacks: Array<() => void> = [];
  try {
    await refresh();
    if (options.meter) {
      for (const [name, value] of Object.entries(measurements)) {
        const gauge = options.meter.createObservableGauge(`semaphile.pool.${name}`);
        const callback: Parameters<typeof gauge.addCallback>[0] = async (result) => {
          try {
            await refresh();
            for (const entry of entries.values()) {
              if (entry.sample && entry.observer?.valid()) {
                const number = value(entry.sample);
                if (number !== null) {
                  result.observe(number, {
                    source: entry.candidate.source,
                    pool: entry.candidate.pool,
                    backend: entry.candidate.backend,
                    'service.instance.id': id,
                  });
                }
              }
            }
          } catch {
            /* Failed samples are omitted, never replaced by zero. */
          }
        };
        gauge.addCallback(callback);
        gaugeCallbacks.push(() => gauge.removeCallback(callback));
      }
    }
    server = createServer((request, response) => {
      if (request.url !== '/metrics' && request.url !== '/healthz') {
        response.writeHead(404);
        response.end();
        return;
      }
      void refresh().then(
        () => {
          if (request.url === '/metrics') {
            response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
            response.end(render());
          } else {
            const value = health();
            response.writeHead(value.healthy ? 200 : 503, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(value));
          }
        },
        () => {
          response.writeHead(503);
          response.end('Collection unavailable\n');
        },
      );
    });
    server.maxConnections = 64;
    server.setTimeout(8000, (socket) => socket.destroy());
    server.headersTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(port, host, () => {
        server!.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    stopped = true;
    for (const remove of gaugeCallbacks) {
      remove();
    }
    server?.close();
    await closeEntries();
    await Promise.allSettled(sources.map((source) => source.close()));
    throw error;
  }
  return {
    id,
    address: server.address(),
    health,
    refresh,
    async close() {
      if (stopped) {
        return;
      }
      stopped = true;
      for (const remove of gaugeCallbacks) {
        remove();
      }
      server!.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      await inFlight?.catch(() => {});
      await closeEntries();
      await Promise.allSettled(sources.map((source) => source.close()));
    },
  };
}
