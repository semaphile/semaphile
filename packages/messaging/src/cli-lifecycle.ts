import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { commandHandler } from './command-handler.js';
import { MessagingError } from './config.js';
import { output } from './cli-actions.js';
import type { Context } from './cli-actions.js';
export async function register(context: Context): Promise<void> {
  const {
    client,
    args: { get, required, command },
    controller,
  } = context;

  const agent = await client.register(required('name'), get('metadata'));
  if (controller.signal.aborted) {
    await client.unregister(agent.id);
    return;
  }
  output(agent);
  if (command.length) {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: false });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      const [code] = await once(child, 'exit');
      process.exitCode = controller.signal.aborted ? 3 : Number(code ?? 1);
    } finally {
      controller.signal.removeEventListener('abort', abort);
      if (killTimer) {
        clearTimeout(killTimer);
      }
    }
  } else {
    await once(controller.signal, 'abort');
  }
  await client.unregister(agent.id);
}
export async function waitForMessage(context: Context): Promise<void> {
  const {
    client,
    args: { required, numeric },
    receiveOptions,
    controller,
  } = context;

  const delivery = await client.wait(required('as'), {
    ...receiveOptions,
    timeoutMs: numeric('timeout'),
    signal: controller.signal,
  });
  if (delivery === null) {
    process.exitCode = 2;
  } else {
    output(delivery);
  }
}
export async function listen(context: Context): Promise<void> {
  const {
    client,
    args: { required, numeric, command },
    resolved,
    receiveOptions,
    controller,
  } = context;

  const executable = command.length ? command : resolved.project?.value.messaging?.handler;
  if (!executable) {
    throw new MessagingError(
      'INPUT',
      'Supply a handler command after -- or configure messaging.handler',
    );
  }
  const listener = client.listen(
    required('as'),
    commandHandler(executable, {
      cwd: resolved.project ? dirname(resolved.project.file) : undefined,
    }),
    {
      ...resolved.project?.value.messaging?.listenerDefaults,
      ...receiveOptions,
      concurrency:
        numeric('concurrency') ?? resolved.project?.value.messaging?.listenerDefaults?.concurrency,
    },
  );
  const stop = () => {
    void listener.close({ cancel: true }).catch((error) => {
      console.error(error);
      process.exitCode = 4;
    });
  };
  controller.signal.addEventListener('abort', stop, { once: true });
  if (controller.signal.aborted) {
    stop();
  }
  try {
    await listener.done;
  } finally {
    controller.signal.removeEventListener('abort', stop);
  }
}
