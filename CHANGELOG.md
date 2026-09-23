# Changelog

Semaphile uses semantic versions, with the core, Redis, messaging and OTel packages
released together. Before 1.0, minor releases may include breaking changes;
patch releases contain compatible fixes. Earlier CalVer snapshots were private
pilot artifacts, not published GitHub releases.

## [0.3.0] - Unreleased messaging candidate

- Add native-free Redis messaging with bounded reconnect, uncertain mutation
  outcomes, confirmed claim deadlines, and persistence readiness checks.
- Add durable topic subscriptions on SQLite and Redis, native-free agent payload
  validators, and explicit Redis CLI/config selectors.
- Advance SQLite messaging to format 1.2 through an explicit offline upgrade;
  limiter formats remain unchanged. Ordinary opens never migrate.
- Require matching 0.3.0 Semaphile peers. HTTP/MCP proxy packages are excluded.
  This candidate is distinct from the historical unpublished proxy checkpoints.
- Redis limiter users must install matching `@semaphile/core` explicitly; core is
  now an optional Redis peer so messaging-only consumers can remain native-free.
- Known unported fixes: feature commits `1b56123` and `c9ac5cc` changed collector
  observer fencing and retry/export isolation. This messaging extraction retains
  the 0.2.0 collector behavior, including the risk that a stale collector sharing
  an identifier can affect a replacement registration. Review those fixes before
  publication; they are outside this candidate's messaging scope.

## [0.2.0] - 2026-09-13

### Added

- Optional limiter lifecycle hooks and `@semaphile/otel` adapters with application-owned SDKs.
- Explicit shared-pool collectors with Prometheus/health endpoints, optional OTLP,
  pool selection/discovery, ownership conflict warnings and deliberate overlap.
- Redis Cluster discovery and daemonless local collector registrations.
- Messaging send/receive/process/settlement tracing, bounded W3C propagation,
  baggage allowlists, handler context and opt-in CLI export.
- Explicit offline messaging 1.0 → 1.1 upgrade preserving messages and receipts.
  Trace metadata is separate from content and dedupe identity.

### Compatibility

- SQLite limiter format 1.4 and Redis state 2 remain unchanged. Messaging readers
  must upgrade together; ordinary open rejects old messaging stores.
- Use matching 0.2.0 Semaphile packages. Stop all messaging clients before the
  explicit offline upgrade; 0.1.0 clients cannot read the upgraded store.
- The optional OTel package requires `@opentelemetry/api` 1.9 or later within 1.x.

## [0.1.0] - 2026-09-13

First release, distributed through npm and installable GitHub package archives
under the MIT license. This release remains experimental.

### Added

- TypeScript scheduling with weighted concurrency, admission spacing, shared
  reservoirs, expiration, cancellation and graceful or draining client shutdown.
- Daemonless local SQLite coordination on macOS arm64 and Linux x64, a Redis
  backend for shared limits across machines, and an explicit in-process backend.
- Bounded execution retries with explicit replay safety, shared cooldown,
  optional circuit breaking, and HTTP response-body lifetime management.
- Persistent pool drain, inspection, uncertainty acknowledgement and resume APIs.
- Durable local agent messaging with named mailboxes, broadcasts, fenced claim
  receipts, listeners, bounded retention and the `semaphile` CLI.
- Prebuilt Rust coordination addons for both supported native targets; installation
  does not compile native code. Node and modern Bun runtime support.

### Verified

- 483 default conformance scenarios across macOS/Linux and Node/Bun, with
  additional native, package and protocol checks; see [testing](docs/testing.md)
  for full-run and targeted verification scope.
- Independent reviews of the implementation and follow-up fixes. Sonar's
  changed-code gate passes; existing maintainability findings remain documented
  for further work.

### Limitations

- SQLite coordination requires a local filesystem on one machine. Messaging
  uses SQLite; it does not have a Redis backend.
- Lease expiration and Redis owner expiry cannot stop remote requests already
  sent. Cross-process queue fairness is not guaranteed.
- This is not a complete Bottleneck facade.

[0.1.0]: https://github.com/semaphile/semaphile/releases/tag/v0.1.0
[0.2.0]: https://github.com/semaphile/semaphile/releases/tag/v0.2.0
