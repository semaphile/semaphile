#!/usr/bin/env node
import { proxyCommand, proxyErrorMessage } from './command.js';
void proxyCommand(process.argv.slice(2)).catch((error: unknown) => {
  // Runtime/network errors can carry credential-bearing URLs; only input errors are shown.
  console.error(proxyErrorMessage(error));
  process.exitCode = 1;
});
