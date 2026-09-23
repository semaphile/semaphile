# Messaging across projects and machines

An agent in a project can send a question to a user-facing relay, or publish a
completed turn to several independent consumers. Redis messaging gives those
processes one durable store even when they run on different machines. SQLite
remains the daemonless choice for processes sharing a local filesystem.

This feature is the unreleased messaging-only 0.3.0 candidate. Use matching builds of
`@semaphile/messaging` and `@semaphile/redis`; the published 0.2.0 packages do not
contain it. Redis is the authoritative store, with no local SQLite mirror or
fallback. The existing Redis rate limiter has a separate store and lifecycle.

## Choose a shared store

```ts
import { openRedisMessaging } from '@semaphile/redis/messaging';

const bus = await openRedisMessaging({
  url: process.env.REDIS_URL!,
  namespace: 'engineering',
  store: 'agent-events',
  configMismatch: 'error',
});
await bus.createMailbox('user-relay');
await bus.send({ to: 'user-relay', body: 'Ready for review', dedupeKey: 'run-42-ready' });
await bus.close();
```

The Redis database, namespace and store name identify the shared state. The URL
may use authentication and `rediss://` TLS. Keep it in an environment variable;
configuration and command examples refer to that variable rather than embedding
credentials. The Redis entry imports the native-free shared messaging client and
requires no native addon or local coordination directory.

The same delivery API includes `send`, `receive`, `wait`, `listen`, fenced receipts,
optional presence, history, events and bounded retention. Acknowledgment means
that the receiver has durably accepted the message. It does not mean that the
requested task has finished. Adapters should deduplicate external effects by
stable delivery ID; delivery is at least once.

## Give each consumer its own subscription

```ts
const relay = await bus.subscribe('user-relay', {
  topics: ['agent.question', 'agent.turn-completed'],
});
const audit = await bus.subscribe('audit', { topics: ['agent.turn-completed'] });

await bus.publish({
  topic: 'agent.turn-completed',
  body: JSON.stringify({ run: 'run-42', outcome: 'completed' }),
  dedupeKey: 'run-42-turn-7',
});

const listener = relay.listen(async (delivery, context) => {
  await durableAccept(delivery.id, delivery.message.body, context.signal);
});
// Later, stop taking new messages and finish running handlers:
await listener.close();
```

`durableAccept` is supplied by your application. Exact topic names are matched;
there are no wildcard filters. Each matching subscription gets its own delivery.
Workers opening the same subscription name compete for its queue. A newly
created subscription receives future publications only. Offline subscriptions
retain their pending messages.

Publication snapshots recipients atomically. If there are no matching
subscriptions, or any target is full, the entire publication refuses. A retry
with the same dedupe key preserves the original recipients, even if subscriptions
have since been added. A direct `send` with a `topic` field remains a direct send.

Subscriptions persist by default. An optional `inactivityTtlMs` makes a temporary
subscription expire after its consumers stop renewing it. Active `wait` and
`listen` calls renew even while idle; publishing does not. Retirement cancels
pending and claimed deliveries, invalidates their receipts, and records an event.
A listener signals cooperative cancellation; it cannot undo an external effect.
Recreating a name creates a new generation. Existing handles cannot consume that
new queue. `subscription.close()` closes a local handle; `subscription.remove()`
retires its durable queue. `bus.subscriptions()` inspects existing subscriptions.

## Route questions and answers

Optional payload helpers are independent of the storage backend and runtime UI:

```ts
import { encodeAgentMessage, validateAnswer } from '@semaphile/messaging/agent-messages';

const question = {
  version: 1 as const,
  type: 'question' as const,
  question: 'Which environment should receive this change?',
  options: [
    { id: 'staging', label: 'Staging', example: 'Preview for the team' },
    { id: 'production', label: 'Production' },
  ],
};
await bus.publish({
  topic: 'agent.question',
  body: encodeAgentMessage(question),
  correlationId: 'question-42',
  replyTo: 'project-a-agent',
  dedupeKey: 'question-42',
});

const answer = validateAnswer(question, {
  version: 1,
  type: 'answer',
  selectedOptionId: 'staging',
  notes: 'Run the smoke tests first',
});
await bus.send({
  to: 'project-a-agent',
  body: encodeAgentMessage(answer),
  correlationId: 'question-42',
});
```

