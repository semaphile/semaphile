import { validateTrace } from './trace.js';
import type { Receipt } from './types.js';
import { readFile } from 'node:fs/promises';
async function readInput(file: string): Promise<string> {
  if (file !== '-') {
    return readFile(file, 'utf8');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
import type { MessagingClient } from './client.js';
import type { messagingOptions } from './settings.js';
import { MessagingError, mode, text } from './config.js';
import { help } from './cli-options.js';
import { record } from './validation.js';
import type { Arguments } from './cli-options.js';
import type { ReceiveOptions, SendOptions } from './types.js';
export const output = (value: unknown) =>
  process.stdout.write(JSON.stringify(value ?? null) + '\n');
export interface Context {
  client: MessagingClient;
  args: Arguments;
  action: string;
  resolved: Awaited<ReturnType<typeof messagingOptions>>;
  receiveOptions: ReceiveOptions;
  controller: AbortController;
}
import { register, waitForMessage, listen } from './cli-lifecycle.js';
async function sendMessage(context: Context): Promise<void> {
  const {
    client,
    args: { get, required, numeric },
  } = context;

  if ((get('body') === undefined) === (get('body-file') === undefined)) {
    throw new MessagingError('INPUT', 'Supply exactly one of --body and --body-file');
  }
  const message: SendOptions = {
    to: context.action === 'publish' ? '*' : required('to'),
    body: get('body') ?? (await readInput(required('body-file'))),
    sender: get('sender'),
    dedupeKey: get('dedupe-key'),
    correlationId: get('correlation'),
    replyTo: get('reply-to'),
    topic: get('topic'),
    kind: get('kind'),
    expiresInMs: numeric('expires-in'),
    ackMode: get('ack-mode') ? mode(get('ack-mode')) : undefined,
  };
  output(
    context.action === 'publish'
      ? await client.publish({ ...message, topic: required('topic') })
      : await client.send(message),
  );
}
async function settleClaim(context: Context, action: 'ack' | 'release' | 'renew'): Promise<void> {
  const {
    client,
    args: { get, required, numeric },
  } = context;

  let raw: unknown;
  if (get('receipt-file') === undefined) {
    raw = { deliveryId: required('delivery-id'), claimId: required('claim-id') };
  } else {
    const contents = await readInput(required('receipt-file'));
    try {
      raw = JSON.parse(contents);
    } catch {
      // Parser messages can contain receipt contents; report only the category.
      throw new MessagingError('INPUT', 'Receipt file must contain valid JSON');
    }
  }
  const envelope = record(raw, 'receipt');
  const value = record('receipt' in envelope ? envelope.receipt : envelope, 'receipt');
  const receipt: Receipt = {
    deliveryId: text(value.deliveryId, 'deliveryId'),
    claimId: text(value.claimId, 'claimId'),
  };
  try {
    receipt.trace = validateTrace(value.trace ?? envelope.trace);
  } catch {
    /* Invalid optional telemetry does not invalidate a receipt. */
  }
  const result =
    action === 'renew'
      ? await client.renew(receipt, numeric('claim-ttl'))
      : await client[action](receipt);
  output(result);
  if (result.status === 'stale') {
    process.exitCode = 5;
  }
}
export async function execute(context: Context): Promise<void> {
  const {
    action,
    client,
    args: { get, required, numeric },
    receiveOptions,
  } = context;
  switch (action) {
    case 'create':
      await client.createMailbox(required('name'));
      output({ created: required('name') });
      break;
    case 'agents':
      output(await client.agents());
      break;
    case 'register':
      await register(context);
      break;
    case 'publish':
    case 'send':
      await sendMessage(context);
      break;
    case 'subscribe': {
      const sub = await client.subscribe(required('name'), {
        topics: required('topics').split(','),
        inactivityTtlMs: numeric('inactivity-ttl'),
      });
      output(sub.info);
      break;
    }
    case 'subscriptions':
      output(await client.subscriptions());
      break;
    case 'unsubscribe':
      await (await client.subscription(required('name'))).remove();
      output({ removed: required('name') });
      break;
    case 'receive':
      if (get('subscription') && get('as')) {
        throw new MessagingError('INPUT', 'Choose --as or --subscription');
      }
      output(
        get('subscription')
          ? await (await client.subscription(get('subscription')!)).receive(receiveOptions)
          : await client.receive(required('as'), receiveOptions),
      );
      break;
    case 'wait':
      await waitForMessage(context);
      break;
    case 'listen':
      await listen(context);
      break;
    case 'ack':
    case 'release':
    case 'renew':
      await settleClaim(context, action);
      break;
    case 'retry':
      await client.retry(required('delivery-id'));
      output({ retried: required('delivery-id') });
      break;
    case 'events':
      output(
        await client.events({
          after: numeric('after'),
          limit: numeric('limit'),
          topic: get('topic'),
          since: numeric('since'),
        }),
      );
      break;
    case 'history':
      output(
        await client[action]({
          after: numeric('after'),
          limit: numeric('limit'),
          recipient: get('to'),
          sender: get('sender'),
          correlationId: get('correlation'),
          topic: get('topic'),
          since: numeric('since'),
        }),
      );
      break;
    case 'append':
      await client.append({
        kind: required('kind'),
        agent: get('as'),
        subject: get('delivery-id'),
        topic: get('topic'),
        payload: get('payload'),
      });
      output({ appended: true });
      break;
    default:
      throw new MessagingError('INPUT', help);
  }
}
