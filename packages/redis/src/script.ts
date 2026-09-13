// Compose the auditable pure control rules with their Redis transaction boundary.
import { readFileSync } from 'node:fs';
export const script = readFileSync(new URL('./protocol.lua', import.meta.url), 'utf8').replace(
  '-- semaphile-control-module',
  readFileSync(new URL('./control.lua', import.meta.url), 'utf8'),
);
