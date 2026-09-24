// All methods run under the messaging gate; retirement and fanout share that ordering.
import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import type { SubscriptionInfo, SubscriptionOptions } from './types.js';
import { MessagingError, text, integer } from './config.js';
import { event, terminal, cleanup, contentBytes } from './storage.js';
export const RESERVED = '@subscription:';
function get(store: Database, name: string): SubscriptionInfo | undefined {
  const row = store.db.prepare('SELECT value FROM subscriptions WHERE name=?').get(name);
  return row ? (JSON.parse(String(row.value)) as SubscriptionInfo) : undefined;
}
function persist(store: Database, s: SubscriptionInfo, retiredAt: number | null = null): void {
  store.db
    .prepare('INSERT OR REPLACE INTO subscriptions VALUES(?,?,?,?,?,?)')
    .run(s.name, s.id, s.recipient, JSON.stringify(s), s.expiresAt ?? null, retiredAt);
}
function retire(store: Database, s: SubscriptionInfo, reason: string): void {
  if (s.state !== 'active') {
    return;
  }
  store.mutate([s.recipient], () => {
    s.state = 'retired';
    persist(store, s, Date.now());
    store.db.prepare('DELETE FROM subscription_topics WHERE name=?').run(s.name);
    const rows = store.db
      .prepare(
        "SELECT message_seq FROM deliveries WHERE recipient=? AND state IN ('pending','claimed')",
      )
      .all(s.recipient);
    store.db
      .prepare(
        "UPDATE deliveries SET state='cancelled',claim_id=NULL,claim_expires_at=NULL,error=? WHERE recipient=? AND state IN ('pending','claimed')",
      )
      .run(reason, s.recipient);
    for (const row of rows) {
      terminal(store, Number(row.message_seq), Date.now());
    }
    store.db.prepare('DELETE FROM mailboxes WHERE name=?').run(s.recipient);
    event(store, { kind: 'subscription-retired', subject: s.id, payload: reason });
  });
}
export function expireSubscriptions(store: Database): void {
  for (const row of store.db
    .prepare(
      'SELECT value FROM subscriptions WHERE retired_at IS NULL AND expires_at<=? ORDER BY expires_at LIMIT 256',
    )
    .all(Date.now())) {
    retire(
      store,
      JSON.parse(String(row.value)) as SubscriptionInfo,
      'Subscription inactivity expired',
    );
  }
}
export function requireSubscription(store: Database, recipient: string): void {
  const row = store.db
    .prepare('SELECT retired_at,expires_at FROM subscriptions WHERE recipient=?')
    .get(recipient);
  if (!row) {
    return;
  }
  if (
    row.retired_at !== null ||
    (row.expires_at !== null && Number(row.expires_at) <= Date.now())
  ) {
    throw new MessagingError('STALE', 'Subscription retired');
  }
}
export function subscriptionDeadline(store: Database, recipient: string): number | undefined {
  const row = store.db
    .prepare('SELECT expires_at FROM subscriptions WHERE recipient=? AND retired_at IS NULL')
    .get(recipient);
  return row?.expires_at === null || !row ? undefined : Number(row.expires_at);
}
export function publicationRecipients(store: Database, topic: string): string[] {
  text(topic, 'topic');
  return store.db
    .prepare(
      'SELECT s.recipient FROM subscriptions s JOIN subscription_topics t ON t.name=s.name WHERE t.topic=? AND s.retired_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?) ORDER BY s.recipient',
    )
    .all(topic, Date.now())
    .map((row) => String(row.recipient));
}
export function topicCommand(
  store: Database,
  action: string,
  input: Record<string, unknown>,
): unknown {
  if (action === 'subscriptions') {
    return store.db
      .prepare('SELECT value FROM subscriptions ORDER BY name')
      .all()
      .map((row) => JSON.parse(String(row.value)) as SubscriptionInfo);
  }
  if (
    action === 'subscription-touch' &&
    typeof input.deadline === 'number' &&
    Date.now() >= input.deadline
  ) {
    throw new MessagingError('TIMEOUT', 'Subscription wait expired');
  }
  const name = text(input.name, 'subscription name', 128),
    previous = get(store, name);
  if (action === 'subscribe') {
    return createSubscription(store, name, input, previous);
  }
  if (!previous || (input.id !== undefined && previous.id !== input.id)) {
    throw new MessagingError('STALE', 'Subscription generation missing');
  }
  if (action === 'subscription-get') {
    return previous;
  }
  if (action === 'subscription-remove') {
    retire(store, previous, 'Subscription removed');
    return;
  }
  requireSubscription(store, previous.recipient);
  if (previous.inactivityTtlMs) {
    previous.expiresAt = Date.now() + previous.inactivityTtlMs;
    store.mutate([], () => persist(store, previous));
  }
  return previous;
}

function createSubscription(
  store: Database,
  name: string,
  input: Record<string, unknown>,
  previous?: SubscriptionInfo,
): SubscriptionInfo {
  const options = input as unknown as SubscriptionOptions;
  if (!Array.isArray(options.topics) || !options.topics.length) {
    throw new MessagingError('INPUT', 'topics must be nonempty');
  }
  const topics = [...new Set(options.topics.map((t) => text(t, 'topic')))].sort((a, b) =>
    a < b ? -1 : Number(a > b),
  );
  if (topics.length !== options.topics.length) {
    throw new MessagingError('INPUT', 'topics must be unique');
  }
  const inactivityTtlMs =
    options.inactivityTtlMs === undefined
      ? undefined
      : integer(options.inactivityTtlMs, 'inactivityTtlMs');
  if (
    previous?.state === 'active' &&
    (previous.expiresAt === undefined || previous.expiresAt > Date.now())
  ) {
    if (
      JSON.stringify(previous.topics) !== JSON.stringify(topics) ||
      previous.inactivityTtlMs !== inactivityTtlMs
    ) {
      throw new MessagingError('CONFIG_MISMATCH', 'Subscription options differ');
    }
    return previous;
  }
  if (previous) {
    retire(store, previous, 'Subscription inactivity expired');
  }
  const id = randomUUID(),
    now = Date.now();
  const s: SubscriptionInfo = {
    id,
    name,
    topics,
    recipient: RESERVED + id,
    state: 'active',
    createdAt: now,
    ...(inactivityTtlMs === undefined ? {} : { inactivityTtlMs, expiresAt: now + inactivityTtlMs }),
  };
  store.mutate([], () =>
    cleanup(
      store,
      contentBytes(store) +
        Buffer.byteLength(JSON.stringify(s)) +
        topics.reduce(
          (sum, topic) => sum + Buffer.byteLength(topic) + Buffer.byteLength(name) + 256,
          0,
        ) +
        2048 >
        store.config.maxContentBytes,
    ),
  );
  store.ensureNotify(s.recipient);
  return store.mutate([s.recipient], () => {
    persist(store, s);
    store.db.prepare('INSERT INTO mailboxes VALUES(?,?)').run(s.recipient, now);
    for (const topic of topics) {
      store.db.prepare('INSERT INTO subscription_topics VALUES(?,?)').run(topic, name);
    }
    event(store, { kind: 'subscription-created', subject: id });
    return s;
  });
}
