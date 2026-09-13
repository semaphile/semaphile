import { createHash, randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import type { Presence } from './presence.js';
import type { SendOptions, SendResult } from './types.js';
import { integer, mode, refusal, text, MessagingError } from './config.js';
import { expireMessages } from './delivery.js';
import { cleanup, contentBytes, event } from './storage.js';
function validateEnvelope(store: Database, input: SendOptions): SendOptions {
  const envelope: SendOptions = { to: text(input.to, 'to', 128), body: input.body };
  if (typeof input.body !== 'string' || Buffer.byteLength(input.body) > store.config.maxBodyBytes) {
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
export function send(store: Database, presence: Presence, input: SendOptions): SendResult {
  const envelope = validateEnvelope(store, input);
  const encoded = JSON.stringify(envelope),
    fingerprint = createHash('sha256').update(encoded).digest('hex');
  const { db, config } = store;
  // Retry lookup precedes current recipient resolution: committed broadcasts
  // must never acquire new recipients when the sender retries an uncertain send.
  const existing = envelope.dedupeKey
    ? db.prepare('SELECT * FROM messages WHERE dedupe_key=?').get(envelope.dedupeKey)
    : undefined;
  if (
    existing &&
    (existing.terminal_at === null ||
      Number(existing.terminal_at) + config.dedupeRetentionMs > Date.now())
  ) {
    if (existing.fingerprint !== fingerprint) {
      refusal('dedupeKey already used with different content');
    }
    return {
      id: String(existing.id),
      seq: Number(existing.seq),
      recipients: JSON.parse(String(existing.recipients)) as string[],
      deduplicated: true,
    };
  }
  const recipients =
    input.to === '*'
      ? [
          ...new Set(
            presence
              .agents()
              .filter((a) => a.online)
              .map((a) => a.name),
          ),
        ].sort((a, b) => (a < b ? -1 : Number(a > b)))
      : [input.to];
  if (!recipients.length) {
    refusal('Broadcast has no online recipients');
  }
  recipients.forEach((r) => presence.require(r));
  const reclaimed = expireMessages(store) + presence.reclaimDead();
  const beforeCleanup = Number(db.prepare('SELECT total_changes() AS n').get()!.n);
  store.mutate([], () => {
    cleanup(store);
    const count = Number(
      db.prepare('SELECT COUNT(*) AS n FROM messages WHERE envelope IS NOT NULL').get()!.n,
    );
    if (
      count >= config.maxMessages ||
      contentBytes(store) + Buffer.byteLength(encoded) + recipients.length * 8192 + 2048 >
        config.maxContentBytes
    ) {
      cleanup(store, true);
    }
    if (existing) {
      db.prepare('UPDATE messages SET dedupe_key=NULL WHERE seq=?').run(existing.seq);
    }
  });
  const progressed =
    reclaimed > 0 || Number(db.prepare('SELECT total_changes() AS n').get()!.n) > beforeCleanup;
  try {
    return store.mutate(recipients, () => {
      for (const recipient of recipients) {
        const row = db
          .prepare(
            "SELECT COUNT(*) AS n FROM deliveries WHERE recipient=? AND state IN ('pending','claimed')",
          )
          .get(recipient)!;
        if (Number(row.n) >= config.maxPendingPerRecipient) {
          refusal(`Mailbox full: ${recipient}`);
        }
      }
      const count = Number(
        db.prepare('SELECT COUNT(*) AS n FROM messages WHERE envelope IS NOT NULL').get()!.n,
      );
      if (count >= config.maxMessages) {
        refusal('maxMessages reached');
      }
      const id = randomUUID(),
        now = Date.now();
      const result = db
        .prepare(
          'INSERT INTO messages(id,dedupe_key,fingerprint,envelope,recipients,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          id,
          envelope.dedupeKey ?? null,
          fingerprint,
          encoded,
          JSON.stringify(recipients),
          now,
          envelope.expiresInMs === undefined ? null : now + envelope.expiresInMs,
        );
      const seq = Number(result.lastInsertRowid);
      for (const recipient of recipients) {
        db.prepare(
          "INSERT INTO deliveries(id,message_seq,recipient,state,attempts,available_at) VALUES(?,?,?,'pending',0,?)",
        ).run(randomUUID(), seq, recipient, now);
      }
      event(store, { kind: 'sent', agent: envelope.sender, subject: id, topic: envelope.topic });

      return { id, seq, recipients, deduplicated: false };
    });
  } catch (error) {
    if (progressed && error instanceof MessagingError && error.code === 'REFUSED') {
      throw new MessagingError('CLEANUP_PROGRESS', 'Continue bounded admission cleanup');
    }
    throw error;
  }
}
