import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { constants } from 'node:fs';
import { record, listenerDefaults } from './validation.js';
import { MessagingError, normalize } from './config.js';
import type { ListenerOptions, OpenOptions, StoreConfig } from './types.js';
export interface ProjectConfig {
  version: 1;
  directory: string;
  pools?: Record<string, Record<string, unknown>>;
  messaging?: {
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
  record(value, 'messaging', ['config', 'clientDefaults', 'listenerDefaults', 'handler']);
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
  if (value?.version !== 1 || typeof value.directory !== 'string' || !value.directory) {
    throw new MessagingError('CONFIG', 'Config requires version: 1 and a directory');
  }
  record(value, 'config', ['version', 'directory', 'pools', 'messaging']);
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
async function discoverConfig(start = process.cwd()): Promise<ResolvedConfig> {
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
    const root = resolve(directory, value.directory);
    return { file, directory: root, messagingPath: join(root, 'messaging'), value };
  }
}
export async function messagingOptions(
  options: { store?: string; cwd?: string; configMismatch?: 'warn' | 'error' } = {},
): Promise<{ open: OpenOptions; project?: ResolvedConfig }> {
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
    return await discoverConfig(start);
  } catch (error) {
    throw new MessagingError('CONFIG', String(error));
  }
}