Create the reply mailbox before sending the question. Options require distinct
IDs and labels; examples and answer notes are optional. `decodeAgentMessage`
validates encoded payloads. Answers must also be checked against their question.
A `turn-completed` payload carries `projectId`, `runId`, `turnId`, and an outcome
of `completed`, `failed`, or `cancelled`, with an optional summary. Routing,
correlation and expiry belong to the envelope. Displaying questions, collecting
user input and admitting messages into a harness remain adapter responsibilities.

## CLI and project configuration

```json
{
  "version": 1,
  "messaging": {
    "backend": "redis",
    "redis": {
      "urlEnv": "REDIS_URL",
      "namespace": "engineering",
      "store": "agent-events",
      "readiness": "warn"
    },
    "clientDefaults": { "configMismatch": "error" }
  }
}
```

Redis-only configuration needs no `directory`. The nearest `semaphile.json`
controls discovery. `messagingOptions()` resolves it, and
`openConfiguredMessaging(resolved.open)` opens the selected backend. Explicit
SQLite `--store PATH` and Redis selectors are mutually exclusive.

```sh
semaphile message subscribe --name user-relay --topics agent.question,agent.turn-completed
semaphile message publish --topic agent.question --body-file question.json
semaphile message wait --subscription user-relay --timeout 30000 > delivery.json
semaphile message ack --receipt-file delivery.json
semaphile message subscriptions
semaphile message unsubscribe --name user-relay

# Bypass project discovery with a complete Redis selector:
semaphile message agents --redis-url-env REDIS_URL \
  --namespace engineering --messaging-store agent-events

# Both payloads and receipts can be piped:
cat question.json | semaphile message publish --topic agent.question --body-file -
cat delivery.json | semaphile message ack --receipt-file -
```

Use `--inactivity-ttl MS` when creating a temporary subscription. `receive`,
`wait` and `listen` accept `--subscription NAME` instead of `--as MAILBOX`.
`listen` takes the existing external handler command after `--`.

## Restricted credentials and independent clients

