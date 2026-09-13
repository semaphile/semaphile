# Contributing

Start with the [architecture](docs/architecture.md), then read the relevant
part of [SPEC.md](SPEC.md). The specification contains historical increments;
its introduction identifies the current contract and how later sections amend
older ones. A behavior change needs a spec decision before implementation.

## Setup

Use Node >=22.18 for builds, even when testing the runtime with Bun. Install
Rust 1.93.1 and a platform linker: macOS command-line developer tools, or a Linux
C toolchain. The napi-rs binding does not require Node header downloads.
Fetch pinned dependencies once before the offline explicit native build.

```sh
npm ci --ignore-scripts
npm ci --prefix packages/core --ignore-scripts
npm ci --prefix packages/redis --ignore-scripts
npm ci --prefix packages/otel --ignore-scripts
npm ci --prefix packages/messaging --ignore-scripts
cargo +1.93.1 fetch --locked --manifest-path packages/core/native/Cargo.toml
npm run build
```

The root package holds contributor tools; the three library packages have their
own lockfiles. There are no install-time compilation hooks. Redis has a pure
JavaScript runtime dependency; building core explicitly compiles our native
SQLite coordination addon. Build output goes into each package's `dist`.

## Make and verify a change

```sh
npm run format
npm run format:check
npm run check:docs
npm run build
npm run lint
npm run lint:types
npm run typecheck
npm run test:core
npm run test:redis
npm run test:messaging
npm run test:administration
```

Build before checking types across packages: Redis consumes the generated core
declarations, so changing core API types requires refreshing that build first.

Redis tests need `redis-server` on macOS or Docker on Linux. They start an
isolated Redis 8.4 server/container on a random loopback port. First-time npm
package-consumer tests also need cached Redis dependency metadata; see
[testing](docs/testing.md) for the explicit preparation command.

Run the applicable suites on macOS and Linux, and under Node and Bun, before
calling a runtime change complete. [Testing](docs/testing.md) explains the full
matrix, cross-host configuration and optional portable-archive checks.

## Coding conventions

- Use the pinned root Prettier for TypeScript, JavaScript, JSON and Markdown.
  Oxlint checks correctness, explicit braces and TypeScript conventions;
  type-aware lint supplements strict compiler checks.
- Give state changes and cleanup steps separate statements. Use explicit braces
  so nested cancellation and failure paths can be traced visually.
- Name internal timestamps for their clock and units. Preserve serialized field
  names unless an agreed format change explicitly allows renaming them.
- Explain invariants where they matter: who owns a descriptor, why a grant must
  be released after cancellation, and which clock a deadline uses. Avoid comments
  that merely restate an assignment.
- Prefer small helpers with a concrete purpose. Keep operation ordering visible;
  extra abstraction should reduce the context a reader must hold in mind.
- Write tests with visible setup, action and assertions. Exercise observable
  behavior and meaningful failure boundaries rather than mirroring implementation.

Rust lives under `packages/core/native`; the `os` crate isolates kernel resources
from JavaScript bindings. Use the pinned toolchain for formatting, lint and tests:

```sh
npm run check:rust
npm run test:rust
```

Lua uses two-space indentation, expanded control blocks and descriptive local
names. Keep validation, reclamation, admission and the final commit visibly
ordered. Prettier does not format Rust or Lua. Changing native source, including
formatting, changes its artifact hash; rebuild both targets before assembling
a new portable archive. Explicit builds remap the home, checkout and Cargo cache
prefixes in compiler-generated paths; the macOS library ID is also independent
of the build directory. Package checks reject embedded build-user home paths.
This does not sanitize arbitrary strings introduced by custom source or tooling.
Builds preserve explicit `RUSTFLAGS` or `CARGO_ENCODED_RUSTFLAGS`. If flags instead
come from Cargo config files or build/target environment settings, the build
refuses to silently override them: put the intended effective flags in one of
those explicit variables. Config files containing Unicode escapes also require
explicit flags, because inspection deliberately avoids interpreting escaped TOML
keys. Check this build boundary with
`node conformance/typescript/native-build-options.mjs`.

## Documentation and changes

Public documentation lives in `docs/`, root guides and package READMEs. Historical
session records stay outside the public tree. [Documentation policy](docs/publication.md)
explains the boundary. Keep links relative and examples free of machine-specific
paths, credentials or deployment addresses.

Use small changes and conventional commit subjects (`fix(core): ...`,
`docs: ...`). Preserve existing history, never commit credentials, and have
changes reviewed before declaring them complete. Package publication remains
an explicit maintainer action; none of the setup or test commands publishes.
