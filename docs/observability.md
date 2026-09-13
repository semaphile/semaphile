# Observability

This feature is under development and is not in the published 0.1.0 packages.
Use matching builds from this branch. Semaphile does not start monitoring services
from limiter clients or executor agents.

## Library instrumentation

Configure your application's OpenTelemetry SDK first, then pass an adapter to
any SQLite, Redis, or memory limiter:

```ts
import { openLimiter } from '@semaphile/core';
import { createInstrumentation } from '@semaphile/otel';

const limiter = await openLimiter({
  path: './.semaphile/pools/notion',
  config: { maxConcurrent: 3, minTime: 350 },
  telemetry: {
    pool: 'notion',
    instrumentation: createInstrumentation(),
    onEvent: (event) => console.log(event.kind, event.elapsedMs),
  },
});
```

Telemetry configuration is local to the client, not shared pool policy. The
adapter's main entry point uses only the OpenTelemetry API. It does not initialize
an SDK, exporter, global provider, or listener. The explicit `@semaphile/otel/sdk`
entry point provides standalone SDK setup for command-line hosts.

Events distinguish queueing, lease grant, callback execution, retries, caller
settlement, lease release, and completed cleanup. A fetch caller settles when
headers are delivered; the operation can subsequently fail while reading its body.
`responseCompleted`, `responseCancelled`, and `responseFailed` distinguish body
outcomes. A timeout does not imply that a callback stopped or capacity was released.

Instrumentation context hooks must be synchronous and invoke work exactly once.
A hook returning a promise disables that adapter for the client and reports a
safe diagnostic. Use `onEvent` for asynchronous subscribers: its queue defaults to
1024 events, processes one subscriber call at a time, and drops excess events.
`onDiagnostic` reports observer failure and dropped-event counts. A hung subscriber
cannot block admission, callbacks, cleanup, or close. Synchronous user hooks must
remain short; JavaScript cannot preempt arbitrary synchronous application code.

Local queue and running-callback metrics are not global lease occupancy. Spans
preserve submission context, including through queued work and retries. Payloads,
arbitrary headers, credentials, and raw exception messages are not recorded.
Choose stable pool labels; do not use request or worker identifiers as metric
attributes. Telemetry is lossy observation, not a durable request ledger.

## Shared-pool collector

Install the optional OTel package alongside messaging and the backends you use.
A developer or designated orchestrator can run:

```sh
semaphile telemetry collect --root ./.semaphile/pools --port 9464
```

For project-local Bun installations, use `bun run --bun semaphile` in place of
`semaphile`. An external collector supports SQLite and Redis; memory pools can
only be instrumented inside their owning process.

The collector serves Prometheus text at `/metrics` and JSON status at `/healthz`.
It binds to `127.0.0.1:9464` by default; `--host` and `--port` override this. No web
dashboard or administrative HTTP actions are included. `/healthz` reports source
or pool failures with HTTP 503. Failed pool reads do not become zero-valued samples.

Without explicit source flags, the nearest `semaphile.json` supplies sources. If
it has no collector sources, its `<directory>/pools` is the default local root:

```json
{
  "version": 1,
  "directory": "./.semaphile",
  "telemetry": {
    "collector": {
      "sources": [
        { "name": "local", "backend": "sqlite", "directory": "./.semaphile/pools" },
        { "name": "team", "backend": "redis", "urlEnv": "TEAM_REDIS_URL", "namespace": "team" }
      ],
      "port": 9464,
      "watchPools": true
    }
  }
}
```

Local directories in project configuration resolve relative to that file. Redis
Cluster sources use `rootUrlsEnv`, an array of environment-variable names, instead
of `urlEnv`. Credentials remain in the environment. CLI `--root` and
`--redis-url-env` can be repeated and replace configured sources; `--namespace`
applies to explicitly selected Redis sources. `--source NAME` selects configured
sources and can also be repeated.

All discovered pools are selected by default. Repeated `--pool` and `--include`
selectors form a union; every matching `--exclude` wins. Patterns are case-sensitive:
`*` matches any sequence and `?` matches one Unicode code point. Match a pool name
or a qualified `source/pool` name. Quote patterns to prevent shell expansion:

```sh
semaphile telemetry collect --include 'api-*' --include 'team/*' \
  --exclude '*-test' --exclude 'local/private' --port 9465
```

`--watch-pools` is enabled by default. New pools join collection on subsequent
scrapes or OTLP export cycles. `--no-watch-pools` freezes the initial pool identities.
Redis discovery metadata is created atomically when a new client opens a pool;
legacy hash-only pools need a new-client open or an explicit `--pool NAME` selector.
Discovery is bounded and never crawls unrelated directories or creates pools.

## Collector conflicts

Every collector registers its ownership, including collectors permitting overlap.
If some or all initial pools already have collectors, startup warns with affected
pools and collector IDs, rejects the selection, and releases partial acquisitions.
Conflicts discovered later warn and skip those pools while others continue.

To deliberately collect overlapping pools:

```sh
semaphile telemetry collect --include 'team/*' --allow-overlap
```

The override does not evict or disable another collector. Both remain visible,
and the warning explains that shared metrics can be duplicated. Existing owners
warn when overlap appears. Warnings change with ownership rather than repeating
on every scrape. Prometheus `target_info` carries collector identity; OTLP uses
resource identity, separate from pool metric dimensions.

Local ownership is held by kernel lifetime locks and recovers after process death.
Redis ownership uses renewable 30-second leases. A collector that cannot establish
continued ownership stops producing shared measurements. Exporter retries and
Redis failover retain their own delivery limitations: this is not an exactly-once
telemetry system.

## Sampling and exporting

Scrapes and OTLP export cycles refresh shared snapshots. This monitoring-only
sampling does not change notification-driven limiter admission. Busy local gates
produce a failed sample instead of waiting on request coordination. Inspection is
performed on workers, with bounded requests and state sizes; unusually large pools
can report unavailable observation while request processing continues.

Enable OTLP HTTP/protobuf exporting explicitly:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  semaphile telemetry collect --otel --interval-ms 15000
```

Standard OTLP endpoint and header environment variables configure the exporters.
Standalone exporting defaults to a 15-second interval and bounded shutdown flushing.
It does not replace the host application's SDK. No OTLP logs pipeline is included.

Redis observers require `INFO server` on primaries to identify aliases by the
server's run ID, database, namespace and pool. Cluster seed order and credentials
are not pool identities. A response timeout retires the observation connection
and invalidates its registrations; health becomes degraded until the explicitly
managed collector is restarted. Startup must verify every selected registration
within its bounded cycle, or it fails and releases partial acquisitions.

## Messaging tracing and offline upgrade

This unreleased change requires matching messaging and OTel builds. Published
0.1.0 stores use messaging format 1.0. Stop **every** client before upgrading:

```sh
semaphile message upgrade --store .semaphile/messaging
```

The command takes the existing gate and commits the new nullable trace column
and format 1.1 together. It preserves messages, delivery attempts, receipts,
dedupe records and history. Ordinary opens never migrate. Live registered agents
cause a refusal, but an unregistered old process cannot be detected reliably;
registration checks do not replace stopping clients. Mixed 1.0/1.1 readers are
unsupported. Use a backup of the entire closed store for rollback to old clients.
The library equivalent is `upgradeMessaging({ path })`.

Applications supply their own OTel SDK and context manager:

```ts
import { openMessaging } from '@semaphile/messaging';
import { createMessagingInstrumentation } from '@semaphile/otel/messaging';

const baggageAllowlist = ['tenant']; // default is [] at both boundaries
const client = await openMessaging({
  path: '.semaphile/messaging',
  telemetry: {
    baggageAllowlist,
    instrumentation: createMessagingInstrumentation({ baggageAllowlist }),
    onDiagnostic: ({ kind }) => console.error(kind),
  },
});
```

Send, receive/wait, processing attempts and claim settlements produce spans.
Each handler attempt has a new processing span with its ambient parent and a
link to the committed sender context. Redelivery preserves the sender link.
Handler errors and claim loss mark the processing span as failed. Metrics use
operation/outcome dimensions; message, delivery and correlation IDs are span
attributes only. Bodies and handler error text are not captured.

`send({ to, body, trace })` accepts explicit `traceparent`, `tracestate` and
`baggage` metadata. Automatic capture is optional and invalid captured metadata
is dropped with a diagnostic. Explicit invalid metadata is an input error.
Bounds are 256 bytes for traceparent (version 00), 512 for tracestate and 4096 for
baggage. The adapter also limits each baggage entry to 1024 encoded bytes.
Baggage requires an allowlist on injection and extraction. The `trace` field is
stored separately, returned on deliveries/history, and excluded from message
content and dedupe identity: the first committed context wins. Trace bytes count
toward retention and are evicted with the message envelope. Optional trace data
in receipts preserves context for later manual acknowledgements; it has no role
in claim validation.

`commandHandler` clears inherited `TRACEPARENT`, `TRACESTATE` and `BAGGAGE`
(including lowercase variants), then injects the current processing context.
Without instrumentation those variables remain absent. The delivery JSON still
contains its committed sender context, so a consumer-owned adapter can use it
explicitly. `processDelivery(delivery, callback)` provides the same processing
scope for manual receivers; callers remain responsible for settling their claim.

CLI export is opt-in with `--otel` or `telemetry.enabled: true` in the nearest
`semaphile.json`; `--no-otel` overrides that default. For message commands,
`--store` bypasses project discovery, including telemetry defaults; use `--otel`
and environment configuration with an explicit store. Install `@semaphile/otel`
alongside messaging. `telemetry.serviceName` and `telemetry.baggageAllowlist`
configure the standalone SDK. Standard OTLP environment variables select the
HTTP/protobuf endpoint. Incoming uppercase context variables are extracted at
the CLI boundary. Export and bounded shutdown failures do not change command
JSON stdout or protocol exit codes. The default shutdown budget is one second.
