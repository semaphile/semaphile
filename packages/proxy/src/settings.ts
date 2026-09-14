import { ProxyInputError } from './errors.js';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  normalizePoolConfig,
  type PoolConfig,
  type ScheduledLimiter,
} from '@semaphile/core/client';
import type { HttpProxyOptions, HttpRoute } from './types.js';
import { overrideHeaders } from './headers.js';

type Pool =
  | { backend: 'memory'; key: string; config: PoolConfig }
  | { backend: 'sqlite'; path: string; config: PoolConfig }
  | {
      backend: 'redis';
      url: string;
      namespace?: string;
      pool: string;
      ownerTimeoutMs?: number;
      config: PoolConfig;
    };
type RouteConfig = Omit<HttpRoute, 'limiter'> & { pool: Pool };
export type ProxyConfig = Omit<HttpProxyOptions, 'routes'> & { routes: RouteConfig[] };
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new ProxyInputError('Invalid ' + label + ' configuration');
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new ProxyInputError('Invalid ' + label);
  }
  return value;
}
function environment(value: unknown, label: string): string {
  const name = text(value, label);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || !process.env[name]) {
    throw new ProxyInputError('Missing or invalid ' + label + ' environment variable');
  }
  return process.env[name]!;
}
/** Read one explicit file; never discover a different pool from the current directory. */
export async function readProxyConfig(file: string): Promise<ProxyConfig> {
  const path = resolve(file);
  const value = object(
    JSON.parse(await readFile(path, 'utf8')),
    [
      'version',
      'host',
      'port',
      'allowedHosts',
      'tokenEnv',
      'maxPending',
      'maxConnections',
      'routes',
    ],
    'proxy',
  );
  if (value.version !== 1 || !Array.isArray(value.routes)) {
    throw new ProxyInputError('Proxy config requires version 1 and routes');
  }
  const routes = value.routes.map((input) => {
    const route = object(
      input,
      ['name', 'upstream', 'pool', 'headersEnv', 'weight', 'queueTimeoutMs', 'requestTimeoutMs'],
      'route',
    );
    const pool = object(
      route.pool,
      ['backend', 'path', 'key', 'urlEnv', 'namespace', 'pool', 'ownerTimeoutMs', 'config'],
      'pool',
    );
    const config = normalizePoolConfig(
      object(
        pool.config,
        [
          'maxConcurrent',
          'expirationMs',
          'minTime',
          'reservoir',
          'reservoirRefreshAmount',
          'reservoirRefreshInterval',
          'recovery',
        ],
        'limiter',
      ) as PoolConfig,
    );
    let resolved: Pool;
    if (pool.backend === 'sqlite') {
      if (
        ['key', 'urlEnv', 'namespace', 'pool', 'ownerTimeoutMs'].some(
          (key) => pool[key] !== undefined,
        )
      ) {
        throw new ProxyInputError('Invalid SQLite pool fields');
      }
      resolved = {
        backend: 'sqlite',
        path: resolve(dirname(path), text(pool.path, 'pool path')),
        config,
      };
    } else if (pool.backend === 'memory') {
      if (
        ['path', 'urlEnv', 'namespace', 'pool', 'ownerTimeoutMs'].some(
          (key) => pool[key] !== undefined,
        )
      ) {
        throw new ProxyInputError('Invalid memory pool fields');
      }
      resolved = { backend: 'memory', key: text(pool.key, 'memory key'), config };
    } else if (pool.backend === 'redis') {
      if (pool.path !== undefined || pool.key !== undefined) {
        throw new ProxyInputError('Invalid Redis pool fields');
      }
      resolved = {
        backend: 'redis',
        url: environment(pool.urlEnv, 'Redis URL'),
        pool: text(pool.pool, 'Redis pool'),
        ...(pool.namespace === undefined
          ? {}
          : { namespace: text(pool.namespace, 'Redis namespace') }),
        ...(pool.ownerTimeoutMs === undefined
          ? {}
          : { ownerTimeoutMs: pool.ownerTimeoutMs as number }),
        config,
      };
    } else {
      throw new ProxyInputError('Unsupported proxy pool backend');
    }
    const headers: Record<string, string> = Object.create(null);
    if (route.headersEnv !== undefined) {
      if (
        !route.headersEnv ||
        typeof route.headersEnv !== 'object' ||
        Array.isArray(route.headersEnv)
      ) {
        throw new ProxyInputError('Invalid headersEnv');
      }
      for (const [name, env] of Object.entries(route.headersEnv)) {
        headers[name] = environment(env, 'upstream header');
      }
    }
    return {
      name: text(route.name, 'route name'),
      upstream: text(route.upstream, 'upstream'),
      pool: resolved,
      headers: overrideHeaders(headers),
      ...(route.weight === undefined ? {} : { weight: route.weight as number }),
      ...(route.queueTimeoutMs === undefined
        ? {}
        : { queueTimeoutMs: route.queueTimeoutMs as number }),
      ...(route.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: route.requestTimeoutMs as number }),
    };
  });
  return {
    routes,
    ...(value.host === undefined ? {} : { host: text(value.host, 'proxy host') }),
    ...(value.port === undefined ? {} : { port: value.port as number }),
    ...(value.maxPending === undefined ? {} : { maxPending: value.maxPending as number }),
    ...(value.maxConnections === undefined
      ? {}
      : { maxConnections: value.maxConnections as number }),
    ...(value.allowedHosts === undefined ? {} : { allowedHosts: value.allowedHosts as string[] }),
    ...(value.tokenEnv === undefined ? {} : { token: environment(value.tokenEnv, 'proxy token') }),
  };
}
export async function openPool(pool: Pool): Promise<ScheduledLimiter> {
  if (pool.backend === 'memory') {
    return (await import('@semaphile/core/memory')).openLimiter({
      key: pool.key,
      config: pool.config,
    });
  }
  if (pool.backend === 'sqlite') {
    return (await import('@semaphile/core')).openLimiter({ path: pool.path, config: pool.config });
  }
  const name = '@semaphile/redis';
  const implementation = (await import(name)) as {
    openLimiter(options: Omit<typeof pool, 'backend'>): Promise<ScheduledLimiter>;
  };
  const { backend: _backend, ...options } = pool;
  return implementation.openLimiter(options);
}
