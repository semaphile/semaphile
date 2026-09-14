import { ProxyInputError } from './errors.js';
import { openPool } from './settings.js';
import { readMcpConfig } from './mcp-settings.js';
import { startMcpProxy } from './mcp.js';
export const mcpHelp =
  'Usage: semaphile proxy mcp --config FILE [--drain]\nStandalone: semaphile-mcp-proxy --config FILE [--drain]\nStdout is reserved for MCP protocol frames.';
export function mcpErrorMessage(error: unknown): string {
  return error instanceof ProxyInputError ? error.message : 'MCP proxy failed';
}
export async function mcpCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    console.log(mcpHelp);
    return;
  }
  let file: string | undefined,
    drain = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && !file && args[i + 1] && !args[i + 1].startsWith('--')) {
      file = args[++i];
    } else if (args[i] === '--drain' && !drain) {
      drain = true;
    } else {
      throw new ProxyInputError(mcpHelp);
    }
  }
  if (!file) {
    throw new ProxyInputError(mcpHelp);
  }
  const config = await readMcpConfig(file);
  // Native pool open is not cancellable; retain default process termination until ready.
  const limiter = await openPool(config.pool);
  let proxy: Awaited<ReturnType<typeof startMcpProxy>> | undefined;
  const stop = () => {
    void proxy?.close({ drain });
  };
  try {
    proxy = await startMcpProxy({ ...config.options, limiter });
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await proxy.finished;
    if (proxy.inspect().error) {
      throw new Error('MCP proxy failed');
    }
  } finally {
    try {
      await proxy?.close({ drain });
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      await limiter.close();
      // CLI owns stdout. A host that stops reading must not retain this process.
      process.stdin.destroy();
      process.stdout.destroy();
    }
  }
}
