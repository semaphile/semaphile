import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function nativePath(): string {
  const target = `${process.platform}-${process.arch}`;
  const path = fileURLToPath(new URL(`../native/${target}.node`, import.meta.url));
  if (!existsSync(path)) {
    throw new Error(
      `Semaphile native artifact missing for ${target}; install an archive built for this target`,
    );
  }
  return path;
}
