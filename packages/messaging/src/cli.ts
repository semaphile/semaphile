#!/usr/bin/env node
// Parse before opening workers; every command then shares signal and close cleanup.
import { poolCommand } from './pool-cli.js';
import { openClient } from './client.js';
import { messagingOptions } from './settings.js';
import { init, info } from './admin.js';
import { MessagingError } from './config.js';
import { help, readArguments, validateAction, receivingOptions } from './cli-options.js';
import { execute, output } from './cli-actions.js';
async function main(): Promise<void> {
  const args = readArguments();
  const { group, action, get } = args;
  if (args.help || !group) {
    console.log(help);
    return;
  }
  if (group === 'init') {
    output(await init({ directory: get('directory') }));
    return;
  }
  if (group === 'pool') {
    await poolCommand(args);
    return;
  }
  if (group === 'info') {
    output(await info({ store: get('store') }));
    return;
  }
  if (group !== 'message' || !action) {
    throw new MessagingError('INPUT', help);
  }
  validateAction(action, args);
  const mismatch = get('config-mismatch');
  if (mismatch !== undefined && mismatch !== 'warn' && mismatch !== 'error') {
    throw new MessagingError('INPUT', 'Invalid --config-mismatch');
  }
  const resolved = await messagingOptions({ store: get('store'), configMismatch: mismatch });
  const receiveOptions = receivingOptions(
    args,
    resolved.project?.value.messaging?.listenerDefaults,
  );
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
    process.exitCode = 3;
  };
  const client = await openClient(resolved.open);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await execute({ action, client, args, resolved, receiveOptions, controller });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await client.close();
  }
}
try {
  await main();
} catch (error) {
  console.error(String(error));
  process.exitCode = 4;
  if (error instanceof Error) {
    if ('code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_')) {
      process.exitCode = 5;
    } else if (error.name === 'DrainTimeoutError') {
      process.exitCode = 2;
    } else if (error.name === 'AbortError') {
      process.exitCode = 3;
    } else if (
      ['InputError', 'RangeError', 'PoolDrainingError', 'CircuitOpenError'].includes(error.name)
    ) {
      process.exitCode = 5;
    }
  }
  if (error instanceof MessagingError) {
    if (error.code === 'ABORTED') {
      process.exitCode = 3;
    } else if (['INPUT', 'REFUSED', 'STALE'].includes(error.code)) {
      process.exitCode = 5;
    }
  }
}
