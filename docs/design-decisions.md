# Design decisions

These are current design rationales, not a transcript of development sessions.
[SPEC.md](../SPEC.md) remains authoritative.

## SQLite plus companion files

SQLite gives us transactional accounting without a database daemon. A pool is
a directory so separate files can provide short coordination locks, stable
notification subscriptions and unique owner-lifetime locks. SQLite transactions
alone do not provide cross-process capacity notifications or reclaim a lease
when its process dies.

## Hints followed by an authoritative check

File events and Redis Pub/Sub can wake multiple contenders. They are not capacity
tokens. Every contender checks shared state atomically before dispatch. Publishing
before a mutation while serialization still holds prevents a writer crash from
leaving a committed change with no notification attempt.

## Request expiration and owner recovery are separate

A request deadline describes how long its reservation remains valid. Owner
recovery handles a participant that cannot release its reservations. SQLite can
check a same-machine lifetime lock; Redis uses a renewable owner timeout across
machines. Timeout recovery favors availability and can overlap remote requests
still executing after a partition. Null request expiration does not disable
Redis owner recovery.

## Fail terminally after uncertain transport outcomes

A lost Redis reply does not prove the mutation failed. Automatically retrying or
refunding could spend or restore budget incorrectly. The client reports failure
and requires an explicit fresh open. Internal sequences guard operation order;
they do not imply automatic retry support.

## One Redis state write

The first Redis implementation calculates changes to one versioned JSON state
object and commits with a single `SET`. Decimal strings preserve mutable integer
values through Lua's JSON encoding. This is simple to audit but costs
O(owners + active leases) per operation. Indexed Redis structures are a possible
future scaling change, not an established performance improvement here.

## Shared callback lifetime, separate transports

The common client owns callback results, cancellation and close/drain semantics.
Each backend owns admission and wakeups. This keeps Redis free of SQLite/native
imports and lets the same lifecycle conformance protect both implementations.
