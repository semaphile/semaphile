# @semaphile/core — experimental TypeScript client

Version **0.1.0**. Install verified GitHub release archives as described in the
[release guide](https://github.com/semaphile/semaphile/blob/main/docs/releases.md). The native-free shared lifecycle at
`@semaphile/core/client`, used by the optional `@semaphile/redis` package.
The explicit `@semaphile/core/memory` entry point provides in-process limiting
without loading SQLite or a native addon. The main export remains the SQLite entry point. Current limiter storage is
format 1.4; older experimental stores are rejected.

Reusable TypeScript client built on the validated SQLite coordination
backend. It is an integration increment, not a production-ready release.
The package has no install hook and has no runtime dependencies.
The compiler and Node type definitions are pinned development dependencies.

Runtime verification targets Node >=22.18 and modern Bun, starting with
Bun 1.4.2 on macOS arm64 and Linux x64. Bun 1.2.23 lacks the node:sqlite
module used by this client and is unsupported. Build with Node using the
commands below, then run the resulting JavaScript with Node or Bun on the
matching native platform. No global runtime upgrade is performed by this
package. Evidence for a specific Bun version does not verify future versions.

## Use an installed package

Install a verified release archive as described in the release guide above, or
use `npm install @semaphile/core@0.1.0` once the version is available on npm.
Published archives include native addons; consumers do not need Rust or a linker.

```js
import { openLimiter } from '@semaphile/core';

const limiter = await openLimiter({
  path: './.tmp/service.pool',
  config: { maxConcurrent: 5, minTime: 100, expirationMs: 30_000 },
});

try {
  const result = await limiter.schedule(() => callYourService());
} finally {
  await limiter.close({ drain: true });
}
```

For contributors building from a source checkout, see
[Validation and contributor setup](#validation-and-contributor-setup) below.

The caller chooses a local, private pool directory. All users of that pool
must supply identical normalized configuration. maxConcurrent is a positive
integer or null for unlimited capacity; expirationMs is null/omitted for
no expiry or a positive integer.
minTime is an integer interval in milliseconds (default 0) between shared
admissions. All participants must agree on it. Release, expiration and
owner death do not refund this interval. It spaces lease admission; it
cannot control network dispatch after a caller is suspended.
The stored experimental format is semaphile-sqlite-poc/1.4. Previous pools
are rejected; use a fresh directory after stopping old clients. Existing
pool files are never deleted or migrated automatically.

schedule(task, { weight: 2 }) reserves two concurrency units and spends two
reservoir tokens. Weight defaults 1; weights exceeding a finite concurrency
cap reject immediately. reservoir defaults to null (unlimited), or supplies
an initial nonnegative integer balance. Optional reservoirRefreshAmount and
reservoirRefreshInterval must appear together; the interval is milliseconds.
Refill resets the balance at fixed intervals from creation and does not
accumulate missed windows. It is computed on access or a useful pending
admission deadline, with no background refresh loop. An initially unlimited
reservoir becomes finite if a configured refresh sets its balance.

currentReservoir() reads the shared balance. incrementReservoir(delta)
atomically adjusts it and wakes waiters; negative integer adjustments are
allowed, and adjusting a null balance starts from zero. Overflow rejects
without stopping a healthy pool. Completion, failure, expiration and crash
reclaim return concurrency units but do not refund spent tokens. inspect()
reports the current reservoir and active weight units; its lease list
includes each reservation's weight. Global fairness is not promised.
If occupied weight plus a new request cannot fit in a safe integer under
unlimited concurrency, that request rejects with an accounting-overflow
error; existing work and the pool remain usable.

Callbacks execute in their caller's JS runtime. SQL, lock acquisition,
release and inspection execute in a dedicated coordinator worker; native
notification waits use dedicated Rust threads. These are threads, not daemon or
helper processes. Idle waiters do not poll.

## Client lifecycle

The memory entry point has the same scheduling and lifecycle methods. Open it
with `{ key: 'service', config: { maxConcurrent: 5 } }`. Keys identify pools
within one JavaScript runtime; separate workers/processes do not share them.
The runtime retains each key's normalized configuration, remaining budget and
refill phase across all clients closing and reopening. Use stable service keys;
creating unbounded unique keys retains unbounded pool metadata until runtime exit.
Every reopen must match the full normalized config. Pending admissions use
computed eligibility timers; empty queues create no background refill timers.
Memory inspection has an empty trace because this backend records no history.

The callback receives a frozen Admission object: leaseId, leaseGrantedAt,
expiresAt (null for no expiry), and weight. Times describe the transaction
that granted capacity, even when delivery to the caller is delayed. Existing
zero-argument callbacks remain valid. schedule(task, { expirationMs }) can
override the pool's default for one request; null disables expiry for it.
If the lease has already expired when the callback would start, schedule
rejects with exported LeaseExpiredError and releases the reservation.
Expiration does not stop or settle an already-running callback; an SDK's
AbortSignal and application deadline still control the actual request.

- schedule(task, { signal }) queues a callback; the signal cancels only work
  that has not started. A late backend admission is released without running
  a cancelled callback. The library cannot abort an arbitrary running SDK
  call; pass your own signal to that SDK when appropriate.
- schedule(task, { queueTimeoutMs: 5_000 }) rejects with QueueTimeoutError if
  the callback has not started within five seconds of submission. The optional
  value is an integer from 1 through 2,147,483,647 milliseconds. It does not time
  out running callbacks. A late admission is released, and close still awaits
  that cleanup. Queue timeout does not prove that no budget was spent if an
  admission had already committed before its reply reached the client.
- A schedule promise resolves after both callback completion and lease
  release. Thrown/rejected callbacks release the lease and reject the promise.
- close() rejects queued work and awaits running callbacks and cleanup.
- close({ drain: true }) finishes all of that client's accepted work.
- Both stop new submissions immediately. The first close determines behavior;
  repeated calls return exactly the same promise. A callback must not await
  its own client's close, because close waits for that callback to finish.
- Closing one client does not close other clients or release their leases.
  Last-client close waits for backend teardown. New opens do not attach to a
  coordinator that has begun teardown.
- A hung callback or live suspended gate holder can prevent close/drain from
  completing. Keeping the application responsive is not a claim that native
  gate acquisition is forcibly interruptible.

Same-pool clients share a versioned global coordinator registry within one
JS runtime, keyed by canonical directory filesystem identity. Separate Node
worker runtimes have separate registries and can cooperate through the same
pool. There is no claim of one coordinator for the entire OS process.

## Execution and maintenance

All backends also provide `execute`, `http.request`, `http.fetch` and
`maintenance.status/drain/wait/acknowledge/resume`. These add bounded retries,
shared cooldown, optional circuit breaking and a persistent pool drain boundary.
`schedule` remains single-attempt. Automatic retries require explicit replay
safety and transient classification. See [the full API guide](https://github.com/semaphile/semaphile/blob/main/docs/resilience.md)
for defaults, examples, body lifetime, timeout semantics and format replacement.

## Validation and contributor setup

Source builds require Node >=22.18, Rust 1.93.1 and a platform linker. From the
repository root:

```sh
npm ci --prefix packages/core --ignore-scripts
cargo +1.93.1 fetch --locked --manifest-path packages/core/native/Cargo.toml
node --no-warnings packages/core/build.mjs
```

Fetch the pinned Cargo dependencies once while online; explicit builds use the
lockfile offline. The build emits JavaScript, generated declarations and an
own-source native module under `dist`. Strict TypeScript errors fail the build
before replacing previous output. The build downloads nothing and runs no
dependency install hooks. Use `npm run typecheck --prefix packages/core` to check
without emitting. Source-checkout examples can import from
`./packages/core/dist/src/index.js` instead of the installed package name.

After building, run the complete core suites with:

```sh
npm run test:core
# Or use the same built library under Bun:
bun conformance/run.mjs core
```

The suites cover native ownership, admission and budgets, recovery and maintenance,
queue deadlines, execution, HTTP on memory and SQLite, lifecycle and installed
package consumers. See the current counts in [testing](https://github.com/semaphile/semaphile/blob/main/docs/testing.md).
Native header tests use synthetic structures; package tests load the actual
native binary on the current host. Supplied portable archives additionally
verify real headers on both targets.
All required fixtures live under `conformance`; no private working files are needed.

For Node V8 coverage across application, coordinator workers:

```sh
npm run --prefix packages/core coverage
```

This builds and runs the suites, writing `.tmp/coverage/lcov.info`. It measures
Node JavaScript/TypeScript execution, not Rust native code or Bun/JSC coverage. See
[testing](https://github.com/semaphile/semaphile/blob/main/docs/testing.md) for the platform matrix and archive workflow.

## Remaining boundaries

Arbitrary forced termination of internal workers, clock changes/reboot, bounded
trace/owner-file retention, initialization recovery, filesystem classification
and untrusted directories remain unresolved. Do not delete/replace live pool
files or fork/transfer native descriptors. The exposed inspection trace is
experimental backend diagnostics, not a request ledger API.

A backend error stops new admissions and rejects pending ones while retaining
release and inspection paths for cleanup/diagnosis. Correcting an external cause
does not automatically resume it; close its clients before opening a fresh
coordinator. Worker transport failure rejects requests instead of queuing them
to a thread that has exited.

## Portable artifacts

The runtime loads `dist/native/<platform>-<arch>.node`. Builds create the local
target, clear stale native artifacts, and record source/binary SHA-256 manifests.
Build from identical source on both hosts, copy the other target's `.node` and
`.json` into a staging directory, then assemble and pack:

```sh
node packages/core/assemble-native.mjs path/to/other-host-artifacts
npm pack ./packages/core --ignore-scripts --pack-destination .tmp
```

Assembly checks hashes and ELF/Mach-O headers. These are consistency checks,
not signatures proving an untrusted binary safe. Use trusted builds. Installation
runs no compiler or install hook; missing targets fail explicitly. This is an
experimental artifact workflow, not package publication.

See [contributing](https://github.com/semaphile/semaphile/blob/main/CONTRIBUTING.md) for formatting, lint and type checks,
and [architecture](https://github.com/semaphile/semaphile/blob/main/docs/architecture.md) for callback/worker ownership.
