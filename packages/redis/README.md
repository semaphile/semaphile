# @semaphile/redis — experimental Redis backend

Version **0.1.0**. Install with the matching `@semaphile/core` peer package.
See the [release guide](../../docs/releases.md) for installation and verified GitHub archives.

```ts
import { openLimiter } from '@semaphile/redis';

const limiter = await openLimiter({
  url: process.env.REDIS_URL!,
  namespace: 'my-team',
  pool: 'hindsight',
  config: { maxConcurrent: 5 },
  ownerTimeoutMs: 30_000,
});
try {
  await Promise.all(jobs.map((job) => limiter.schedule(() => callService(job))));
} finally {
  await limiter.close({ drain: true });
}
```

Processes on different hosts share capacity when they use the same Redis
database, namespace, pool and full normalized configuration. A mismatch fails
before owner registration. `redis://` and `rediss://` URLs use the Redis
client's authentication and TLS support; keep credentials out of logs.
Tests use isolated Redis 8.4, Node 26.7/macOS and 22.23/Linux, and Bun 1.4.2
on both hosts. Other Redis versions and hosted-provider configurations have
not been verified. Recovery, execution, HTTP and maintenance pass the live Redis
suite on both hosts/runtimes; cross-host pairings also pass.

The API preserves the core's callback return values and errors, weighted
`maxConcurrent`, `minTime`, reservoirs and fixed-phase reservoir resets,
`incrementReservoir`, `currentReservoir`, per-request `expirationMs`, queued
cancellation and drain/close semantics. `inspect()` exposes current leases
and budgets; Redis has no historical trace (`trace` is empty). Queues are
local FIFO; cross-process fairness is not guaranteed. This is not a complete
Bottleneck API facade.

Each client owns two connections: commands and notifications. Lua makes the
shared admission decision atomically using Redis time. Notifications wake
local queues; computed deadlines handle expiry, spacing and refill. No
periodic admission polling runs. Ownership renews at one third of its timeout,
with a subscription PING at that same deadline. Due renewals run before
queued application commands; application commands retain their order. Startup, command replies and
subscription health checks have a response timeout of
`min(10_000, floor(ownerTimeoutMs / 3))` milliseconds. No transparent reconnect,
mutation replay or local fallback occurs after failure. Close the failed
client and explicitly open a new one; close can reject when cleanup failed.
Already running callbacks are still awaited, and an uncertain command may
have spent tokens even though its caller received an error.

`ownerTimeoutMs` defaults to 30 seconds (integer range 300..2147483647) and
is part of shared config. When an owner dies or loses connectivity, its
capacity is recoverable after that timeout. Its remote HTTP requests may
still be running: timeout recovery can overlap them with new work. Request
expiration is independent; `null` disables a request deadline, not owner
recovery. Aborting a running schedule does not forcibly abort arbitrary SDK
work. Callers must propagate their own request cancellation when needed.

This first backend targets one authoritative Redis endpoint. Each pool uses
one versioned JSON state key. Whole-state operations scan owners, leases and
control records (accepted operations, uncertainty and recovery samples).
Pool metadata persists after clients close. Treat Redis state as coordination
state: eviction, deletion, server-clock jumps, replica promotion, Cluster and
Sentinel are outside the verified guarantees. Existing clients fail on missing
state. Stop all users before deliberately replacing a pool or changing policy.
Redis state version 2 and SQLite limiter format 1.4 include recovery and
maintenance records. Existing older stores are rejected; no automatic migration
is provided. See [execution, HTTP and maintenance](../../docs/resilience.md) for
the shared APIs and replacement procedure. `create: false` on open atomically
refuses absent state; the administrative CLI always uses this mode.

The Redis runtime imports only `@semaphile/core/client`, which contains the
shared callback lifecycle and config validation. It loads neither SQLite nor
a native addon. From source, build core first using its README, then:

```sh
npm ci --prefix packages/redis --ignore-scripts
npm run --prefix packages/redis build
npm run --prefix packages/redis lint
npm run --prefix packages/redis lint:types
node conformance/run.mjs redis
```

The test harness starts an isolated local `redis-server` on macOS or a
`redis:8.4.0-alpine` Docker container on Linux. It uses random loopback ports
and repo-local `.tmp` stores. Cross-host evidence is recorded separately in
[the testing guide](../../docs/testing.md).
