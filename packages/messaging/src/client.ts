// SQLite opening is isolated from the shared lifecycle so remote clients load no native code.
import { Worker } from 'node:worker_threads';
import { realpath, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MessagingClient } from './shared-client.js';
import { MessagingError, normalize } from './config.js';
import type { OpenOptions, StoreConfig, Difference } from './types.js';
export { MessagingClient } from './shared-client.js';
export async function openClient(options: OpenOptions, inspect = false): Promise<MessagingClient> {
  const config = normalize(options.config);
  if (options.configMismatch !== undefined && !['warn', 'error'].includes(options.configMismatch)) {
    throw new MessagingError('INPUT', 'Invalid configMismatch');
  }
  const path = resolve(options.path);
  if (!inspect) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const canonical = await realpath(path);
  const worker = new Worker(new URL('./coordinator.js', import.meta.url), {
    workerData: { path: canonical, config, configMismatch: options.configMismatch, inspect },
  });
  return new Promise((resolveClient, reject) => {
    const fail = (error: Error) => {
      worker.off('message', ready);
      reject(error);
    };
    const ready = (reply: {
      ready: boolean;
      config: StoreConfig;
      differences: Difference[];
      error?: string;
      code?: string;
    }) => {
      worker.off('error', fail);
      worker.off('message', ready);
      if (!reply.ready) {
        reject(new MessagingError(reply.code ?? 'STORE', reply.error ?? 'Startup failed'));
        return;
      }
      const client = new MessagingClient(
        canonical,
        worker,
        reply.config,
        reply.differences,
        options.telemetry,
      );
      if (reply.differences.length && !inspect) {
        try {
          if (options.onWarning) {
            options.onWarning(reply.differences);
          } else {
            process.emitWarning(
              `Messaging config differs; adopting persisted settings: ${JSON.stringify(reply.differences)}`,
              { code: 'SEMAPHILE_CONFIG_MISMATCH' },
            );
          }
        } catch (error) {
          void client.close().then(
            () => reject(error),
            (error_) =>
              reject(new AggregateError([error, error_], 'Warning callback and cleanup failed')),
          );
          return;
        }
      }
      resolveClient(client);
    };
    worker.once('error', fail);
    worker.once('message', ready);
  });
}
