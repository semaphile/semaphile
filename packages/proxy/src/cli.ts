#!/usr/bin/env node
import { ProxyInputError } from './errors.js';
import { proxyCommand } from './command.js';
void proxyCommand(process.argv.slice(2)).catch((error: unknown) => {
  // Runtime/network errors can carry credential-bearing URLs; only input errors are shown.
  console.error(error instanceof ProxyInputError ? error.message : 'HTTP proxy failed');
  process.exitCode = 1;
});
