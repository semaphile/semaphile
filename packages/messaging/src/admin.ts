import { Worker } from 'node:worker_threads';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openClient } from './client.js';
import { loadConfig, normalizePoolConfig } from './settings.js';
import type { ProjectConfig } from './settings.js';
import { MessagingError, normalize } from './config.js';
export interface StoreInfo {
  path: string;
  format: string;
  config: Record<string, unknown>;
}
export function inspectStore(path: string): Promise<StoreInfo> {
  const worker = new Worker(new URL('./inspect-worker.js', import.meta.url), {
    workerData: { path: resolve(path) },
  });
  return readInspection(worker);
}
// Every worker termination must settle the caller, even a clean exit without a reply.
export function readInspection(worker: Worker): Promise<StoreInfo> {
  return new Promise((resolveInfo, reject) => {
    worker.once('error', reject);
    worker.once('message', (reply: { value: StoreInfo; error?: string }) => {
      if (reply.error) {
        reject(new MessagingError('STORE', reply.error));
      } else {
        resolveInfo(reply.value);
      }
    });
    worker.once('exit', (code) => {
      reject(new MessagingError('STORE', `Inspection worker exited without a reply (${code})`));
    });
  });
}
export async function init(
  options: { cwd?: string; directory?: string } = {},
): Promise<{ file: string; directory: string }> {
  if (options.directory !== undefined && !options.directory) {
    throw new MessagingError('INPUT', 'directory cannot be empty');
  }
  const cwd = resolve(options.cwd ?? process.cwd()),
    file = join(cwd, 'semaphile.json');
  await mkdir(cwd, { recursive: true });
  const initial: ProjectConfig = {
    version: 1,
    directory: options.directory ?? './.semaphile',
    pools: {},
    messaging: { config: {}, clientDefaults: { configMismatch: 'warn' }, listenerDefaults: {} },
  };
  try {
    await writeFile(file, JSON.stringify(initial, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  const project = await loadConfig(cwd);
  if (options.directory && resolve(cwd, options.directory) !== project.directory) {
    throw new MessagingError('CONFIG_MISMATCH', 'Existing config selects a different directory');
  }
  if (project.value.messaging) {
    const client = await openClient({
      path: project.messagingPath,
      config: project.value.messaging.config,
      configMismatch: 'error',
    });
    await client.close();
  }
  if (Object.keys(project.value.pools ?? {}).length) {
    // Pools remain owned by the core API. The optional import occurs only when
    // explicitly initializing configured pools, never for messaging consumers.
    const packageName = '@semaphile/core';
    let core: {
      openLimiter: (options: {
        path: string;
        config: Record<string, unknown>;
      }) => Promise<{ close: () => Promise<void> }>;
    };
    try {
      core = (await import(packageName)) as typeof core;
    } catch {
      throw new MessagingError(
        'CONFIG',
        'Install @semaphile/core alongside messaging to initialize configured pools',
      );
    }
    for (const [name, config] of Object.entries(project.value.pools ?? {})) {
      const pool = await core.openLimiter({ path: join(project.directory, 'pools', name), config });
      await pool.close();
    }
  }
  return { file, directory: project.directory };
}
export async function info(
  options: { cwd?: string; store?: string; expectedConfig?: Record<string, unknown> } = {},
): Promise<unknown> {
  if (options.store) {
    const persisted = await inspectStore(resolve(options.cwd ?? process.cwd(), options.store));
    let expected: Record<string, unknown> | null = null;
    if (options.expectedConfig !== undefined) {
      expected = persisted.format.startsWith('semaphile-messaging/')
        ? { ...normalize(options.expectedConfig) }
        : await normalizePoolConfig(options.expectedConfig);
    }
    const differences = expected === null ? null : configDifferences(expected, persisted.config);
    return {
      ...persisted,
      expected,
      differences,
      comparison: expected === null ? 'No expectations supplied' : 'Full normalized configuration',
    };
  }
  const project = await loadConfig(options.cwd);
  const stores: { name: string; path: string; expected: unknown }[] = [];
  if (project.value.messaging) {
    stores.push({
      name: 'messaging',
      path: project.messagingPath,
      expected: normalize(project.value.messaging.config),
    });
  }
  for (const [name, config] of Object.entries(project.value.pools ?? {})) {
    stores.push({
      name,
      path: join(project.directory, 'pools', name),
      expected: await normalizePoolConfig(config),
    });
  }
  const result = [];
  for (const store of stores) {
    try {
      await access(join(store.path, 'state.sqlite'));
      const persisted = await inspectStore(store.path);
      const expected = store.expected as Record<string, unknown>;
      const differences = configDifferences(expected, persisted.config);
      result.push({ name: store.name, ...persisted, expected, differences });
    } catch (error) {
      result.push({ ...store, error: String(error) });
    }
  }
  return { file: project.file, directory: project.directory, stores: result };
}

function configDifferences(expected: Record<string, unknown>, actual: Record<string, unknown>) {
  return Object.keys(expected)
    .filter((key) => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]))
    .map((field) => ({ field, expected: expected[field], actual: actual[field] }));
}

/** Offline format upgrade. Stop every client first, including unregistered ones. */
export function upgradeMessaging(options: { path: string }): Promise<StoreInfo> {
  return readInspection(
    new Worker(new URL('./inspect-worker.js', import.meta.url), {
      workerData: { path: resolve(options.path), upgrade: true },
    }),
  );
}
