# Changelog

Semaphile uses semantic versions, with the core, Redis and messaging packages
released together. Before 1.0, minor releases may include breaking changes;
patch releases contain compatible fixes. Earlier CalVer snapshots were private
pilot artifacts, not published GitHub releases.

## [0.1.0] - 2026-09-13

First GitHub release, distributed as installable package archives under the MIT
license. This release remains experimental.

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
- This is not a complete Bottleneck facade. Packages are distributed through
  GitHub release assets and are not yet published to npm.

[0.1.0]: https://github.com/semaphile/semaphile/releases/tag/v0.1.0