The deployment conformance recipe uses one unprivileged OS account per host
with two independent project configurations and distinct Redis users. Separate
OS users, separate homes, and private-file isolation remain unverified; see the
[deferred validation record](https://github.com/semaphile/semaphile/issues/2).
Redis credentials restrict a store's keys and notification channel. Participants
within that store cooperate: ACLs do not isolate individual message fields,
mailboxes, or recipients from another authorized participant.

Calculate the root with the public helper rather than guessing its encoding:

```js
import { messagingKey } from '@semaphile/redis/messaging';
console.log(messagingKey('engineering', 'agent-events'));
```

For that exact root `KEY`, grant both `~KEY` and `~KEY:*`. Lua reads and writes
computed hash and sorted-set keys beneath the root; granting only the root
fails. Grant the exact `&KEY:notify` channel for subscription and publication.
Do not grant `~*` or `&*`. Redis key permissions are not a database-number
isolation boundary; use separate Redis endpoints when database separation is
required as an authorization boundary.

The [Redis ACL reference](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/) describes the key, channel, and command rules.
An administrator can provision each user with this command allowlist, plus its
own password, the two key patterns, and the channel pattern:

```text
reset on >PASSWORD ~KEY ~KEY:* &KEY:notify
+ping +hello +client|setinfo +quit +time +eval
+subscribe +unsubscribe +publish +type +exists
+hget +hset +hdel +zcard +zrangebyscore +zscore +zadd +zrem
```

This is a list of arguments for `ACL SETUSER`, not a shell command. Substitute
values through your secret-management process; never commit credential-bearing
URLs. Use separate sender and receiver users with the same store permissions.
The application does not need ACL administration, CONFIG SET, FLUSHDB, or
permissions for unrelated keys/channels.

Give each project the Redis-only `semaphile.json` shown above and set its
`REDIS_URL` environment variable to its own authenticated URL. In the receiver's
project, create the mailbox; in the sender's project, send the message; then
receive and acknowledge in the receiver's project:

```sh
# Receiver project, receiver credentials:
semaphile message create --name relay
# Sender project, sender credentials:
semaphile message send --to relay --body 'Ready for review'
# Receiver project, receiver credentials:
semaphile message wait --as relay --timeout 30000 > delivery.json
semaphile message ack --receipt-file delivery.json
```

No SQLite directory is configured or created. The receipt JSON above is an
application output file, not a coordination store. TLS uses `rediss://` with
normal server-certificate verification; configurable client certificates are
outside this candidate.

The allowlist deliberately omits `CONFIG GET` and `INFO`. Warn mode reports
that persistence cannot be inspected and permits operation; strict mode rejects
startup. To use strict readiness, separately authorize `+config|get` and `+info`
and configure the server's persistence settings described below. These
inspection commands reveal server-wide information, so this is an administrator
choice rather than a permission Semaphile grants itself.

Run `node conformance/redis/messaging-acl.mjs` or the Bun equivalent from a built
checkout to exercise the exchange, denied outside keys/channels, computed-key
requirements, missing notification access, and warn/strict inspection failures.
The harness creates its own temporary users and Redis instance under `.tmp/`.

## Failure and durability boundaries

Messaging reconnects automatically with exponential backoff: 500 ms initially,
capped at 10 seconds, with ±20% jitter. Queued operations default to a 30-second
deadline and a maximum of 1,000 pending commands. The options are
`operationTimeoutMs` and `maxPendingOperations`; optional presence renews with
`sessionTimeoutMs`, default 30 seconds. Waiters resubscribe before checking the
durable queue. Notifications are hints; Lua decides whether work can be claimed.
Computed expiry timers and subscription health checks replace inbox polling.

A dispatched operation whose reply is lost fails with `UNCERTAIN`. Semaphile
does not replay that mutation. Retry sends explicitly with a stable dedupe key,
and retain receipts when reconciling acknowledgment. An uncertain renewal never
extends the locally confirmed claim deadline. Handlers receive cancellation when
ownership can no longer be confirmed. Missing or replaced store identity is a
terminal `STATE_LOST` error; reconnect cannot silently initialize a replacement.

Startup warns when persistence and eviction settings are unsafe or cannot be
inspected. `readiness: 'strict'` requires AOF enabled, `appendfsync always`,
`no-appendfsync-on-rewrite no`, healthy AOF writes, and `maxmemory-policy noeviction`.
Semaphile never changes these server settings. The checks do not establish
infrastructure durability or guarantee that failover cannot lose acknowledged
writes. Configure Redis access controls, persistence and recovery for your needs.
The write-permission preflight uses the Redis 7+ [Lua ACL API](https://redis.io/docs/latest/develop/interact/programmability/lua-api/); conformance targets Redis 8.4.
Cluster routing, Sentinel discovery, SQLite replication and offline mirrors are
outside this increment.

## Upgrade local messaging explicitly

Durable subscriptions use SQLite messaging format **1.2**. Stop all local
messaging clients, including clients without a presence registration, before:

```sh
semaphile message upgrade --store ./.semaphile/messaging
```

The offline transaction upgrades messaging 1.0 or 1.1, preserving existing
messages, dedupe, trace metadata and receipts. A failed transaction rolls back.
Ordinary opens reject old formats and never migrate. Upgrade all readers together;
old clients cannot read 1.2. Limiter formats are unchanged. Redis messaging has
its own format and cannot use this SQLite upgrade command.

A successful upgrade is not reversible by installing an older package. The
transaction's rollback guarantee applies to a failed upgrade, not a later
package downgrade. Keep a backup of the entire closed store before upgrading.
The candidate's installed-archive verification uses a real 0.2.0-created store
in addition to the synthetic crash and rollback conformance cases.

The historical unpublished 0.4.0 pilot includes proxy work and is a separate
artifact identity. Replacing that pilot with this messaging-only candidate
removes its HTTP/MCP proxy surface. Stop its clients, preserve the original
archives and closed stores, and check the stored messaging format before opening
with the candidate. A 1.2 store does not need a 1.1-to-1.2 upgrade. This is not a
general 0.4.0 downgrade promise or a relabeling of its archives.

Presence has its own renewable session lifetime. If an outage exceeds that
lifetime, the old registration remains offline after reconnect; inspect `agents()`
and register again when the application is ready. Reconnect does not recreate
expired presence or replay a lost registration mutation.
