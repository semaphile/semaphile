# Semaphile

**Shared limits. Durable handoffs. Independent agents.**

Semaphile is a **coordination toolkit for agents**. It lets separate processes
share request budgets and exchange messages, without running a local broker.
Use it from TypeScript, Node, Bun, or the messaging CLI.

Five agents, each allowing five concurrent requests, can send 25 requests to the
same service. A message sent to a terminal pane can disappear into the wrong
prompt. A crashed worker can leave everyone else waiting for capacity it will
never release.

Semaphile gives those agents shared rules and a place to leave work for each
other—even when they start independently, run in different worktrees, or use
different harnesses.

## Why use it?

### Keep parallel agents from overwhelming a service

Point participating processes at the same pool and enforce **five concurrent
requests total**, instead of five per process. Share request spacing and credit
budgets too. This works for APIs with published limits and for a self-hosted
service where you choose a safe concurrency cap from its actual capacity.

With the HTTP helpers or an outcome classifier passed to `execute`, shared
cooldown lets one caller's throttling response slow down its peers.
Optional circuit breaking gives a failing service time to recover. Bounded
exponential backoff is available for operations explicitly marked safe to retry.
See [execution and recovery](docs/resilience.md).

### Leave a handoff that outlives the sender

Send “the implementation is ready for review” to a named mailbox. The recipient
doesn't have to be online at send time. A receiver claims the message, hands it
to its application, and acknowledges durable acceptance. Abandoned claims can
be delivered again within configured retry and expiry limits.

Stable delivery IDs support deduplication; correlation IDs connect replies;
retained history and lifecycle events help explain what happened. Optional agent
registration records presence. **Acknowledgment means acceptance, not task
completion**—a completed review can be a separate reply.

### Coordinate without operating another service

On one machine, processes open the same local SQLite store directly. There is
no broker to start, supervise, or reconnect to. Waiters sleep on OS notifications
or a computed deadline; they don't repeatedly poll an inbox or ask whether
capacity is free.

A command can wait for one message and exit. An application can listen for its
whole lifetime. Separate projects can share an explicit local store path; they
don't need a common parent process or an orchestrator-owned session.

For rate limits across machines, an optional Redis backend supplies shared
admission through one authoritative Redis endpoint. The unreleased 0.3.0 source
also supports [Redis messaging](docs/redis-messaging.md).

## Try it

Semaphile is experimental. **0.2.0 is published on npm.**
See [release status](docs/releases.md).

### Share a request limit

```sh
npm install @semaphile/core@0.2.0
# Or: bun add @semaphile/core@0.2.0
```

Wrap your existing request code:

```ts
import { openLimiter } from '@semaphile/core';

export async function fetchPages(urls: string[]) {
  const limiter = await openLimiter({
    path: './.semaphile/service.pool',
    config: { maxConcurrent: 5, minTime: 100 },
  });

  try {
    return await Promise.all(
      urls.map((url) =>
        limiter.schedule(async () => {
          const response = await fetch(url);
          return response.text(); // Keep capacity until the body is consumed.
        }),
      ),
    );
  } finally {
    await limiter.close({ drain: true });
  }
}
```

Run callers in two processes with the **same resolved pool path** and they share
the five slots and 100 ms admission spacing. Different worktrees need a common
absolute path; identical relative strings can resolve to different stores.
All clients must supply the same full normalized pool configuration, or opening
fails. A different concurrency setting cannot silently alter a shared pool.

This `schedule` example limits admission only: it makes one attempt and does not
classify HTTP failures or establish shared cooldown. For that feedback, timeouts,
safe retries and managed response lifetime, use
[the execution and HTTP APIs](docs/resilience.md).

### Send a durable message

```sh
npm install @semaphile/messaging@0.2.0
npx semaphile init
npx semaphile message create --name reviewer
npx semaphile message send --to reviewer --body 'The implementation is ready for review'
```

In the receiving session, using the same store:

```sh
npx semaphile message wait --as reviewer --timeout 30000 > receipt.json
# Hand the delivery to your application's durable inbox, then acknowledge:
npx semaphile message ack --receipt-file receipt.json
```

`init` creates project defaults in `semaphile.json`. Commands discover the nearest
config from the working directory upward; `--store PATH` selects a store explicitly.
The waiter exits after claiming one delivery; its receipt can be acknowledged by
another process before the claim expires. Claims default to five minutes, and an
exited waiter does not renew them. Use renewal or a listener for longer handoffs;
an expired receipt is stale. The 30-second timeout limits waiting for a message,
not claim lifetime. A timeout exits with code 2 and provides no delivery to acknowledge.

Your runtime adapter handles admission into an agent's context or task queue.
Printing a message or typing it into a pane does not prove the agent accepted it.
The [messaging guide](packages/messaging/README.md) covers listeners, registration,
broadcasts, stdin input, receipts, retention, and delivery semantics.

## Choose where coordination lives

