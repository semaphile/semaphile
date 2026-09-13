# Semaphile

Semaphile is a **coordination toolkit for agents**. Share request budgets, limit
concurrency, and exchange messages across independent processes—with local,
daemonless coordination or Redis across machines.

The TypeScript library queues callbacks and shares admission limits before those
callbacks run. Agents can also exchange durable messages through named mailboxes.

Choose **SQLite** for processes on the same machine with a daemonless local
pool, **Redis** for processes on different machines sharing one Redis endpoint,
or **memory** for callers sharing one JavaScript runtime.

This is experimental software. The current development version is
`2026.9.2-dev.0`; packages are not published. Node >=22.18 is required for source
builds. Runtime verification covers Node 22.23/Linux, Node 26.7/macOS and
Bun 1.4.2 on macOS arm64 and Linux x64.
The current Rust, recovery, HTTP and maintenance implementation passes the same
472 scenarios under Node and Bun on both platforms, plus two cross-host Redis
pairings. See [testing](docs/testing.md) for scope and limitations.

## Start from source

You need Node, npm, Rust 1.93.1 and a platform linker for explicit native builds.
Fetch the pinned Rust dependencies once with
`cargo +1.93.1 fetch --locked --manifest-path packages/core/native/Cargo.toml`.
See [contributing](CONTRIBUTING.md) for setup and platform requirements.

```sh
npm ci --ignore-scripts
npm ci --prefix packages/core --ignore-scripts
npm ci --prefix packages/redis --ignore-scripts
npm ci --prefix packages/messaging --ignore-scripts
npm run build
```

For a local SQLite pool:

```ts
import { openLimiter } from './packages/core/dist/src/index.js';

const limiter = await openLimiter({
  path: './.tmp/service.pool',
  config: { maxConcurrent: 5, minTime: 100 },
});

try {
  await Promise.all(jobs.map((job) => limiter.schedule(() => callService(job))));
} finally {
  await limiter.close({ drain: true });
}
```

For Redis, use `openLimiter` from `./packages/redis/dist/index.js` and replace
`path` with `url`, `namespace` and `pool`. Installed consumers use
`@semaphile/core` or `@semaphile/redis`; Redis needs the matching core peer package.
See the [Redis example](packages/redis/README.md).

For in-process limiting, import `openLimiter` from `@semaphile/core/memory`
and pass `key: 'service'` instead of `path`. Matching keys share limits within
one JavaScript runtime, including duplicate module copies. Pool configuration,
budgets and refill timing persist until the runtime exits, even after all clients
close. This entry point loads no SQLite or native addon. Separate workers and
processes need SQLite or Redis to coordinate.

## Recovery and HTTP

Use `execute` for bounded, explicitly safe retries; `http.request` and `http.fetch`
also manage response-body lifetime. Shared cooldown honors provider guidance,
and an optional breaker limits repeated service failures. Persistent pool
maintenance rejects new work while accepted operations drain. See
[execution, HTTP and maintenance](docs/resilience.md) for defaults and examples.

## Local messaging

`@semaphile/messaging` adds durable named mailboxes, atomic broadcasts, claim
receipts, listeners and a CLI over independent local SQLite stores. A common
Semaphile directory can hold both messaging and rate-limiter pools.

```sh
node packages/messaging/dist/src/cli.js init
node packages/messaging/dist/src/cli.js message create --name reviewer
node packages/messaging/dist/src/cli.js message send --to reviewer --body 'Review the change'
node packages/messaging/dist/src/cli.js info
```

Installed consumers use `semaphile message ...`. See the
[messaging API, configuration and delivery contract](packages/messaging/README.md).
Messaging clients warn and adopt persisted settings by default; opt into
`configMismatch: 'error'` for strict validation. Limiter clients always fail
on mismatched shared configuration.

## What the limits mean

- `maxConcurrent` limits occupied units across clients; a job's `weight` defaults to one.
- `minTime` spaces admissions across clients.
- Reservoirs provide shared request budgets, explicit increments and optional fixed-period resets.
- Request expiration can reclaim a lease while its callback is still running.
- Queued cancellation prevents dispatch. A running callback must handle its own request cancellation.
- `close()` cancels queued work and awaits running callbacks; `close({ drain: true })` finishes queued work too.

Every client opening the same pool must provide the same full normalized config.
Queues are local FIFO; cross-process fairness is not guaranteed. Redis owner
expiry can admit new work while a disconnected client's HTTP requests still run.
Read the backend limitations before selecting expiration and owner timeouts.
This implements a scheduling API, not the complete Bottleneck facade.

## Find your way around

- [Documentation index](docs/README.md)
- [Contributing and coding conventions](CONTRIBUTING.md)
- [Architecture and one request's lifecycle](docs/architecture.md)
- [Testing on Node, Bun, macOS and Linux](docs/testing.md)
- [SQLite API and limitations](packages/core/README.md)
- [Redis API and limitations](packages/redis/README.md)
- [Messaging library and CLI](packages/messaging/README.md)
- [Authoritative specification](SPEC.md)

## License

[MIT](LICENSE) © 2026 Semaphile contributors.
