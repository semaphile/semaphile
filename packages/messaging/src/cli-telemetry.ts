// Optional standalone SDK lives in the addon. CLI output and protocol exit codes
// remain owned by the operation, including when export or bounded flush fails.
import type { Arguments } from './cli-options.js';
import type { ResolvedConfig } from './settings.js';
import type { MessageInstrumentation } from './telemetry.js';
import type { TraceCarrier } from './trace.js';
import { MessagingError } from './config.js';
interface CommandTelemetry {
  messagingInstrumentation: MessageInstrumentation;
  withMessageContext<T>(carrier: TraceCarrier, callback: () => T): T;
  shutdown(): Promise<void>;
}
export async function commandTelemetry(
  args: Arguments,
  project?: ResolvedConfig,
): Promise<CommandTelemetry | undefined> {
  if (args.otel && args.noOtel) {
    throw new MessagingError('INPUT', 'Choose --otel or --no-otel');
  }
  if (args.noOtel || !(args.otel ?? project?.value.telemetry?.enabled)) {
    return undefined;
  }
  const packageName = '@semaphile/otel/sdk';
  let sdk: {
    startTelemetry: (options: {
      serviceName?: string;
      baggageAllowlist?: string[];
    }) => Promise<CommandTelemetry>;
  };
  try {
    sdk = (await import(packageName)) as typeof sdk;
  } catch {
    throw new MessagingError(
      'CONFIG',
      'Install @semaphile/otel alongside messaging to export telemetry',
    );
  }
  try {
    return await sdk.startTelemetry({
      serviceName: project?.value.telemetry?.serviceName,
      baggageAllowlist: project?.value.telemetry?.baggageAllowlist,
    });
  } catch {
    process.stderr.write('Semaphile telemetry initialization failed; continuing command\n');
    return undefined;
  }
}
export const environmentTrace = (): TraceCarrier => ({
  traceparent: process.env.TRACEPARENT,
  tracestate: process.env.TRACESTATE,
  baggage: process.env.BAGGAGE,
});
export async function flushCommandTelemetry(sdk?: CommandTelemetry): Promise<void> {
  try {
    await sdk?.shutdown();
  } catch {
    process.stderr.write('Semaphile telemetry flush failed\n');
  }
}