| Backend | Coordinates                          | Requires                                    | Messaging                               |
| ------- | ------------------------------------ | ------------------------------------------- | --------------------------------------- |
| Memory  | Callers in one JavaScript runtime    | A shared pool key; no native addon          | No                                      |
| SQLite  | Independent processes on one machine | The same local store path; no broker        | Yes, in a separate messaging store      |
| Redis   | Processes on different machines      | The same Redis endpoint, namespace and pool | Yes, in the unreleased source increment |

Use `@semaphile/core/memory` for memory pools and `@semaphile/redis` for Redis.
Install only what you need; messaging works independently of the limiter.
[Redis setup](packages/redis/README.md) · [Redis messaging and topics](docs/redis-messaging.md) · [Memory and SQLite API](packages/core/README.md)

## The hard parts Semaphile handles

**Check and reserve together.** Concurrent callers cannot each spend the same
remaining budget. A denied admission reserves nothing.

**Wake without missing the change.** Subscription, notification and state checks
follow a coordinated protocol. A wakeup is a reason to check again; only an
atomic admission or claim grants ownership.

**Recover ownership after crashes.** Local limiter recovery verifies an owner's
lifetime lock instead of trusting a PID. Messaging uses expiring claim receipts;
an old receipt cannot acknowledge a replacement claim.

**Account for actual work lifetime.** A timeout or cancellation request does not
prove an HTTP operation stopped. Managed execution tracks cleanup separately
from the result returned to the caller.

**Keep the application responsive.** Local database and blocking-lock work runs
in a coordinator worker; Rust owns the native waits and their cleanup. User
callbacks run outside coordination locks.

SQLite provides transactions. Semaphile adds the scheduling and delivery protocol
around them. The local implementation uses rollback journaling, companion lock
and notification files, and macOS/Linux kernel events. See
[architecture](docs/architecture.md) and [blocking and crash recovery](docs/blocking.md).

## How it compares

| If you're considering…                                                        | Where Semaphile fits                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [p-limit](https://github.com/sindresorhus/p-limit)                            | Use p-limit for a small promise-concurrency limiter. Semaphile adds coordination across independent processes.                                                                                                 |
| [Bottleneck](https://github.com/SGrondin/bottleneck)                          | Bottleneck offers scheduling and Redis clustering. Semaphile adds daemonless local sharing and durable mailboxes; it is not a drop-in Bottleneck replacement.                                                  |
| [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible) | It offers counters across many stores, including SQLite. Semaphile combines callback scheduling, shared concurrency, spacing, budgets and recovery.                                                            |
| [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail)         | Agent Mail offers an MCP-facing coordination service, searchable threads and file reservations. Semaphile offers direct embedded coordination and a CLI; runtime inbox integration remains your adapter's job. |
| A custom SQLite outbox or directory of JSON files                             | Semaphile supplies claims, bounded redelivery, dedupe, presence, retention and event-driven waits that otherwise become application code.                                                                      |

See [the comparison guide](docs/comparison.md) for the tradeoffs, primary sources,
and why a durable store, a wakeup mechanism and runtime delivery are separate jobs.

## Add it to an existing toolchain

Use the library around requests you control, and the CLI from agents or scripts.
The toolkit doesn't choose models, spawn your agent team, or decide who reviews
what. Your existing harness keeps those responsibilities.

**OpenTelemetry:** optional traces and shared-pool collectors help explain
queueing, requests and messaging. See the [observability guide](docs/observability.md)
for setup with the published 0.2.0 packages.

## Know the boundaries

Local stores require a local filesystem and cooperative processes. They are not
for NFS/SMB mounts or isolation between mutually untrusted users. Runtime adapters
must deduplicate message deliveries if repeated external effects matter:
messaging is **at least once**, not exactly-once task execution. History is bounded.

Queued callbacks live in their caller's memory; they are not durable jobs that
another process resumes after a crash. Lease expiry can release capacity while
remote work continues, and Redis owner expiry has the same overlap risk after a
partition. Queues are FIFO within a client, without global fairness guarantees.
Redis Cluster, Sentinel and failover guarantees are outside the current contract.

Prebuilt native artifacts cover **macOS arm64 and Linux x64**, with no Rust
compiler or install-time compilation needed. Node >=22.18 is required; verification
covers Node 22.23/Linux, Node 26.7/macOS and Bun 1.4.2 on both platforms. Other
platforms and versions are not established by that evidence. Crash recovery tests
do not establish power-loss or reboot durability. See [testing](docs/testing.md).

## Learn more and contribute

[Documentation](docs/README.md) — API references, architecture and operating guides.

[Changelog](CHANGELOG.md) — features and compatibility changes by release.

[Specification](SPEC.md) — the authoritative coordination contract.

[Contributing and source builds](CONTRIBUTING.md) — setup, coding conventions and verification.

## License

[MIT](LICENSE) © 2026 Cedric Hurst.
