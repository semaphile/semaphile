#!/usr/bin/env node
import { mcpCommand, mcpErrorMessage } from './mcp-command.js';
void mcpCommand(process.argv.slice(2)).catch((error: unknown) => {
  console.error(mcpErrorMessage(error));
  process.exitCode = 1;
});
