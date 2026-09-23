import { requireSubscription } from './topics.js';
// Claim transitions are conditional on the current attempt, never merely on
// message identity. The coordinator holds the store gate throughout each call.
import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import type { ClaimResult, Delivery, Receipt, ReceiveOptions, SendOptions } from './types.js';
import { integer, mode, refusal, text } from './config.js';
import { event, terminal } from './storage.js';
interface Row {
  id: string;
  message_seq: number;
  recipient: string;
  state: string;
  attempts: number;
  claim_id: string | null;
  claimed_at: number | null;
  claim_expires_at: number | null;
  handling_expires_at: number | null;
  available_at: number;
  acked_claim: string | null;
  envelope: string;
  trace: string | null;
  message_id: string;
  expires_at: number | null;
}
const SELECT =
  'SELECT d.*,m.id AS message_id,m.envelope,m.trace,m.expires_at FROM deliveries d JOIN messages m ON m.seq=d.message_seq';
function rowFor(store: Database, id: string): Row | undefined {
  return store.db.prepare(SELECT + ' WHERE d.id=?').get(id) as unknown as Row | undefined;
}
function unsuccessful(store: Database, row: Row, error: string, now: number): void {
  const expired = row.expires_at !== null && row.expires_at <= now;
  let state = 'pending';
  if (expired) {
    state = 'expired';
  } else if (row.attempts >= store.config.maxAttempts) {
    state = 'failed';
  }
  const delay = Math.min(
    2_147_483_647,
    store.config.retryDelayMs * 2 ** Math.min(30, Math.max(0, row.attempts - 1)),
  );
  store.db
    .prepare(
      'UPDATE deliveries SET state=?,claim_id=NULL,claim_expires_at=NULL,available_at=?,error=? WHERE id=?',
    )
    .run(state, now + delay, error, row.id);
  event(store, {
    kind: state === 'pending' ? 'retry-scheduled' : state,
    subject: row.id,
    payload: error,
  });
  terminal(store, row.message_seq, now);
}
export function reconcile(store: Database, recipient: string): void {
  const now = Date.now();
  const rows = store.db
    .prepare(
      SELECT +
        ` WHERE d.recipient=? AND d.state IN ('pending','claimed') AND
    ((m.expires_at IS NOT NULL AND m.expires_at<=?) OR (d.state='claimed' AND d.claim_expires_at<=?)) ORDER BY d.message_seq LIMIT 256`,
    )
    .all(recipient, now, now) as unknown as Row[];
  if (!rows.length) {
    return;
  }
  store.mutate([recipient], () => {
    for (const row of rows) {
      unsuccessful(
        store,
        row,
        row.expires_at !== null && row.expires_at <= now ? 'Message expired' : 'Claim expired',
        now,
      );
    }
  });
}
export function receive(
  store: Database,
  recipient: string,
  options: ReceiveOptions = {},
): Delivery[] {
  const max = integer(options.max ?? 1, 'max', 1, 1000);
  const ttl = integer(options.claimTtlMs ?? store.config.claimTtlMs, 'claimTtlMs');
  const handling = integer(options.maxHandlingMs ?? store.config.maxHandlingMs, 'maxHandlingMs');
  const defaultMode = mode(options.ackMode ?? 'manual');
  const accepted = options.acceptedAckModes ?? [defaultMode];
  if (!Array.isArray(accepted) || !accepted.length) {
    refusal('acceptedAckModes cannot be empty');
  }
  accepted.forEach(mode);
  reconcile(store, recipient);
  const now = Date.now();
  const rows = store.db
    .prepare(
      SELECT +
        " WHERE d.recipient=? AND d.state='pending' AND d.available_at<=? AND (m.expires_at IS NULL OR m.expires_at>?) ORDER BY d.message_seq LIMIT ?",
    )
    .all(recipient, now, now, max) as unknown as Row[];
  if (!rows.length) {
    return [];
  }
  return store.mutate([recipient], () => {
    const results: Delivery[] = [];
    for (const row of rows) {
      const message = JSON.parse(row.envelope) as SendOptions;
      const effectiveMode = message.ackMode ?? defaultMode;
      if (!accepted.includes(effectiveMode)) {
        store.db
          .prepare(
            "UPDATE deliveries SET state='failed',error='Incompatible acknowledgment policy' WHERE id=?",
          )
          .run(row.id);
        event(store, {
          kind: 'refused',
          subject: row.id,
          payload: 'Incompatible acknowledgment policy',
        });
        terminal(store, row.message_seq, now);
        continue;
      }
      const claimId = randomUUID();
      const handlingExpiresAt = Math.min(now + handling, row.expires_at ?? Number.MAX_SAFE_INTEGER);
      const claimExpiresAt = Math.min(now + ttl, handlingExpiresAt);
      store.db
        .prepare(
          "UPDATE deliveries SET state='claimed',attempts=attempts+1,claim_id=?,claimed_at=?,claim_expires_at=?,handling_expires_at=?,error=NULL WHERE id=?",
        )
        .run(claimId, now, claimExpiresAt, handlingExpiresAt, row.id);
      event(store, { kind: 'claimed', subject: row.id });
      results.push({
        id: row.id,
        messageId: row.message_id,
        seq: row.message_seq,
        recipient,
        message,
        ...(row.trace ? { trace: JSON.parse(row.trace) as Delivery['trace'] } : {}),
        receipt: { deliveryId: row.id, claimId },
        attempt: row.attempts + 1,
        ackMode: effectiveMode,
        claimedAt: now,
        claimExpiresAt,
        handlingExpiresAt,
      });
    }
    return results;
  });
}
export function nextDeadline(store: Database, recipient: string): number | undefined {
  const row = store.db
    .prepare(
      `SELECT MIN(deadline) AS deadline FROM (
    SELECT CASE WHEN state='claimed' THEN claim_expires_at ELSE available_at END AS deadline
      FROM deliveries WHERE recipient=? AND state IN ('pending','claimed')
    UNION ALL SELECT m.expires_at FROM messages m JOIN deliveries d ON d.message_seq=m.seq
      WHERE d.recipient=? AND d.state IN ('pending','claimed') AND m.expires_at IS NOT NULL)`,
    )
    .get(recipient, recipient)!;
  return row.deadline === null ? undefined : Number(row.deadline);
}
export function claim(
  store: Database,
  action: 'ack' | 'release' | 'renew' | 'fail',
  receipt: Receipt,
  value?: number | string,
): ClaimResult {
  text(receipt.deliveryId, 'deliveryId');
  text(receipt.claimId, 'claimId');
  const row = rowFor(store, receipt.deliveryId),
    now = Date.now();
  if (row?.state === 'claimed') {
    try {
      requireSubscription(store, row.recipient);
    } catch {
      return { status: 'stale' };
    }
  }
  if (
    (action === 'ack' || action === 'renew') &&
    row?.state === 'acked' &&
    row.acked_claim === receipt.claimId
  ) {
    return { status: 'acked' };
  }
  if (
    row?.state !== 'claimed' ||
    row.claim_id !== receipt.claimId ||
    row.claim_expires_at! <= now ||
    (row.expires_at !== null && row.expires_at <= now)
  ) {
    return { status: 'stale' };
  }
  const ttl = action === 'renew' ? integer(value ?? store.config.claimTtlMs, 'claimTtlMs') : 0;
  return store.mutate([row.recipient], () => {
    if (action === 'renew') {
      const expiresAt = Math.max(
        row.claim_expires_at!,
        Math.min(now + ttl, row.handling_expires_at!, row.expires_at ?? Number.MAX_SAFE_INTEGER),
      );
      store.db
        .prepare('UPDATE deliveries SET claim_expires_at=? WHERE id=?')
        .run(expiresAt, row.id);
      return { status: 'renewed', expiresAt };
    }
    if (action === 'ack') {
      store.db
        .prepare(
          "UPDATE deliveries SET state='acked',acked_claim=claim_id,claim_id=NULL,claim_expires_at=NULL WHERE id=?",
        )
        .run(row.id);
      event(store, { kind: 'acked', subject: row.id });
      terminal(store, row.message_seq, now);
      return { status: 'acked' };
    }
    unsuccessful(
      store,
      row,
      action === 'fail'
        ? Buffer.from(String(value ?? 'Handler failed'))
            .subarray(0, 4096)
            .toString('utf8')
        : 'Released',
      now,
    );
    return { status: 'released' };
  });
}
export function retry(store: Database, id: string): void {
  const row = rowFor(store, text(id, 'deliveryId'));
  if (row?.state !== 'failed') {
    refusal('Only a retained failed delivery can be retried');
  }
  if (!row.envelope || (row.expires_at !== null && row.expires_at <= Date.now())) {
    refusal('Message body unavailable or expired; send a new message');
  }
  const count = Number(
    store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM deliveries WHERE recipient=? AND state IN ('pending','claimed')",
      )
      .get(row.recipient)!.n,
  );
  if (count >= store.config.maxPendingPerRecipient) {
    refusal('Mailbox full');
  }
  store.mutate([row.recipient], () => {
    store.db
      .prepare(
        "UPDATE deliveries SET state='pending',attempts=0,claim_id=NULL,claim_expires_at=NULL,available_at=?,error=NULL WHERE id=?",
      )
      .run(Date.now(), row.id);
    store.db.prepare('UPDATE messages SET terminal_at=NULL WHERE seq=?').run(row.message_seq);
    event(store, { kind: 'retried', subject: row.id });
  });
}

export function expireMessages(store: Database): number {
  const now = Date.now();
  const rows = store.db
    .prepare(
      SELECT +
        ` WHERE d.state IN ('pending','claimed') AND
    (m.expires_at<=? OR (d.state='claimed' AND d.claim_expires_at<=?)) ORDER BY d.message_seq LIMIT 256`,
    )
    .all(now, now) as unknown as Row[];
  if (!rows.length) {
    return 0;
  }
  store.mutate(
    rows.map((row) => row.recipient),
    () => {
      for (const row of rows) {
        unsuccessful(
          store,
          row,
          row.expires_at !== null && row.expires_at <= now ? 'Message expired' : 'Claim expired',
          now,
        );
      }
    },
  );
  return rows.length;
}
