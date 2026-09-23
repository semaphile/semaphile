import { parseArgs } from 'node:util';
import { MessagingError, mode } from './config.js';
import type { ReceiveOptions } from './types.js';
export const help = `Usage: semaphile init [--directory PATH]
       semaphile telemetry collect [--help]
       semaphile info [--store PATH]
       semaphile pool <status|drain|wait|acknowledge|resume> [--name NAME | --store PATH]
       semaphile message <command> [--store PATH] [options]
Commands: create, register, agents, send, receive, wait, listen, ack, release,
          renew, retry, history, events, append, upgrade, subscribe, subscriptions,
          unsubscribe, publish
Addressing: --name NAME (create/register), --to NAME|* (send), --as NAME (receive/listen)
Topics: subscribe --name NAME --topics TOPIC[,TOPIC] [--inactivity-ttl MS]
        publish --topic TOPIC; receive/wait/listen --subscription NAME
Redis messages: --redis-url-env VAR --namespace NAME --messaging-store NAME
Payload: --body TEXT | --body-file FILE (- reads stdin); --dedupe-key KEY; --correlation ID
Claims: --receipt-file FILE or --delivery-id ID --claim-id ID
Handlers: listen --as NAME -- EXECUTABLE [ARG ...]
Telemetry: --otel | --no-otel (optional @semaphile/otel addon)
Upgrade: message upgrade --store PATH (offline; stop all clients first)
Policies: --ack-mode manual|handler-success --config-mismatch warn|error
Timeouts: --timeout MS --claim-ttl MS --max-handling MS
Pools: --generation N --timeout MS; acknowledge --ids-file FILE --reason TEXT
Redis pools: --redis-url-env VAR --pool ID --pool-config FILE [--namespace NAME]
All successful results are JSON. Exit 2=timeout, 3=cancelled, 4=store/config,
5=protocol/input refusal. --store overrides nearest semaphile.json discovery.`;
const stringOptions = [
  'store',
  'messaging-store',
  'readiness',
  'subscription',
  'topics',
  'inactivity-ttl',
  'pool',
  'pool-config',
  'redis-url-env',
  'namespace',
  'owner-timeout',
  'generation',
  'ids-file',
  'reason',
  'directory',
  'name',
  'as',
  'to',
  'body',
  'body-file',
  'dedupe-key',
  'correlation',
  'reply-to',
  'topic',
  'kind',
  'sender',
  'expires-in',
  'ack-mode',
  'accept-ack-modes',
  'config-mismatch',
  'timeout',
  'claim-ttl',
  'max-handling',
  'concurrency',
  'max',
  'receipt-file',
  'delivery-id',
  'claim-id',
  'after',
  'limit',
  'since',
  'metadata',
  'payload',
];
export function readArguments() {
  const parsed = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...stringOptions.map((key) => [key, { type: 'string' as const }]),
      ['help', { type: 'boolean' as const }],
      ['otel', { type: 'boolean' as const }],
      ['no-otel', { type: 'boolean' as const }],
    ]),
  });
  const v = parsed.values as Record<string, string | boolean | undefined>;
  const get = (key: string) => (typeof v[key] === 'string' ? v[key] : undefined);
  const required = (key: string) => {
    const value = get(key);
    if (value === undefined) {
      throw new MessagingError('INPUT', `--${key} required`);
    }
    return value;
  };
  const numeric = (key: string) => {
    const value = get(key);
    if (value !== undefined && !value.trim()) {
      throw new MessagingError('INPUT', `--${key} requires a number`);
    }
    return value === undefined ? undefined : Number(value);
  };
  const [group, action, ...command] = parsed.positionals;
  return {
    get,
    required,
    numeric,
    group,
    action,
    command,
    help: v.help,
    otel: v.otel,
    noOtel: v['no-otel'],
  };
}
export type Arguments = ReturnType<typeof readArguments>;
export function validateAction(action: string, { get }: Arguments): void {
  if (
    ![
      'upgrade',
      'subscribe',
      'subscriptions',
      'unsubscribe',
      'publish',
      'create',
      'agents',
      'register',
      'send',
      'receive',
      'wait',
      'listen',
      'ack',
      'release',
      'renew',
      'retry',
      'history',
      'events',
      'append',
    ].includes(action)
  ) {
    throw new MessagingError('INPUT', help);
  }
  if (
    action === 'events' &&
    stringOptions.some(
      (key) =>
        ![
          'store',
          'redis-url-env',
          'namespace',
          'messaging-store',
          'readiness',
          'config-mismatch',
          'after',
          'limit',
          'topic',
          'since',
        ].includes(key) && get(key) !== undefined,
    )
  ) {
    throw new MessagingError(
      'INPUT',
      'events supports only cursor, limit, topic and since filters',
    );
  }
  if (['wait', 'listen'].includes(action) && get('max') !== undefined) {
    throw new MessagingError('INPUT', '--max applies only to receive');
  }
}
export function receivingOptions(
  { get, numeric }: Arguments,
  defaults: ReceiveOptions = {},
): ReceiveOptions {
  const receiveOptions: ReceiveOptions = { ...defaults };
  if (get('ack-mode') !== undefined) {
    receiveOptions.ackMode = mode(get('ack-mode'));
  }
  if (get('accept-ack-modes') !== undefined) {
    receiveOptions.acceptedAckModes = get('accept-ack-modes')!.split(',').map(mode);
  }
  if (get('claim-ttl') !== undefined) {
    receiveOptions.claimTtlMs = numeric('claim-ttl');
  }
  if (get('max-handling') !== undefined) {
    receiveOptions.maxHandlingMs = numeric('max-handling');
  }
  if (get('max') !== undefined) {
    receiveOptions.max = numeric('max');
  }
  return receiveOptions;
}
