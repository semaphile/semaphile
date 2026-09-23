import { MessagingError } from './config.js';
import type { MessagingClient } from './shared-client.js';
import type { OpenOptions } from './types.js';
import type { ConfiguredMessagingOptions } from './settings.js';
/** Load only the selected backend; Redis never opens local coordination files. */
export async function openConfiguredMessaging(
  options: ConfiguredMessagingOptions,
): Promise<MessagingClient> {
  if (options.backend === 'redis') {
    const moduleName = '@semaphile/redis/messaging';
    let backend: { openRedisMessaging: (options: unknown) => Promise<MessagingClient> };
    try {
      backend = (await import(moduleName)) as typeof backend;
    } catch (error) {
      const failure = new MessagingError(
        'CONFIG',
        'Install matching @semaphile/redis to use Redis messaging',
      );
      failure.cause = error;
      throw failure;
    }
    return backend.openRedisMessaging(options);
  }
  const { openClient } = await import('./client.js');
  return openClient(options as OpenOptions);
}
