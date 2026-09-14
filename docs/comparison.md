# Choosing coordination for independent agents

Semaphile is useful when several independent processes need to share scarce
capacity or leave reliable handoffs, especially when running a local broker would
add more infrastructure than the application needs. Its local limiter and
messaging clients open stores directly. They can be adopted separately.

This guide compares responsibilities and deployment choices, not benchmark scores.
External project documentation was checked on 2026-09-14. The capabilities below
are not claims that Semaphile replaces every feature of those projects.

## A limiter inside each agent does not create a shared limit

[p-limit](https://github.com/sindresorhus/p-limit) is a small promise-concurrency
limiter. It is a good fit when the work you need to bound shares that limiter
instance. Separate agent processes need a mechanism to share the accounting.

[Bottleneck](https://github.com/SGrondin/bottleneck#clustering) already supplies
scheduling, request spacing, reservoirs and Redis clustering. It is an appropriate
choice when those APIs and its deployment model fit. Semaphile's distinguishing
option is a local shared pool with no Redis service, alongside a common scheduling
lifecycle for memory, SQLite and Redis. Semaphile does not implement the complete
Bottleneck facade. Bottleneck documents Cluster and Sentinel support; Semaphile's
Redis backend currently targets one authoritative endpoint without those guarantees.

[rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible) offers
point consumption and rate-limiting policies across many stores, including a
[SQLite implementation](https://github.com/animir/node-rate-limiter-flexible/wiki/SQLite).
SQLite storage is therefore not unique to Semaphile. Choose Semaphile when the
unit you need to manage is a queued operation: reserve concurrency, enforce start
spacing and budget, retain the reservation through execution, then wake peers
when capacity returns. Its managed execution API adds shared cooldown, optional
circuit breaking, bounded safe retries and maintenance drains.

These are integration choices, not automatic migration paths. In particular,
changing a storage backend does not make an existing limiter API compatible.

## Agent messaging products and runtime adapters

[MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail) provides
agent identities, inboxes, searchable threads, Git-backed artifacts, advisory
file reservations and a web UI through an MCP-facing service. Its documented
HTTP deployment is useful when a central service and those collaboration features
are desirable. Semaphile instead exposes an embedded TypeScript library and
short-lived CLI operations over a shared local store. It includes neither Agent
Mail's file reservations nor its web UI.

An agent harness's native queue, hook or inbox is the final destination for a
message. Semaphile can feed that interface through an application adapter. It does
not supply a universal adapter that injects messages into every harness.

There are three distinct milestones:

**Stored:** the message is in the durable mailbox.

**Accepted:** a runtime adapter has durably accepted the stable delivery ID and
payload, after which it acknowledges the claim receipt.

**Completed:** the agent has done the requested work, which it can report in a
separate correlated reply.

A terminal write proves neither acceptance nor completion. Acknowledging before
durable acceptance risks losing the handoff; a crash after acceptance but before
acknowledgment can produce redelivery. The adapter needs deduplication by delivery
ID to avoid accepting the same work twice. Semaphile does not promise exactly-once
external effects.

## Why not build a bus directly on an embedded store?

A daemonless bus has three jobs: **store state**, **wake waiters**, and **deliver
into the runtime**. Comparing only databases leaves two of those jobs unaccounted
for. These substrates can all play a part; the amount of application protocol
required differs.

| Substrate                                                                                                      | What it supplies                                                                                        | What a durable agent bus still needs                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [SQLite](https://sqlite.org/wal.html)                                                                          | Transactions, uniqueness constraints and indexed relational queries; no database server                 | Envelope schema, claim/ack rules, dedupe policy, presence, retention, wakeup protocol and runtime adapters |
| [Maildir-style files](https://www.courier-mta.org/maildir.html)                                                | Independent message files and publication from a temporary directory without exposing a partial message | Bus-wide dedupe, receipt ownership, cross-inbox queries, registry policy and delivery adapters             |
| [LMDB](https://github.com/LMDB/lmdb/blob/mdb.master/libraries/liblmdb/lmdb.h)                                  | Embedded transactions, ordered keys, multiple readers and a serialized writer                           | Key/index layouts, the bus protocol, wakeups and runtime adapters                                          |
| [JSON Lines](https://jsonlines.org/) with [advisory locks](https://man7.org/linux/man-pages/man2/flock.2.html) | Inspectable record framing and cooperative serialization                                                | Torn-write repair, cursors, dedupe indexes, atomic claim state, compaction, wakeups and adapters           |
| [Brokerless ZeroMQ](https://zeromq.org/get-started/)                                                           | Live socket transport and blocking receives without a required broker                                   | Durable history, offline delivery, registry, persistent consumption state and runtime adapters             |

Maildir's publication convention is useful, but atomic visibility is not by itself
a guarantee that a message survives power loss; file and directory synchronization
still matter. LMDB leaves query/index design to the application. JSON Lines
specifies a record format, not crash recovery or transactional acknowledgment.
ZeroMQ patterns also differ: its
[PUB/SUB specification](https://rfc.zeromq.org/spec/29/) explicitly permits dropping
messages at queue limits. A live transport can complement a durable store without
replacing it.

Semaphile packages the application protocol above SQLite: named mailboxes, atomic
broadcast recipient selection, deduplication, expiring claims, stale-receipt
rejection, bounded redelivery, presence, queryable history, lifecycle events and
retention. Your application still supplies the runtime adapter and the meaning
of a task or lifecycle event. Retention and expiry are explicit bounds, so a
mailbox is not a promise to retain every message forever.

## Why Semaphile does not just watch the WAL

SQLite's [WAL documentation](https://sqlite.org/wal.html) describes concurrent
readers and a single writer, plus same-host and filesystem requirements. It does
not supply a cross-process row-arrival subscription. Choosing WAL does not settle
the race between checking an empty inbox and starting a filesystem watch.

**Semaphile currently uses rollback journaling, not WAL.** Both local backends
serialize database operations with a short companion-file gate. A coordinator
worker acquires that gate outside the application's event loop. Rust manages
separate lifetime locks and notification subscriptions.

A waiter subscribes before checking state. A writer signals a dedicated file
before mutation and retains the gate through commit or rollback. Waking waiters
must acquire the gate and recheck authoritative state. This ordering handles the
writer dying between notification and commit; wakeup never grants permission by
itself. Claim expiry and the next possible limiter admission use computed timers,
not a periodic polling fallback.

SQLite alone also cannot tell whether a reservation's process died. Local limiter
recovery checks a unique lifetime lock under the gate; a reused PID is insufficient.
Messaging claims have their own receipt and expiry, independent of the process
that received them. See [blocking](blocking.md) and [architecture](architecture.md)
for the protocol and its verified limits.

## Operational choices

**Use a local store with appropriate permissions.** Share an explicit absolute
path across projects or worktrees. Each independent messaging store is a
separate address space. Network filesystems and mutually untrusted clients
are outside the contract.

**Let Semaphile own its coordination files and transactions.** Do not switch
journal modes, directly update live tables, or delete lock/notification files
to clear a stuck process. A suspended gate holder can delay progress; it is
not evidence that its lock can safely be bypassed.

**Separate durable acceptance from execution.** Deduplicate delivery IDs in the
runtime adapter, acknowledge only after durable acceptance, and send completion
as a later event or reply. Presence means registered participation, not readiness.

Direct local use requires no resident broker, but receiving still requires a
process to run a wait or an adapter when delivery is wanted. A listener can stay
alive by choice. Redis rate limiting requires a Redis service; direct local
clients continue to operate without one.

Redis messaging, topic subscriptions, automatic mirrors and universal harness
adapters are not implemented. A future mirror would need its own ordering,
retention and retry contract; adding another backend alone cannot establish one.
For current features and published versions, return to the [README](../README.md).
