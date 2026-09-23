/** Redis-authoritative messaging. Importing this entry never loads SQLite or native code. */
import { createHash, randomUUID } from 'node:crypto';
import {
  MessagingClient,
  MessagingError,
  normalize,
  differences,
  text,
  integer,
} from '@semaphile/messaging/client';
import type { StoreConfig, Difference, MessageTelemetryOptions } from '@semaphile/messaging/client';
import { MessagingConnection } from './messaging-connection.js';
import { RedisMessagingTransport } from './messaging-transport.js';
export interface RedisMessagingOptions {
  url: string;
  /** Observational open of an existing store; never initializes missing state. */
  inspect?: boolean;
  namespace: string;
  store: string;
  config?: Partial<StoreConfig>;
  configMismatch?: 'warn' | 'error';
  onWarning?: (differences: Difference[]) => void;
  readiness?: 'warn' | 'strict';
  onReadinessWarning?: (issues: readonly string[]) => void;
  operationTimeoutMs?: number;
  maxPendingOperations?: number;
  sessionTimeoutMs?: number;
  telemetry?: MessageTelemetryOptions;
}
export function messagingKey(namespace: string, store: string): string {
  text(namespace, 'namespace');
  text(store, 'store');
  return (
    'semaphile:messaging:' +
    createHash('sha256')
      .update(JSON.stringify([namespace, store]))
      .digest('hex')
  );
}
export async function openRedisMessaging(options: RedisMessagingOptions): Promise<MessagingClient> {
  const config = normalize(options.config);
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new MessagingError('INPUT', 'Invalid Redis URL');
  }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new MessagingError('INPUT', 'Redis URL must use redis or rediss');
  }
  if (options.configMismatch !== undefined && !['warn', 'error'].includes(options.configMismatch)) {
    throw new MessagingError('INPUT', 'Invalid configMismatch');
  }
  if (options.readiness !== undefined && !['warn', 'strict'].includes(options.readiness)) {
    throw new MessagingError('INPUT', 'Invalid readiness');
  }
  const connection = new MessagingConnection(
    {
      url: options.url,
      key: messagingKey(options.namespace, options.store),
      operationTimeoutMs: integer(options.operationTimeoutMs ?? 30000, 'operationTimeoutMs'),
      maxPending: integer(options.maxPendingOperations ?? 1000, 'maxPendingOperations', 1, 100000),
      sessionTimeoutMs: integer(options.sessionTimeoutMs ?? 30000, 'sessionTimeoutMs'),
      readiness: options.readiness ?? 'warn',
      onWarning: options.onReadinessWarning,
    },
    {
      create: !options.inspect,
      identity: randomUUID(),
      config,
      configMismatch: options.inspect ? 'warn' : options.configMismatch,
    },
  );
  try {
    const reply = await connection.open();
    const persisted = normalize(reply.value.config as StoreConfig);
    const diff = differences(config, persisted);
    if (diff.length && !options.inspect) {
      if (options.onWarning) {
        options.onWarning(diff);
      } else {
        process.emitWarning(
          'Messaging config differs; adopting persisted settings: ' + JSON.stringify(diff),
          { code: 'SEMAPHILE_CONFIG_MISMATCH' },
        );
      }
    }
    const transport = new RedisMessagingTransport(connection, persisted);
    return new MessagingClient(
      `redis:${options.namespace}/${options.store}`,
      transport,
      persisted,
      diff,
      options.telemetry,
    );
  } catch (error) {
    await connection.close();
    throw error;
  }
}
