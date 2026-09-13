import { spawn } from 'node:child_process';
import type { Handler } from './types.js';
import { MessagingError } from './config.js';
/** Run a consumer-owned adapter. Exit zero must mean durable acceptance. */
export function commandHandler(command: string[], options: { cwd?: string } = {}): Handler {
  if (!command.length || command.some((arg) => typeof arg !== 'string') || !command[0]) {
    throw new MessagingError('INPUT', 'Handler requires an executable and argument array');
  }
  return (delivery, context) => runCommand(command, options, delivery, context);
}
function runCommand(
  command: string[],
  options: { cwd?: string },
  delivery: Parameters<Handler>[0],
  context: Parameters<Handler>[1],
): Promise<void> {
  return new Promise<void>((resolveHandler, reject) => {
    if (context.signal.aborted) {
      reject(context.signal.reason);
      return;
    }
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false,
    });
    let inputError: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) {
      abort();
    }
    const clean = () => {
      context.signal.removeEventListener('abort', abort);
      if (killTimer) {
        clearTimeout(killTimer);
      }
    };
    child.once('error', (error) => {
      clean();
      reject(error);
    });
    child.once('close', (code, signal) => {
      clean();
      if (code === 0 && !context.signal.aborted && !inputError) {
        resolveHandler();
      } else {
        reject(new MessagingError('HANDLER', `Handler exited code=${code} signal=${signal}`));
      }
    });
    child.stdin.on('error', (error) => {
      inputError = error;
    });
    child.stdin.end(JSON.stringify(delivery) + '\n');
  });
}
