#!/usr/bin/env node
// Parse before opening workers; every command then shares signal and close cleanup.
import { dirname, resolve, join } from 'node:path';
import { poolCommand } from './pool-cli.js';
import { openClient } from './client.js';
import { findConfig, messagingOptions } from './settings.js';
import { init, info, upgradeMessaging } from './admin.js';
import { MessagingError } from './config.js';
import { help, readArguments, validateAction, receivingOptions } from './cli-options.js';
import { commandTelemetry, environmentTrace, flushCommandTelemetry } from './cli-telemetry.js';
import { execute, output } from './cli-actions.js';
async function main(): Promise<void> {
  if (process.argv[2] === 'proxy' && ['http', 'mcp'].includes(process.argv[3])) {
    const mode = process.argv[3];
    const name = mode === 'http' ? '@semaphile/proxy/cli' : '@semaphile/proxy/mcp-cli';
    let implementation: {
      proxyCommand: (args: string[]) => Promise<void>;
      proxyErrorMessage: (error: unknown) => string;
      mcpCommand: (args: string[]) => Promise<void>;
      mcpErrorMessage: (error: unknown) => string;
    };
    try {
      implementation = (await import(name)) as typeof implementation;
    } catch {
      throw new MessagingError('CONFIG', 'Install matching @semaphile/proxy to run a proxy');
    }
    try {
      await (mode === 'http' ? implementation.proxyCommand : implementation.mcpCommand)(
        process.argv.slice(4),
      );
    } catch (error) {
      throw new MessagingError(
        'CONFIG',
        (mode === 'http' ? implementation.proxyErrorMessage : implementation.mcpErrorMessage)(
          error,
        ),
      );
    }
    return;
  }
  if (process.argv[2] === 'telemetry' && process.argv[3] === 'collect') {
    const moduleName = '@semaphile/otel/cli';
    let implementation: { collectorCommand: (args: string[], defaults: unknown) => Promise<void> };
    try {
      implementation = (await import(moduleName)) as typeof implementation;
    } catch {
      throw new MessagingError(
        'CONFIG',
        'Install @semaphile/otel alongside messaging to collect telemetry',
      );
    }
    const argv = process.argv.slice(4);
    let defaults: unknown = {};
    if (!argv.includes('--help')) {
      const project = await findConfig();
      if (project) {
        const collector = project.value.telemetry?.collector;
        defaults = {
          ...collector,
          otel: project.value.telemetry?.enabled ?? false,
          serviceName: project.value.telemetry?.serviceName,
          baggageAllowlist: project.value.telemetry?.baggageAllowlist,
          sources: collector?.sources?.map((source) =>
            source.backend === 'sqlite'
              ? { ...source, directory: resolve(dirname(project.file), source.directory) }
              : source,
          ) ?? [{ name: 'local', backend: 'sqlite', directory: join(project.directory, 'pools') }],
        };
      }
    }
    await implementation.collectorCommand(argv, defaults);
    return;
  }
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
  if (action === 'upgrade') {
    output(await upgradeMessaging({ path: resolved.open.path }));
    return;
  }
  const receiveOptions = receivingOptions(
    args,
    resolved.project?.value.messaging?.listenerDefaults,
  );
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
    process.exitCode = 3;
  };
  const telemetryProject = resolved.project;
  const sdk = await commandTelemetry(args, telemetryProject);
  const run = async () => {
    const client = await openClient({
      ...resolved.open,
      telemetry: sdk
        ? {
            instrumentation: sdk.messagingInstrumentation,
            baggageAllowlist: telemetryProject?.value.telemetry?.baggageAllowlist,
          }
        : undefined,
    });
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      await execute({ action, client, args, resolved, receiveOptions, controller });
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      await client.close();
    }
  };
  try {
    await (sdk ? sdk.withMessageContext(environmentTrace(), run) : run());
  } finally {
    await flushCommandTelemetry(sdk);
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
