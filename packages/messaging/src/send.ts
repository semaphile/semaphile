import { publicationRecipients } from './topics.js';
import { validateTrace } from './trace.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import type { Presence } from './presence.js';
import type { SendOptions, SendResult } from './types.js';
import { refusal, MessagingError } from './config.js';
import { validateEnvelope } from './envelope.js';
import { expireMessages } from './delivery.js';
import { cleanup, contentBytes, event } from './storage.js';
export function send(
  store: Database,
  presence: Presence,
  input: SendOptions,
  publication = false,
): SendResult {
  const envelope = validateEnvelope(store.config, input);
  const trace = validateTrace(input.trace);
  const encodedTrace = trace ? JSON.stringify(trace) : null;
  const encoded = JSON.stringify(envelope),
    fingerprint = createHash('sha256')
      .update(publication ? 'publication:' + encoded : encoded)
      .digest('hex');
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
  if (
    !publication &&
    store.db.prepare('SELECT 1 FROM subscriptions WHERE recipient=?').get(input.to)
  ) {
    refusal('Use publication for subscription destinations');
  }
  const recipients = recipientsFor(store, presence, input, publication);
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
      contentBytes(store) +
        Buffer.byteLength(encoded) +
        Buffer.byteLength(encodedTrace ?? '') +
        recipients.length * 8192 +
        2048 >
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
          'INSERT INTO messages(id,dedupe_key,fingerprint,envelope,recipients,created_at,expires_at,trace) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          envelope.dedupeKey ?? null,
          fingerprint,
          encoded,
          JSON.stringify(recipients),
          now,
          envelope.expiresInMs === undefined ? null : now + envelope.expiresInMs,
          encodedTrace,
        );
      const seq = Number(result.lastInsertRowid);
      for (const recipient of recipients) {
        db.prepare(
          "INSERT INTO deliveries(id,message_seq,recipient,state,attempts,available_at) VALUES(?,?,?,'pending',0,?)",
        ).run(randomUUID(), seq, recipient, now);
      }
      event(store, {
        kind: publication ? 'published' : 'sent',
        agent: envelope.sender,
        subject: id,
        topic: envelope.topic,
      });

      return { id, seq, recipients, deduplicated: false };
    });
  } catch (error) {
    if (progressed && error instanceof MessagingError && error.code === 'REFUSED') {
      throw new MessagingError('CLEANUP_PROGRESS', 'Continue bounded admission cleanup');
    }
    throw error;
  }
}

function recipientsFor(
  store: Database,
  presence: Presence,
  input: SendOptions,
  publication: boolean,
): string[] {
  if (publication) {
    return publicationRecipients(store, input.topic!);
  }
  if (input.to !== '*') {
    return [input.to];
  }
  return [
    ...new Set(
      presence
        .agents()
        .filter((a) => a.online)
        .map((a) => a.name),
    ),
  ].sort((a, b) => (a < b ? -1 : Number(a > b)));
}
