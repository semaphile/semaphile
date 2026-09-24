import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { constants } from 'node:fs';
import { record, listenerDefaults } from './validation.js';
import { MessagingError, normalize, text, integer } from './config.js';
import type { ListenerOptions, StoreConfig } from './types.js';
export interface ProjectConfig {
  telemetry?: {
    enabled?: boolean;
    serviceName?: string;
    baggageAllowlist?: string[];
    collector?: {
      sources?: Array<
        | { name: string; backend: 'sqlite'; directory: string }
        | {
            name: string;
            backend: 'redis';
            urlEnv?: string;
            rootUrlsEnv?: string[];
            namespace?: string;
          }
      >;
      pools?: string[];
      include?: string[];
      exclude?: string[];
      watchPools?: boolean;
      allowOverlap?: boolean;
      host?: string;
      port?: number;
      intervalMs?: number;
    };
  };
  version: 1;
  directory?: string;
  pools?: Record<string, Record<string, unknown>>;
  messaging?: {
    backend?: 'sqlite' | 'redis';
    redis?: {
      urlEnv: string;
      namespace: string;
      store: string;
      readiness?: 'warn' | 'strict';
      operationTimeoutMs?: number;
      maxPendingOperations?: number;
      sessionTimeoutMs?: number;
    };
    config?: Partial<StoreConfig>;
    clientDefaults?: { configMismatch?: 'warn' | 'error' };
    listenerDefaults?: Omit<ListenerOptions, 'signal' | 'onError'>;
    handler?: string[];
  };
}
export interface ResolvedConfig {
  file: string;
  directory: string;
  messagingPath: string;
  value: ProjectConfig;
}
function validateMessaging(value: NonNullable<ProjectConfig['messaging']>): void {
  record(value, 'messaging', [
    'config',
    'clientDefaults',
    'listenerDefaults',
    'handler',
    'backend',
    'redis',
  ]);
  if (value.backend !== undefined && !['sqlite', 'redis'].includes(value.backend)) {
    throw new MessagingError('CONFIG', 'Invalid messaging backend');
  }
  if (value.backend === 'redis') {
    const redis = record(value.redis, 'messaging redis', [
      'urlEnv',
      'namespace',
      'store',
      'readiness',
      'operationTimeoutMs',
      'maxPendingOperations',
      'sessionTimeoutMs',
    ]);
    for (const key of ['urlEnv', 'namespace', 'store']) {
      text(redis[key], key);
    }
    if (
      redis.readiness !== undefined &&
      redis.readiness !== 'warn' &&
      redis.readiness !== 'strict'
    ) {
      throw new MessagingError('CONFIG', 'Invalid readiness');
    }
    for (const key of ['operationTimeoutMs', 'maxPendingOperations', 'sessionTimeoutMs']) {
      if (redis[key] !== undefined) {
        integer(redis[key], key);
      }
    }
  } else if (value.redis !== undefined) {
    throw new MessagingError('CONFIG', 'redis settings require backend redis');
  }
  if (value.clientDefaults !== undefined) {
    record(value.clientDefaults, 'clientDefaults', ['configMismatch']);
  }
  if (value.listenerDefaults !== undefined) {
    listenerDefaults(value.listenerDefaults);
  }
  normalize(value.config);
  const mismatch = value.clientDefaults?.configMismatch;
  if (mismatch !== undefined && mismatch !== 'warn' && mismatch !== 'error') {
    throw new MessagingError('CONFIG', 'Invalid configMismatch');
  }
  if (
    value.handler !== undefined &&
    (!Array.isArray(value.handler) ||
      !value.handler.length ||
      !value.handler[0] ||
      value.handler.some((v) => typeof v !== 'string'))
  ) {
    throw new MessagingError('CONFIG', 'handler must be a nonempty executable/argument array');
  }
}
async function validateProject(value: ProjectConfig): Promise<void> {
  if (
    value?.version !== 1 ||
    (value.directory !== undefined && (typeof value.directory !== 'string' || !value.directory)) ||
    (value.directory === undefined &&
      (value.messaging?.backend !== 'redis' || Object.keys(value.pools ?? {}).length > 0))
  ) {
    throw new MessagingError('CONFIG', 'Config requires version: 1 and a directory');
  }
  record(value, 'config', ['version', 'directory', 'pools', 'messaging', 'telemetry']);
  if (value.telemetry !== undefined) {
    const telemetry = record(value.telemetry, 'telemetry', [
      'enabled',
      'serviceName',
      'baggageAllowlist',
      'collector',
    ]);
    if (telemetry.enabled !== undefined && typeof telemetry.enabled !== 'boolean') {
      throw new MessagingError('CONFIG', 'Invalid telemetry enabled');
    }
    if (telemetry.serviceName !== undefined && typeof telemetry.serviceName !== 'string') {
      throw new MessagingError('CONFIG', 'Invalid telemetry serviceName');
    }
    if (
      telemetry.baggageAllowlist !== undefined &&
      (!Array.isArray(telemetry.baggageAllowlist) ||
        telemetry.baggageAllowlist.some((v) => typeof v !== 'string'))
    ) {
      throw new MessagingError('CONFIG', 'Invalid baggage allowlist');
    }
    if (telemetry.collector !== undefined) {
      const collector = record(telemetry.collector, 'collector', [
        'sources',
        'pools',
        'include',
        'exclude',
        'watchPools',
        'allowOverlap',
        'host',
        'port',
        'intervalMs',
      ]);
      for (const key of ['watchPools', 'allowOverlap']) {
        if (collector[key] !== undefined && typeof collector[key] !== 'boolean') {
          throw new MessagingError('CONFIG', 'Collector switches must be booleans');
        }
      }
      for (const key of ['pools', 'include', 'exclude']) {
        const items = collector[key];
        if (
          items !== undefined &&
          (!Array.isArray(items) || items.some((item) => typeof item !== 'string' || !item))
        ) {
          throw new MessagingError('CONFIG', 'Invalid collector selectors');
        }
      }
      if (collector.sources !== undefined) {
        if (!Array.isArray(collector.sources)) {
          throw new MessagingError('CONFIG', 'Collector sources must be an array');
        }
        for (const input of collector.sources) {
          const source = record(input, 'source', [
            'name',
            'backend',
            'directory',
            'urlEnv',
            'rootUrlsEnv',
            'namespace',
          ]);
          if (
            typeof source.name !== 'string' ||
            !source.name ||
            !['sqlite', 'redis'].includes(String(source.backend))
          ) {
            throw new MessagingError('CONFIG', 'Invalid collector source');
          }
          if (source.backend === 'sqlite' && typeof source.directory !== 'string') {
            throw new MessagingError('CONFIG', 'Local source requires directory');
          }
        }
      }
    }
  }
  if (value.pools !== undefined) {
    for (const [name, config] of Object.entries(record(value.pools, 'pools'))) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new MessagingError('INPUT', 'Invalid pool directory name');
      }
      await normalizePoolConfig(record(config, 'pool config'));
    }
  }
  if (value.messaging !== undefined) {
    validateMessaging(value.messaging);
  }
}
/** Nearest config wins; invalid nearer files are never silently skipped. */
async function discoverConfig(
  start = process.cwd(),
  optional = false,
): Promise<ResolvedConfig | undefined> {
  let directory = resolve(start);
  for (;;) {
    const file = join(directory, 'semaphile.json');
    try {
      await access(file, constants.F_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(directory);
      if (parent === directory) {
        if (optional) {
          return undefined;
        }
        throw new MessagingError(
          'CONFIG',
          'No semaphile.json found; use --store or semaphile init',
        );
      }
      directory = parent;
      continue;
    }
    let value: ProjectConfig;
    try {
      value = JSON.parse(await readFile(file, 'utf8')) as ProjectConfig;
    } catch {
      throw new MessagingError('CONFIG', `Unable to read valid JSON from ${file}`);
    }
    await validateProject(value);
    const root = resolve(directory, value.directory ?? '.');
    return { file, directory: root, messagingPath: join(root, 'messaging'), value };
  }
}
export { messagingOptions, type ConfiguredMessagingOptions } from './configured-options.js';

export async function normalizePoolConfig(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const source = new URL('./pool-config.js', import.meta.url).href;
  const policy = (await import(source)) as {
    normalize: (input: Record<string, unknown>) => Record<string, unknown>;
  };
  return policy.normalize(config);
}
export async function loadConfig(start = process.cwd()): Promise<ResolvedConfig> {
  try {
    return (await discoverConfig(start))!;
  } catch (error) {
    throw new MessagingError('CONFIG', String(error));
  }
}

/** Optional discovery still rejects malformed nearer configuration. */
export async function findConfig(start = process.cwd()): Promise<ResolvedConfig | undefined> {
  return discoverConfig(start, true);
}
