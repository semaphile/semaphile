// Pool administration joins an existing configured limiter. Explicit SQLite paths
// read persisted policy first; Redis callers supply the full expected policy.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectStore } from './admin.js';
import { loadConfig } from './settings.js';
import { MessagingError } from './config.js';
import type { Arguments } from './cli-options.js';
import { output } from './cli-actions.js';
type Receipt = { maintenance: { generation: number } };
interface PoolClient {
  maintenance: {
    status(): Promise<unknown>;
    drain(): Promise<Receipt>;
    wait(options: {
      generation: number;
      timeoutMs?: number;
      signal: AbortSignal;
    }): Promise<unknown>;
    acknowledge(options: { generation: number; ids: string[]; reason: string }): Promise<unknown>;
    resume(generation: number): Promise<unknown>;
  };
  close(): Promise<void>;
}
async function openPool(args: Arguments): Promise<PoolClient> {
  const { get, required } = args;
  let moduleName = '@semaphile/core';
  let options: Record<string, unknown>;
  const readConfig = async () =>
    (await readJson(required('pool-config'))) as Record<string, unknown>;
  if (get('redis-url-env') !== undefined) {
    if (get('store') !== undefined) {
      throw new MessagingError('INPUT', 'Redis and --store are mutually exclusive');
    }
    const url = process.env[required('redis-url-env')];
    if (!url) {
      throw new MessagingError('INPUT', 'Redis URL environment variable is empty');
    }
    moduleName = '@semaphile/redis';
    options = {
      url,
      create: false,
      pool: required('pool'),
      namespace: get('namespace'),
      config: await readConfig(),
      ownerTimeoutMs: args.numeric('owner-timeout'),
    };
  } else if (get('store') !== undefined) {
    const path = resolve(required('store'));
    const stored = await inspectStore(path);
    if (!stored.format.startsWith('semaphile-sqlite-poc/')) {
      throw new MessagingError('INPUT', 'Selected store is not a limiter pool');
    }
    options = {
      path,
      config: get('pool-config') !== undefined ? await readConfig() : stored.config,
    };
  } else {
    const project = await loadConfig();
    const name = required('name'),
      config = project.value.pools?.[name];
    if (!config) {
      throw new MessagingError('INPUT', 'Named pool is absent from semaphile.json');
    }
    const path = join(project.directory, 'pools', name);
    await inspectStore(path); // Never create a fresh pool as a side effect of administration.
    options = { path, config };
  }
  let implementation: { openLimiter: (options: Record<string, unknown>) => Promise<PoolClient> };
  try {
    implementation = (await import(moduleName)) as typeof implementation;
  } catch {
    throw new MessagingError(
      'CONFIG',
      `Install the matching ${moduleName} package for pool administration`,
    );
  }
  return implementation.openLimiter(options);
}
async function readJson(file: string): Promise<unknown> {
  const contents = await readFile(file, 'utf8');
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new MessagingError('INPUT', `Invalid JSON in ${file}`);
  }
}
export async function poolCommand(args: Arguments): Promise<void> {
  const { action, get, required, numeric } = args;
  if (!action || !['status', 'drain', 'wait', 'acknowledge', 'resume'].includes(action)) {
    throw new MessagingError('INPUT', 'Pool commands: status, drain, wait, acknowledge, resume');
  }
  for (const key of [
    'store',
    'redis-url-env',
    'name',
    'pool',
    'pool-config',
    'namespace',
    'ids-file',
  ]) {
    if (get(key) !== undefined && !get(key)!.trim()) {
      throw new MessagingError('INPUT', `--${key} cannot be empty`);
    }
  }
  if (
    get('store') === undefined &&
    get('redis-url-env') === undefined &&
    get('pool-config') !== undefined
  ) {
    throw new MessagingError('INPUT', '--pool-config requires --store or --redis-url-env');
  }
  const timeoutMs = numeric('timeout');
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
  ) {
    throw new MessagingError('INPUT', 'Invalid --timeout');
  }
  const generation = ['wait', 'acknowledge', 'resume'].includes(action)
    ? numeric('generation')
    : undefined;
  if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) {
    throw new MessagingError('INPUT', 'Invalid --generation');
  }
  if (['wait', 'acknowledge', 'resume'].includes(action) && generation === undefined) {
    throw new MessagingError('INPUT', '--generation required');
  }
  let ids: string[] = [];
  if (action === 'acknowledge') {
    ids = (await readJson(required('ids-file'))) as string[];
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => typeof id !== 'string' || !id) ||
      !required('reason').trim() ||
      required('reason').length > 4096
    ) {
      throw new MessagingError('INPUT', 'Acknowledgement requires a string ID array and a reason');
    }
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let client: PoolClient | undefined;
  try {
    // During startup, default OS termination also stops a blocked native gate
    // wait and reclaims descriptors. Only an opened client can close gracefully.
    client = await openPool(args);
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    if (controller.signal.aborted) {
      throw Object.assign(new Error('Pool command aborted'), { name: 'AbortError' });
    }
    const maintenance = client.maintenance;
    let result: unknown;
    if (action === 'status') {
      result = await maintenance.status();
    } else if (action === 'drain') {
      result = await maintenance.drain();
    } else if (action === 'wait') {
      result = await maintenance.wait({
        generation: generation!,
        timeoutMs,
        signal: controller.signal,
      });
    } else if (action === 'resume') {
      result = await maintenance.resume(generation!);
    } else {
      result = await maintenance.acknowledge({
        generation: generation!,
        ids,
        reason: get('reason')!,
      });
    }
    output(result);
  } finally {
    await client?.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
