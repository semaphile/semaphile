import type { Database } from './database.js';
import type {
  EventHistoryOptions,
  EventInput,
  EventRecord,
  HistoryOptions,
  MessageHistory,
  SendOptions,
} from './types.js';
import { historyOptions } from './validation.js';
import { integer, text } from './config.js';
export function event(store: Database, input: EventInput): number {
  const { db } = store;
  const result = db
    .prepare('INSERT INTO events(at,kind,agent,subject,topic,payload) VALUES(?,?,?,?,?,?)')
    .run(
      Date.now(),
      input.kind,
      input.agent ?? null,
      input.subject ?? null,
      input.topic ?? null,
      input.payload ?? null,
    );
  return Number(result.lastInsertRowid);
}
export function trimEvents(store: Database): void {
  const { db, config } = store;
  // Event history is a bounded ring; current delivery state is stored separately.
  db.prepare(
    'DELETE FROM events WHERE seq <= COALESCE((SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?),-1)',
  ).run(config.maxEvents);
  const excess = contentBytes(store) - config.maxContentBytes;
  if (excess > 0) {
    db.prepare(
      `DELETE FROM events WHERE seq <= COALESCE((SELECT seq FROM
      (SELECT seq,SUM(length(CAST(COALESCE(payload,'') AS BLOB))+length(CAST(kind AS BLOB))+length(CAST(COALESCE(agent,'') AS BLOB))+length(CAST(COALESCE(subject,'') AS BLOB))+length(CAST(COALESCE(topic,'') AS BLOB))+512) OVER (ORDER BY seq) AS bytes FROM events)
      WHERE bytes>=? ORDER BY seq LIMIT 1),(SELECT MAX(seq) FROM events))`,
    ).run(excess);
  }
}
export function terminal(store: Database, seq: number, now: number): void {
  store.db
    .prepare(
      `UPDATE messages SET terminal_at=? WHERE seq=? AND terminal_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM deliveries WHERE message_seq=? AND state IN ('pending','claimed'))`,
    )
    .run(now, seq, seq);
}
export function contentBytes(store: Database): number {
  const row = store.db
    .prepare(
      `SELECT
    (SELECT COALESCE(SUM(length(CAST(COALESCE(envelope,'') AS BLOB))+length(CAST(recipients AS BLOB))+length(CAST(COALESCE(dedupe_key,'') AS BLOB))+512),0) FROM messages)
    +(SELECT COALESCE(SUM(CASE WHEN state IN ('pending','claimed') THEN 8192
      ELSE length(CAST(COALESCE(error,'') AS BLOB))+1024 END),0) FROM deliveries)
    +(SELECT COALESCE(SUM(length(CAST(metadata AS BLOB))+length(CAST(name AS BLOB))+1024),0) FROM agents)
    +(SELECT COALESCE(SUM(length(CAST(name AS BLOB))+256),0) FROM mailboxes)
    +(SELECT COALESCE(SUM(length(CAST(COALESCE(payload,'') AS BLOB))+length(CAST(kind AS BLOB))
      +length(CAST(COALESCE(agent,'') AS BLOB))+length(CAST(COALESCE(subject,'') AS BLOB))
      +length(CAST(COALESCE(topic,'') AS BLOB))+512),0) FROM events) AS bytes`,
    )
    .get()!;
  return Number(row.bytes);
}
/** Bounded eviction: receipts/dedupe survive payload eviction where required. */
export function cleanup(store: Database, pressure = false): void {
  const now = Date.now(),
    { db, config } = store;
  db.prepare(
    'DELETE FROM events WHERE seq IN (SELECT seq FROM events WHERE at<=? ORDER BY seq LIMIT 256)',
  ).run(now - config.retainHistoryMs);
  const rows = db
    .prepare(
      `SELECT seq,dedupe_key,terminal_at FROM messages WHERE terminal_at IS NOT NULL
    AND ((envelope IS NOT NULL AND (? OR terminal_at<=?)) OR
      ((dedupe_key IS NULL OR terminal_at<=?) AND (envelope IS NULL OR terminal_at<=?)))
    ORDER BY terminal_at,seq LIMIT 256`,
    )
    .all(
      pressure ? 1 : 0,
      now - config.retainHistoryMs,
      now - config.dedupeRetentionMs,
      now - config.retainHistoryMs,
    );
  for (const row of rows) {
    db.prepare('UPDATE messages SET envelope=NULL WHERE seq=?').run(row.seq);
    if (row.dedupe_key === null || Number(row.terminal_at) + config.dedupeRetentionMs <= now) {
      db.prepare('DELETE FROM deliveries WHERE message_seq=?').run(row.seq);
      db.prepare('DELETE FROM messages WHERE seq=?').run(row.seq);
    }
  }
  db.prepare(
    'DELETE FROM agents WHERE id IN (SELECT id FROM agents WHERE online=0 AND (? OR registered_at<=?) ORDER BY registered_at LIMIT 256)',
  ).run(pressure ? 1 : 0, now - config.retainHistoryMs);
  // Even with tiny configured content bounds, completing work must remain possible.
  if (pressure) {
    db.prepare(
      'DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq LIMIT 256)',
    ).run();
  }
}
export function history(store: Database, options: HistoryOptions = {}): MessageHistory[] {
  historyOptions(options);
  const after = integer(options.after ?? 0, 'after', 0, Number.MAX_SAFE_INTEGER);
  const limit = integer(options.limit ?? 100, 'limit', 1, 1000);
  const rows = store.db
    .prepare(
      `SELECT * FROM messages m WHERE seq>? AND (terminal_at IS NULL OR terminal_at>?) AND
    (? IS NULL OR EXISTS(SELECT 1 FROM deliveries d WHERE d.message_seq=m.seq AND d.recipient=?)) AND
    (? IS NULL OR json_extract(envelope,'$.sender')=?) AND
    (? IS NULL OR json_extract(envelope,'$.correlationId')=?) AND
    (? IS NULL OR json_extract(envelope,'$.topic')=?) AND
    (? IS NULL OR created_at>=?) ORDER BY seq LIMIT ?`,
    )
    .all(
      after,
      Date.now() - store.config.retainHistoryMs,
      options.recipient ?? null,
      options.recipient ?? null,
      options.sender ?? null,
      options.sender ?? null,
      options.correlationId ?? null,
      options.correlationId ?? null,
      options.topic ?? null,
      options.topic ?? null,
      options.since ?? null,
      options.since ?? null,
      limit,
    );
  return rows.map((row) => ({
    id: String(row.id),
    seq: Number(row.seq),
    recipients: JSON.parse(String(row.recipients)) as string[],
    deduplicated: false,
    message: row.envelope === null ? null : (JSON.parse(String(row.envelope)) as SendOptions),
    createdAt: Number(row.created_at),
    terminalAt: row.terminal_at === null ? null : Number(row.terminal_at),
    deliveries: store.db
      .prepare(
        'SELECT id,recipient,state,attempts,error FROM deliveries WHERE message_seq=? ORDER BY recipient',
      )
      .all(row.seq)
      .map((d) => ({
        id: String(d.id),
        recipient: String(d.recipient),
        state: String(d.state),
        attempts: Number(d.attempts),
        error: d.error === null ? null : String(d.error),
      })),
  }));
}
export function events(store: Database, options: EventHistoryOptions = {}): EventRecord[] {
  historyOptions(options, true);
  return store.db
    .prepare(
      `SELECT * FROM events WHERE seq>? AND at>? AND (? IS NULL OR topic=?) AND (? IS NULL OR at>=?) ORDER BY seq LIMIT ?`,
    )
    .all(
      integer(options.after ?? 0, 'after', 0, Number.MAX_SAFE_INTEGER),
      Date.now() - store.config.retainHistoryMs,
      options.topic ?? null,
      options.topic ?? null,
      options.since ?? null,
      options.since ?? null,
      integer(options.limit ?? 100, 'limit', 1, 1000),
    )
    .map((row) => ({
      seq: Number(row.seq),
      at: Number(row.at),
      kind: String(row.kind),
      agent: row.agent === null ? undefined : String(row.agent),
      subject: row.subject === null ? undefined : String(row.subject),
      topic: row.topic === null ? undefined : String(row.topic),
      payload: row.payload === null ? undefined : String(row.payload),
    }));
}
export function validateEvent(input: EventInput): EventInput {
  text(input.kind, 'event kind');
  for (const key of ['agent', 'subject', 'topic'] as const) {
    if (input[key] !== undefined) {
      text(input[key], key);
    }
  }
  if (input.payload !== undefined) {
    text(input.payload, 'event payload', 16384);
  }
  return input;
}
