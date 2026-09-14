import { ProxyInputError } from './errors.js';
import type { ScheduledLimiter } from '@semaphile/core/client';
import { startHttpProxy } from './index.js';
import { readProxyConfig, openPool } from './settings.js';
import type { HttpProxy, HttpRoute } from './types.js';

export const help =
  'Usage: semaphile proxy http --config FILE [--drain]\n' +
  'Standalone: semaphile-http-proxy --config FILE [--drain]\n' +
  'Starts configured HTTP routes. --drain finishes accepted requests on shutdown.';
/** CLI owns clients; library callers own theirs. Startup retains default signal termination until uncancellable opens finish. */
export async function proxyCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log(help);
    return;
  }
  let file: string | undefined;
  let drain = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && !file && args[i + 1] && !args[i + 1].startsWith('--')) {
      file = args[++i];
    } else if (args[i] === '--drain' && !drain) {
      drain = true;
    } else {
      throw new ProxyInputError(help);
    }
  }
  if (!file) {
    throw new ProxyInputError(help);
  }
  const clients: ScheduledLimiter[] = [];
  const failures: unknown[] = [];
  let proxy: HttpProxy | undefined;
  let stopping = false;
  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const stop = () => {
    stopping = true;
    resolveStop();
  };
  try {
    const config = await readProxyConfig(file);
    const routes: HttpRoute[] = [];
    for (const route of config.routes) {
      if (stopping) {
        break;
      }
      const limiter = await openPool(route.pool);
      clients.push(limiter);
      routes.push({ ...route, limiter });
    }
    if (!stopping) {
      proxy = await startHttpProxy({ ...config, routes });
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      console.log(
        JSON.stringify({ listening: proxy.url, routes: routes.map((route) => route.name) }),
      );
      await stopped;
    }
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await proxy?.close({ drain });
    } catch (error) {
      failures.push(error);
    }
    const results = await Promise.allSettled(clients.map((client) => client.close()));
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    for (const result of results) {
      if (result.status === 'rejected') {
        failures.push(result.reason);
      }
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Proxy operation and cleanup failed');
  }
}

/** Only validated input errors are safe to print at either CLI entry point. */
export function proxyErrorMessage(error: unknown): string {
  return error instanceof ProxyInputError ? error.message : 'HTTP proxy failed';
}
