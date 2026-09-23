import { MessagingError } from '@semaphile/messaging/client';
import type { Connection, MessagingWireOptions } from './messaging-wire-types.js';

export async function checkReadiness(
  command: Connection,
  options: MessagingWireOptions,
  response: <T>(work: Promise<T>, deadline: number) => Promise<T>,
  deadline: number,
): Promise<void> {
  const issues: string[] = [];
  try {
    const pairs = await response(
      command.sendCommand([
        'CONFIG',
        'GET',
        'appendonly',
        'appendfsync',
        'no-appendfsync-on-rewrite',
        'maxmemory-policy',
      ]),
      deadline,
    );
    if (
      !Array.isArray(pairs) ||
      !pairs.every((value): value is string => typeof value === 'string')
    ) {
      throw new Error('Invalid Redis configuration reply');
    }
    const config: Record<string, string> = {};
    for (let i = 0; i < pairs.length; i += 2) {
      config[pairs[i]] = pairs[i + 1];
    }
    if (config.appendonly !== 'yes') {
      issues.push('AOF persistence is not verified enabled');
    }
    if (config.appendfsync !== 'always') {
      issues.push('Synchronous AOF flushing is not verified');
    }
    if (config['no-appendfsync-on-rewrite'] !== 'no') {
      issues.push('AOF flushing during rewrite is not verified');
    }
    if (config['maxmemory-policy'] !== 'noeviction') {
      issues.push('noeviction is not verified');
    }
    const info = await response(command.sendCommand(['INFO', 'persistence']), deadline);
    if (typeof info !== 'string') {
      throw new Error('Invalid Redis persistence reply');
    }
    if (!/^aof_last_write_status:ok\r?$/m.test(info)) {
      issues.push('AOF health is not verified');
    }
  } catch {
    issues.push('Redis persistence and eviction settings could not be inspected');
  }
  if (!issues.length) {
    return;
  }
  if (options.readiness === 'strict') {
    throw new MessagingError('READINESS', issues.join('; '));
  }
  if (options.onWarning) {
    options.onWarning(issues);
  } else {
    process.emitWarning(issues.join('; '), { code: 'SEMAPHILE_REDIS_READINESS' });
  }
}
