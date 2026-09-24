import { resolve } from 'node:path';
import { MessagingError } from './config.js';
import { loadConfig, type ResolvedConfig } from './settings.js';
import type { OpenOptions, StoreConfig } from './types.js';
export type ConfiguredMessagingOptions =
  | (OpenOptions & { backend?: 'sqlite' })
  | {
      backend: 'redis';
      inspect?: boolean;
      url: string;
      namespace: string;
      store: string;
      config?: Partial<StoreConfig>;
      configMismatch?: 'warn' | 'error';
      readiness?: 'warn' | 'strict';
      operationTimeoutMs?: number;
      maxPendingOperations?: number;
      sessionTimeoutMs?: number;
      telemetry?: OpenOptions['telemetry'];
    };
export async function messagingOptions(
  options: {
    store?: string;
    cwd?: string;
    configMismatch?: 'warn' | 'error';
    redisUrlEnv?: string;
    namespace?: string;
    messagingStore?: string;
    readiness?: 'warn' | 'strict';
  } = {},
): Promise<{ open: ConfiguredMessagingOptions; project?: ResolvedConfig }> {
  const remote = [
    options.redisUrlEnv,
    options.namespace,
    options.messagingStore,
    options.readiness,
  ].some((v) => v !== undefined);
  if (options.store !== undefined && remote) {
    throw new MessagingError('INPUT', 'SQLite and Redis selectors are mutually exclusive');
  }
  if (remote) {
    if (!options.redisUrlEnv || !options.namespace || !options.messagingStore) {
      throw new MessagingError(
        'INPUT',
        'Redis requires --redis-url-env, --namespace and --messaging-store',
      );
    }
    const url = process.env[options.redisUrlEnv];
    if (!url) {
      throw new MessagingError('CONFIG', 'Redis URL environment variable is unset');
    }
    return {
      open: {
        backend: 'redis',
        url,
        namespace: options.namespace,
        store: options.messagingStore,
        readiness: options.readiness,
        configMismatch: options.configMismatch,
      },
    };
  }
  if (options.store !== undefined) {
    return {
      open: {
        path: resolve(options.cwd ?? process.cwd(), options.store),
        configMismatch: options.configMismatch,
      },
    };
  }
  const project = await loadConfig(options.cwd);
  if (!project.value.messaging) {
    throw new MessagingError('CONFIG', 'Nearest semaphile.json does not configure messaging');
  }
  if (project.value.messaging.backend === 'redis') {
    const { urlEnv, ...redis } = project.value.messaging.redis!;
    const url = process.env[urlEnv];
    if (!url) {
      throw new MessagingError('CONFIG', 'Redis URL environment variable is unset');
    }
    return {
      project,
      open: {
        backend: 'redis',
        url,
        ...redis,
        config: project.value.messaging.config,
        configMismatch:
          options.configMismatch ?? project.value.messaging.clientDefaults?.configMismatch,
      },
    };
  }
  return {
    project,
    open: {
      path: project.messagingPath,
      config: project.value.messaging.config,
      configMismatch:
        options.configMismatch ?? project.value.messaging.clientDefaults?.configMismatch,
    },
  };
}
