import type { SendOptions, StoreConfig } from './types.js';
import { integer, mode, refusal, text } from './config.js';
export function validateEnvelope(config: StoreConfig, input: SendOptions): SendOptions {
  const envelope: SendOptions = { to: text(input.to, 'to', 128), body: input.body };
  if (typeof input.body !== 'string' || Buffer.byteLength(input.body) > config.maxBodyBytes) {
    refusal('body exceeds maxBodyBytes or is not text');
  }
  for (const key of ['sender', 'dedupeKey', 'correlationId', 'replyTo', 'topic', 'kind'] as const) {
    if (input[key] !== undefined) {
      envelope[key] = text(input[key], key);
    }
  }
  if (input.expiresInMs !== undefined) {
    envelope.expiresInMs = integer(input.expiresInMs, 'expiresInMs');
  }
  if (input.ackMode !== undefined) {
    envelope.ackMode = mode(input.ackMode);
  }
  return envelope;
}
