import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ProxyInputError } from './errors.js';
import { object, text, environment, parsePool } from './settings.js';
import type { McpProxyOptions } from './mcp-types.js';
export async function readMcpConfig(file: string) {
  const path = resolve(file),
    directory = dirname(path);
  const value = object(
    JSON.parse(await readFile(path, 'utf8')),
    [
      'version',
      'pool',
      'command',
      'args',
      'cwd',
      'env',
      'stderr',
      'maxMessageBytes',
      'maxBufferedBytes',
      'maxPending',
      'maxControlPending',
      'queueTimeoutMs',
      'requestTimeoutMs',
      'cancellationGraceMs',
      'shutdownGraceMs',
      'toolWeights',
    ],
    'MCP proxy',
  );
  if (value.version !== 1) {
    throw new ProxyInputError('MCP proxy config requires version 1');
  }
  const env: Record<string, string> = Object.create(null);
  if (value.env !== undefined) {
    if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env)) {
      throw new ProxyInputError('Invalid MCP environment mapping');
    }
    for (const [name, variable] of Object.entries(value.env)) {
      env[name] = environment(variable, 'MCP child');
    }
  }
  const { version: _version, pool, ...options } = value;
  return {
    pool: parsePool(pool, directory),
    options: {
      ...options,
      command: text(value.command, 'MCP executable'),
      env,
      ...(value.cwd === undefined
        ? { cwd: directory }
        : { cwd: resolve(directory, text(value.cwd, 'MCP working directory')) }),
    } as Omit<McpProxyOptions, 'limiter'>,
  };
}
