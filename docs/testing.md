# Testing

[Contributor setup](../CONTRIBUTING.md) installs the locked tools and explicitly
builds all packages. Tests use private directories under the checkout's `.tmp`
and clean up their own servers/processes. Run from the repository root as an
ordinary user.

## Local suites

```sh
npm run build
npm run test:core
npm run test:redis
npm run test:messaging
npm run test:administration
```

| Suite            | Scenarios | What it exercises                                                                      |
| ---------------- | --------- | -------------------------------------------------------------------------------------- |
| Core             | 276       | Native/SQLite/memory baseline 184, execution 36, HTTP 28 each on memory and SQLite     |
| Redis            | 111       | Atomic protocol/recovery/client/fault/package baseline 63, execution 20, HTTP 28       |
| Messaging        | 82        | Durable claims, retention, crash/claim fencing, listeners, CLI and installed consumers |
| Administration   | 14        | SQLite/Redis CLI drain, uncertainty, signal cleanup, config drift and input refusal    |
| Redis cross-host | 2         | Node/Bun host pairings sharing one Redis endpoint                                      |

The same 483 default scenarios pass on macOS arm64 and Linux x64 under Node and
Bun. The Rust OS crate separately passes 12 tests on each platform; formatting
and Clippy use Rust 1.93.1. Cross-host checks are additional to the local totals.

The Redis recovery increment has additional local model checks:

```sh
node conformance/redis/backend-order.mjs
node conformance/redis/control-model.mjs
```

The first runs seven protocol/queue/lifecycle cases with controlled command replies. The
second requires Lua 5.4 (`SEMAPHILE_LUA_BIN` overrides its executable) and runs 14
cases against the actual composed Lua source using deterministic Redis-command
substitutes. Neither opens a network connection or proves live Redis atomicity,
Pub/Sub delivery or cross-host behavior. The model is separate from the default
suite so contributors running Redis do not also need standalone Lua. Live Redis
recovery is independently covered by the default suite.

The Redis harness starts `redis-server` locally on macOS or a
`redis:8.4.0-alpine` Docker container on Linux. Pre-pull that image if Docker
cannot reach the registry during testing. Native binary compilation uses pinned
Rust 1.93.1 and a platform linker. Fetch Cargo dependencies with the committed
lockfile before running the offline explicit build.

Redis's package-consumer test installs actual archives offline, without hooks.
A first-time npm cache may contain dependency tarballs but lack registry
metadata. Prepare its cache explicitly once while online:

```sh
npm install --prefix .tmp/redis-dependency-cache --ignore-scripts \
  --no-audit --no-fund @redis/client@6.2.1
```

The installed Redis consumer runs after all SQLite implementation files/native
binaries have been removed from its installed core dependency. That verifies
the Redis runtime only needs the shared client module.

## Node and Bun on both platforms

After the Node build, use Bun 1.4.2 to run the same suites:

```sh
bun conformance/run.mjs core
bun conformance/run.mjs redis
bun conformance/run.mjs messaging
bun conformance/run.mjs administration
```

Repeat on macOS arm64 and Linux x64. Tested Node versions are 26.7 on macOS
and 22.23 on Linux; the declared minimum is 22.18. A verified version does not
establish compatibility with every future version. To alternate Node/Bun
participants in SQLite's backend suite:

```sh
SEMAPHILE_TEST_PEER_EXEC_PATH=/absolute/path/to/bun \
  node conformance/typescript/backend-regression.mjs
```

## Native headers and portable archives

The default eight native-header tests generate minimal ELF/Mach-O structures
and mutate their bounds. These structures are not executable addons. Actual
compiler output is checked and loaded by package tests on its matching host.
This lets a fresh checkout run the complete default suite without a previously
assembled private archive.

For the additional real-header and identical-archive proof, build the same native
source on both platforms. Copy the other target's `.node` and `.json` files into
a staging directory, assemble, and pack as described in the
[core README](../packages/core/README.md). Set the resulting archive path when
running these checks on both hosts under both runtimes:

```sh
SEMAPHILE_TEST_ARCHIVE=/absolute/path/to/core.tgz \
  node conformance/typescript/native-headers.mjs
SEMAPHILE_TEST_ARCHIVE=/absolute/path/to/core.tgz \
  node conformance/typescript/package.mjs
```

Never package synthetic header fixtures as native artifacts. A source change,
including Rust sources, the Cargo lockfile or native build helper, invalidates old native manifests; rebuild before assembly.
For an identical Redis/core archive pair, pass `SEMAPHILE_CORE_ARCHIVE` and
`SEMAPHILE_REDIS_ARCHIVE` to `conformance/redis/package.mjs`.

## Redis across hosts

The optional driver currently runs on macOS with a Linux SSH peer. Build the
same checkout on both hosts and make Node/Bun available. Configure your own
SSH destination, absolute remote checkout path, and Bun executables:

```sh
SEMAPHILE_TEST_SSH_HOST=user@your-linux-host \
SEMAPHILE_TEST_REMOTE_REPO=/absolute/path/to/semaphile \
SEMAPHILE_TEST_LOCAL_BUN=/absolute/path/to/bun \
SEMAPHILE_TEST_REMOTE_BUN=/absolute/path/to/bun \
  node conformance/redis/cross-host.mjs
```

The driver opens SSH reverse forwards bound to loopback for its isolated Redis
and HTTP fixture. Each pairing submits 20 requests; the test requires both hosts
to participate simultaneously and a shared peak of 5. A fixture barrier holds
the first batch until all five capacity slots are occupied; saturation does
not depend on a fixed network-response delay. It closes its tunnel and
fixtures afterwards. No deployment address is embedded in the test.

This tests clients sharing one real Redis instance. It does not test Redis
Cluster, Sentinel, replica promotion or failover guarantees.

## Coverage and review

`npm run --prefix packages/core coverage` captures Node V8 coverage across the
application and its workers and writes `.tmp/coverage/lcov.info`. A supplied
`SEMAPHILE_TEST_ARCHIVE` is used only for native-header fixtures; package tests
still pack the current build. Bun and the Rust primitives require separate evidence.
Review operation ordering, descriptor ownership, late cancellation, lost replies
and crash recovery in addition to test totals. Raw maintainer receipts and scan
exports are private records; contributors can reproduce the public commands.

## Messaging

The messaging suites cover durable handoff, broadcast, claim fencing, renewal,
retry exhaustion, retention and logical capacity, crash boundaries, native idle
waits, cancellation, listeners, CLI/configuration, strict consumer types and
installed artifacts. `review-regressions.mjs` exercises failure cases found by
independent review. No agent runtime or external message service is contacted.
The command-handler fixtures execute only their own test children.

Messaging uses the core native implementation and pure pool normalizer as
build inputs. Build core before messaging. Pool administration tests also require Redis. Installed messaging-only consumers
need no core runtime dependency. Initializing named limiter pools through
`semaphile init` requires the optional matching core package.

After building messaging, copy the assembled core `dist/native/` contents into
`packages/messaging/dist/native/`; both packages use the same native source.
Then pack messaging explicitly. To verify that exact archive on another host:

```sh
SEMAPHILE_MESSAGING_ARCHIVE=/absolute/path/to/messaging.tgz \
  node conformance/messaging/package.mjs
```

Repeat with Bun. An ordinary rebuild replaces native artifacts with the current
host's target, so assemble both targets again before packing a portable archive.
