import {
  openMessaging,
  defaults,
  loadConfig,
  commandHandler,
  type Receipt,
  type Delivery,
} from '@semaphile/messaging';
const client = await openMessaging({
  path: './state',
  config: { maxAttempts: 5 },
  configMismatch: 'error',
});
await client.createMailbox('reviewer');
const result = await client.send({ to: 'reviewer', body: 'hello', ackMode: 'manual' });
const seq: number = result.seq;
const claim: Delivery | null = await client.wait('reviewer', {
  timeoutMs: 1,
  signal: new AbortController().signal,
});
if (claim) {
  await client.ack(claim.receipt);
}
const listener = client.listen('reviewer', async (delivery, context) => {
  const receipt: Receipt = delivery.receipt;
  await context.ack();
  return receipt;
});
await listener.close();
await client.close();
void seq;
void defaults;
void loadConfig;
void commandHandler;
// @ts-expect-error a message needs an opaque text body
await client.send({ to: 'reviewer', body: { text: 'invalid' } });
// @ts-expect-error both attempt and delivery identities are required
await client.ack({ deliveryId: 'only-message' });
// @ts-expect-error unsupported mismatch policy
await openMessaging({ path: './state', configMismatch: 'ignore' });
// @ts-expect-error unsupported receipt mode
await client.receive('reviewer', { ackMode: 'exactly-once' });

// @ts-expect-error events do not advertise message-recipient filters
await client.events({ recipient: 'reviewer' });
