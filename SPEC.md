# Semaphile — implementation contract

## Approved increments (2026-09-12)

The owner approved the following implementation contract, extending the earlier
increments below. Rust ownership, memory storage, recovery, execution, HTTP and
maintenance now pass conformance on macOS/Linux under Node/Bun. Current scenario
counts and verification boundaries are documented in docs/testing.md.

### In-process storage (ENGINEERING)

The explicit `@semaphile/core/memory` entry point accepts a nonempty pool key
and the same complete normalized limiter config. A versioned runtime registry
shares pools across duplicate module graphs in one JavaScript runtime. It retains
configuration, budgets and refill phase across last-client close/reopen until
runtime exit, preventing close from silently granting fresh credits. This has no
filesystem/native imports and does not coordinate separate workers/processes.
Use only computed eligibility timers for queued work; idle pools have no timers.
This adds no on-disk format. Memory implements the same recovery/maintenance rules.

### Execution and administration API (ENGINEERING)

`execute(callback, options)` is separate from single-attempt `schedule`. Each
execution accepts one durable operation before queueing attempts. Per-attempt
context includes its operation ID, one-based attempt number, frozen admission,
and a fresh AbortSignal. Retry requires `retrySafety: 'safe'` plus a classifier
whose ID matches the normalized policy/version. Explicit per-operation policy
overrides may change retry settings, deadlines and classifier ID, never shared
admission or breaker settings. Unclassified work reports neutral outcomes.

An overall or attempt timeout rejects the caller and signals cancellation. Such
timeouts are terminal to arbitrary callback execution; never start a replacement
while its actual completion is unknown. Retain the lease and operation accounting
until callback settlement, subject to explicit lease expiry. Late callback success
after cancellation/timeout cannot establish recovery. Queue deadlines apply to
each admission attempt, with initial acceptance included in the first deadline.
Default close stops queued/delayed retries and waits active callback cleanup;
drain close permits the whole accepted execution to finish.

`maintenance.status/drain/wait/acknowledge/resume` expose persisted control state.
Drain/resume/acknowledge return bounded receipts, while status/wait return full
snapshots. A wait timeout or local close cancels only that wait. Client close joins
its outstanding administrative calls before detaching shared backend ownership.

### HTTP and pool CLI (ENGINEERING)

`http.fetch(input, options)` delivers a managed Response at headers, retaining the
execution through EOF or actual body cancellation. `http.request(input, handler,
options)` additionally retains it through handler completion and cancels unread
body data afterwards. RequestInit fields live in options.request. Safe replay
requires a supported copied static body or bodyFactory(attempt); streamed Request
bodies require a factory. Built-in policy ID is semaphile.http/1. Preserve known
response throttling/guidance through body failure; a cancelled unfinished success
is neutral. Observe source EOF/errors without eagerly buffering the body.

`semaphile pool status|drain|wait|acknowledge|resume` selects a named configured
SQLite pool, an existing explicit SQLite directory, or Redis plus a full expected
policy. Redis uses atomic existing-only open. Named policy cannot be silently
overridden by --pool-config; reject that combination. Validate complete command
inputs before opening and redact JSON input excerpts from parse diagnostics.
Startup retains default OS termination for blocked native gate waits; after open,
signals cancel administrative waits and close the local client. No command kills
producer processes. Mutations/waits require the current drain generation.

### Rust ownership (ENGINEERING)

Replace the C adapter with Rust/napi-rs v3, with OS primitives separated from
JavaScript bindings. Rust owns locks, subscriptions, watches and cancellation
handles; JavaScript receives opaque objects, not descriptor numbers. Dedicated
native wait threads retain their resources until return. Close cancels and joins
before destroying resources; environment cleanup follows the same ordering.
SQLite stays in the TypeScript coordinator worker. Scoped gate operations remain
synchronous. Preserve all notification, owner-verification and no-polling rules.
This changes no storage format or public scheduling/messaging contract. Builds
use pinned Rust 1.93.1 and locked dependencies; no install-time compilation.
This ownership design supersedes earlier sections' numeric descriptor transport
and JavaScript wait-worker mechanism while retaining their coordination rules.

### Resilience and maintenance (DECIDED)

Add matching admission/recovery behavior to SQLite, Redis and an explicit,
native-free in-process backend. Preserve single-attempt schedule and client-local
close. Add queue deadlines and a bounded execution helper. Defaults: three total
attempts, 500 ms doubling to 10 seconds with +/-20% bounded jitter, five-minute
overall deadline and sixty-second attempt timeout. Values are configurable.
Automatic replay requires explicit safety and transient classification. No
concurrency lease is held during retry delay. Every attempt spends its budget.
Cancellation cannot force an arbitrary callback to stop.

Shared cooldown honors provider retry guidance as a minimum even beyond the
exponential cap. Attempt/generation fencing prevents duplicate effects, per-batch
exponential escalation and stale success resetting newer recovery state.
Circuit breaking is opt-in: default five consecutive service failures, or an
explicit percentage/window/minimum-sample rule. Open circuits wait by default,
with per-call fail-fast. Default recovery pauses are thirty seconds doubling to
five minutes. Only one valid probe exists per pool; probes still consume normal
admission budgets. Cancelled, lost and expired probes cannot prove recovery.

Provide generic outcome classification and scoped HTTP request plus returned
Response methods. HTTP defaults classify 429 as throttling, 500/502/503/504 and
recognized transport failures as service failures. Do not classify cancellation
or application-processing defects as service failures. Retry-After supports
delay-seconds and HTTP-date. Replaying bodies requires reproducibility. No
automatic replay after delivering a response to application code. Keep capacity
through body/callback completion or actual cancellation, subject to existing
explicit lease-expiration semantics.

Canonical config fingerprints supplement full normalized configuration equality.
Custom classifiers require a policy/version identifier; matching an identifier
does not prove identical callback code. Per-operation overrides are explicit.

Persist an atomic drain acceptance boundary and lightweight operation identities,
not callbacks/payloads. New work fails with PoolDrainingError; accepted work may
finish including retries. Notify clients without polling. Expiry is not proof of
remote completion: lost unfinished operations remain unconfirmed. Acknowledging
uncertainty never turns it into proven completion. Drain persists until explicit
resume; an administrative wait timing out does not resume. Expose library and CLI
inspection, drain, acknowledgement and resume. In-process administration is local.

These persisted additions use SQLite limiter formatMinor 4 and Redis state version
2; messaging format stays unchanged. No migration tooling or existing-consumer
compatibility is required. Document stopping all producers, draining/closing all
clients, and switching to a new directory or backing up the entire closed pool
before reuse. Fresh storage does not imply fresh provider credits. Defer credit
discovery/recovery tools, request history, adaptive concurrency, fallback/caching,
and downstream application integration until these milestones are verified. Never publish packages.

Current status: experimental TypeScript client with SQLite and optional Redis
backends and an in-process backend. SQLite format is `semaphile-sqlite-poc/1.4`;
Redis state format is `2`. SQLite now persists
recovery/maintenance control records. Public execution, HTTP and administrative
APIs are implemented and verified on both platforms and runtimes.
The current shared client has callback scheduling, weighted concurrency,
admission spacing, reservoirs, expiration, cancellation and close/drain support.

This specification records successive increments. Sections 1–7 describe the
initial SQLite proof; later sections amend and extend that baseline. In
particular, sections 8–10 add the client/package/runtime, 11–13 add policies and
admission context, 14 adds portable artifacts, and 15 adds Redis and the shared
native-free client module. Section 16 adds independent SQLite messaging,
listener handlers and the CLI. Statements about deferral or older formats in an
earlier increment describe that increment, not the current feature set.
The public exports now include the core main entry point, `./memory` and `./client`
as allowed by section 15 and the approved increments; messaging has its own
package and format under section 16.

Read [architecture](docs/architecture.md) for a current implementation walkthrough
and [design decisions](docs/design-decisions.md) for its rationale. Historical
product proposals do not extend the implemented contract.

## 1. Approved requirements (DECIDED)

- **D3, amended:** one directory per pool, containing standard SQLite state
  and library-managed companion files. Independent pools use independent
  databases and coordination locks. No exactly-one-file requirement.
- **D7, amended:** SQLite transactions are authoritative for logical state;
  OS locks/events provide serialization, wakeups and crash detection. SQL
  rows need explicit reclaim; kernel process exit does not delete them.
- Same-machine local files, ordinary users, macOS and Linux; no daemon,
  helper process or periodic polling. Test stores stay under repo `.tmp/`.
- Wake when any relevant capacity becomes available. Requests run outside
  transactions and coordination locks. A failed acquire consumes nothing.
- Expiration reclaims a lease even if its owner remains alive. Late or
  duplicate release cannot affect a replacement lease. Expiration limits
  valid reservations; it cannot stop an already-sent remote request.
- Create-or-validate compares the complete supported normalized config and
  fails on mismatch. This retains the owner's earlier decision, superseding
  the historical draft's warning-and-adopt behavior.

## 2. Bounded deliverable

Two TypeScript participant processes each submit ten jobs immediately to
one pool with capacity five. A separate test harness controls the fixture
processes and asserts results; it never owns leases or coordinates the
participants' admissions. Native waits run in a thread within each process.
No external SDK/HTTP request is required for this experiment.

Other cases cover any-holder release, queued cancellation, owner death,
expiration with a live owner, late/duplicate release, full-config mismatch,
idle waiting and writer death around notification/transaction boundaries.

Production packaging, rate budgets/spacing/backoff, optional history, other
backends, multi-language clients and a Bottleneck facade are deferred.
No production fairness or power-loss durability claim is made by the PoC.

## 3. Experimental format (ENGINEERING)

Format identifier: `semaphile-sqlite-poc`, formatMajor=1, formatMinor=4.
The minor is bumped from the historical draft's 1.0 as required by the
working agreement. The distinct identifier prevents interpreting old
binary stores as SQLite pools; no migration is supplied or promised.

Each fresh pool contains state.sqlite, coordination.lock, notify and
owners/<random-owner-id>.lock, plus SQLite's own transient journal files.
SQLite rollback journal (DELETE), synchronous FULL, busy_timeout=0.
All database access, including connection open/close, follows the pool's
short exclusive flock. Unexpected SQLITE_BUSY is an error, never a retry.

Tables store exact config, owner identities, unique lease IDs with optional
expiration, and an experimental ordered trace for test assertions. Trace
and owner-file retention are unbounded only in these isolated short tests;
they are not the optional production request ledger or retention policy.

Minor4 adds a singleton JSON control record for shared recovery and maintenance.
An accepted operation has an owner and fenced identity; its attempt bindings
outlive concurrency expiration until actual completion or owner abandonment.
Low-level single-attempt acquisitions create implicit operations automatically.
Outcome reporting, operation completion and lease release share one transaction.
Recovery policy is included in full normalized configuration equality. Existing
stores are rejected: stop producers, drain/resolve uncertainty, close clients,
then use a fresh directory or back up the entire closed pool. Never infer fresh
provider credits from a fresh pool.

## 4. Notification and reclaim protocol (ENGINEERING)

1. Take the pool coordination lock. Register a new stable-file notification
   subscription before the final state check. Inspect current lease owners.
2. Each owner holds its own unique lifetime-file flock until graceful close
   or process death. Only that owner can register that file. Other clients
   probe it nonblocking under the pool gate; an unlocked owner is dead.
   Files/identities are never reused or unlinked during the proof.
3. For a locked owner, register a process-exit event, then probe the lifetime
   lock again. If it became free, reclaim. If still held and subscription
   failed, fail explicitly. A numeric PID alone never authorizes reclaim.
   No forked children or transferred lifetime descriptors are supported.
4. Reclaim dead/expired leases and atomically test capacity. Any mutation
   first writes notify while holding the gate, then changes SQL in a
   transaction. Release the gate only after commit or rollback.
5. If denied, retain the registered subscription and wait for a file event,
   process exit, cancellation or the nearest computed expiration deadline.
   The OS event remains pending across the transition into the wait thread.
   Upon wake, close that subscription and repeat the authoritative check.
6. Read-only failed admission publishes nothing, so idle waiters cannot
   repeatedly wake one another. Events are hints, never capacity tokens.

Death after notification but before commit wakes readers which block on
the same gate and then recover SQLite. Death before notification makes no
mutation; an existing owner-death watch covers abandoned held leases.
Registration failures, watch invalidation and overflow fail explicitly.

## 5. Descriptor and thread discipline (ENGINEERING)

Native descriptors are close-on-exec. Gate and lifetime locks use separate
open file descriptions; SQLite never opens either file. One Pool instance
per participant per test, with synchronous short critical sections on its
main thread. No asynchronous job/callback runs under the gate. A suspended
live gate holder can stall coordination; job expiration cannot revoke it.

A dedicated Node worker thread blocks on one event descriptor. Cancellation
writes a private pipe; only after the worker acknowledges return may the
main thread close its descriptors. Thread termination is never used to
interrupt a live native wait. Production asynchronous gate acquisition and
multiple Pool instances in one process remain separate obligations.

## 6. Clock and test boundaries

PoC lease deadlines use Date.now milliseconds with computed waits. Tests
assume no wall-clock adjustment or reboot. The production clock/reboot
contract remains open. Crash fixtures kill only harness-owned processes;
their stop-at-boundary hooks are test instrumentation, absent from normal
operations unless explicitly selected by the fixture.

## 7. Completion

Run applicable tests on macOS and Linux, paste exact receipts, perform up
to two independent review rounds and disposition findings. Do not claim
full product conformance from the bounded cases. Record commit metadata when available and source hashes otherwise.

## 8. Node TypeScript client lifecycle increment

### Agreed behavior (DECIDED)

- `close()` stops submissions, rejects queued work and waits for running
  callbacks and their lease releases. `close({ drain: true })` instead
  finishes the client's previously queued work as well.
- Both forms affect only that client. Repeated calls return the same
  promise; the first call chooses the drain behavior. Closing may wait
  indefinitely for a hung callback or unavailable coordination gate.
- A callback runs in its caller's JS runtime, after lease admission, and
  releases its lease on success or failure. Queued cancellation must never
  start the callback; cancellation after it starts does not pretend to
  abort an arbitrary SDK call or release its lease early.

### Implementation scope (ENGINEERING)

`packages/core` supplies a reusable Node >=22.18 client with `openLimiter`,
`schedule`, `inspect` and `close`. All SQLite/coordination operations run
in an internal worker; the application's event loop never synchronously
waits for the coordination gate. Same canonical pool path in one JS
runtime shares a coordinator, with a protocol-versioned global registry
and full config validation. Distinct Node worker runtimes may use separate
coordinators and remain cooperating participants; do not claim one worker
per entire OS process or share JS callbacks across runtimes.

Acquire cancellations retain command bookkeeping until a possibly late
admission is released. Last-client close awaits outstanding commands and
backend cleanup before shutting down the internal worker. New opens must
not attach to a closing coordinator. Public users never receive native
file descriptors or internal Worker objects.

The reviewed SQL state and format 1.1 are retained; no schema migration.
The implementation is a library integration increment, not a declaration
that all production obligations are solved. Explicit developer build,
no install hooks or runtime dependencies. Section 9 adds build-only tooling.
Packaging prebuilt binaries, forced
termination of internal worker threads, reboot/clock handling, retention,
uncooperative filesystem writers and other rate-policy modes remain open.
Graceful lifecycle is supported; arbitrary external termination of internal
threads is outside this increment. Backend errors reject operations and
prevent future admissions; uncertain release failures surface as errors.

## 9. Type-checked package increment (ENGINEERING)

Owner approved strict source checking, generated declarations and an
independent consumer test on 2026-09-08. Replace Node's type stripping and
the handwritten declaration with a pinned TypeScript compiler and Node22
type definitions as development dependencies. This engineering change
makes the source authoritative for the exported API types and makes type
errors fail the explicit developer build. It changes no DECIDED behavior,
SQL format, runtime dependency or native-install policy.

Use strict NodeNext checking without skipping declaration checks; generate
JavaScript and declarations together with noEmitOnError. Build into staging
before replacing output, so a type error preserves the previous build.
The ESM package exports only its public entry point. Native compilation
remains explicit and produces a binary for the local build platform.

Conformance packs and installs the built archive locally without registry
access or install hooks. A separate consumer compiles against the exported
declarations, verifies generic inference and invalid calls, and exercises
the installed workers, capacity wakeup and shutdown. Run existing lifecycle
and backend cases because the JavaScript generation pipeline changed.
Production distribution and forced internal-worker cleanup remain deferred.

## 10. Modern Bun verification increment (ENGINEERING)

Owner accepted support for modern Bun versions on 2026-09-08 rather than
requiring Bun 1.2.23. Verify Bun 1.4.2 on macOS arm64 and Linux x64 as the
first concrete runtime target alongside Node. Use the existing node:sqlite,
Node-API addon and worker protocol; this changes no DECIDED behavior or
experimental format. Retain the explicit Node-based developer build and
platform-specific native binary. There is no legacy bun:sqlite adapter.

Run lifecycle, installed-package and backend crash conformance under Bun,
plus backend cases with alternating Node/Bun fixture participants. Assert
package export rejection using each runtime's resolver error code. A tested
version establishes evidence for that version, not an untested future range.
Forced internal-worker termination, rate policies and production packaging
remain separate obligations. Bun support does not establish compatibility
with every external rate-limit adapter or all Bottleneck features.

## 11. Shared admission spacing (ENGINEERING)

Under the owner's autonomous-completion authorization, add minTime to the
complete normalized pool config: integer milliseconds0..2147483647,
default0. Store format1.2 adds a singleton timing row with nextAllowedAt.
Reject previous formats transactionally; use fresh pool directories, never
silently migrate or delete existing ones. Sections8–10 describe the prior
format1.1 increments, which this section supersedes for newly built clients.

An admission requires both available concurrency and now >= nextAllowedAt.
In the same transaction as the unique lease, set nextAllowedAt=now+minTime.
All processes observe this shared state under the existing gate. Release,
expiration and crash reclaim do not refund spacing. A denied admission
does not consume a future slot. Wait on a computed spacing/expiry deadline
or existing kernel events; no periodic timer or polling is introduced.
Spacing applies to reservations, not actual network dispatch after a
suspended caller resumes. Existing wall-clock/no-reboot test boundaries
remain until the production clock increment explicitly replaces them.

## 12. Shared weighted capacity and request budgets (ENGINEERING)

Under autonomous completion, format1.3 adds positive integer weight to each
lease and a budget singleton (remaining, nextRefreshAt). Old formats are
rejected; fresh directories remain required. Config adds reservoir (initial
nonnegative integer or null for unlimited), reservoirRefreshAmount
(nonnegative integer or null), and reservoirRefreshInterval (positive
milliseconds up to MAX_TIMER or null). Refresh amount/interval must be
specified together. maxConcurrent may now be null for unlimited capacity.
All fields are normalized and compared, including explicit defaults.

schedule weight defaults1 and consumes that many concurrency units and
reservoir tokens in the admission transaction. A weight above a finite
concurrency cap rejects before entering the queue. Failure, release,
expiration and owner death return concurrency units but never refund spent
tokens. An application can explicitly increment the reservoir, including
negative adjustments. Integer overflow rejects without poisoning the pool.
An explicit increment on unlimited/null starts a finite balance at delta.

Refresh resets the balance to the configured amount on fixed boundaries
anchored at pool creation. Missed intervals do not accumulate tokens. Reads,
admissions and increments materialize due refresh under the gate; a waiting
job uses a computed refill timer only when the next refill could admit its
weight. No idle refresh loop or background timer exists. A null initial
reservoir is unlimited until a configured refill or explicit increment
sets a finite balance. Local FIFO is retained; no cross-process fairness
guarantee is introduced. inspect.active now counts occupied weight units;
leases still enumerate actual reservations and include their weight.

Unlimited capacity does not impose an admission cap. If occupied weight
plus a new weight cannot be represented as a safe integer, reject that
request with an accounting-overflow error while preserving the pool and
other jobs; never silently wait on a hidden cap. Refill checkpoints whose
balance is already equal to the reset amount need no write/notification;
compute their next boundary lazily from the retained creation-time phase.

## 13. Per-request expiration and admission context (ENGINEERING)

Keep format1.3. Add a schedule expirationMs override (null disables expiry;
omitted uses pool default), normalized before queueing. Persist the selected
deadline in the existing lease.expires column. Return readonly leaseId,
leaseGrantedAt, expiresAt and weight to the caller's callback; capture these
at atomic admission, not when the worker message reaches the application.
Freeze the delivered context and retain the release id privately.

Before invoking a callback, reject an already-expired admission with
LeaseExpiredError and clean up its lease. Running callbacks retain existing
lifecycle behavior: expiry reclaims reservations but does not abort arbitrary
SDK calls or force callback settlement. Transport adapters supply request abort
and local deadline handling. Cancellation before dispatch takes precedence
over starting work; late admission still releases exactly once.
Registry/protocol version advances independently of unchanged disk format.

## 14. Explicit portable pilot artifacts (ENGINEERING)

Keep format1.3 and protocolv4. Place explicitly compiled Node-API binaries
at dist/native/<platform>-<arch>.node and select the current platform and
architecture at runtime. The explicit build writes a companion manifest
with native source SHA-256, binary SHA-256 and target. Assembly verifies
those fields against the current source and checks the ELF/Mach-O header
for the actual target before adding another platform.
A pilot archive may contain both tested macOS arm64 and Linux x64 binaries;
it needs no compiler or install hook on the consuming host. Unsupported or
missing targets fail with a clear error. This changes packaging only.

Builds clear prior native artifacts to avoid accidentally distributing stale
code. Assemble after building, then test the identical archive on each host
under Node and Bun. This is private pilot distribution, not publishing or a
promise for untested OS/architecture combinations.

## 15. Optional Redis backend (approved recovery; ENGINEERING)

The owner requested Redis next and approved automatic ownership recovery on
2026-09-09. Section 1's local-file/no-daemon requirement continues to govern
SQLite. Redis is an explicitly selected alternative for processes on different
machines sharing one authoritative Redis endpoint; it requires Redis. The
SQLite format remains1.3. The Redis state format is independently versioned1.

### Recovery and lifecycle

An owner has a random generation and a renewable timeout, default30000ms,
configurable integer300..2147483647 and part of full config equality. Renew
at computed one-third-timeout deadlines. This is ownership renewal, never
periodic admission polling. At renewal, a bounded PING on the subscription
stream verifies that notification traffic is still arriving. Startup and every
command have independent response deadlines (the driver queue timeout alone
does not bound replies). This closes silent-connection gaps without admission
polling. Request expiration remains independent; null
means no request deadline, not permanent ownership after client death.
A renewal arriving after ownership expired must not revive that generation.
Expired/dead ownership reclaims its leases; running remote requests cannot
be stopped by Redis and may overlap newly admitted work. The owner accepted
this availability tradeoff. Clients must cooperate and preserve credentials.

Transport/subscription failure, command timeout or locally detected ownership
loss stops new admissions permanently for that client. No transparent reconnect,
command replay or local fallback. Callers explicitly reopen with a fresh owner.
A successful command whose reply is lost may have spent tokens; uncertainty
surfaces as an error, never an automatic refund. Running callbacks are still
awaited by close, and cleanup failures surface. Default close cancels queued
work; drain finishes accepted work unless the backend fails; first close wins.

### Authoritative operations and notifications

Use one versioned JSON state key per pool, addressed by a hash of explicit
namespace and pool id. A short Lua operation reads and validates state,
calculates in memory, and commits with one SET. Integer-valued mutable fields
are decimal strings in stored JSON to avoid Lua cjson's default14-digit output
rounding. Limits retain the existing JS safe-integer validation and overflow
behavior. Whole-state operations scan owners, leases and control records (accepted
operations, uncertainty and recovery samples), a bounded initial
implementation, not a throughput claim for massive pools.

A notification is published before the state SET inside the same script;
subscribers' authoritative checks cannot interleave the script. A failed SET
may cause a harmless wake, never partial authoritative state. Register the
subscription before opening/checking the pool and record a notification
version before each admission attempt; if it changes during that attempt,
recheck instead of sleeping. Wait on publication or the earliest computed
owner/request/spacing/refill deadline. Failed admission never publishes solely
for a check. Ownership renewals do not publish merely to extend a deadline.

Each owner sends ordered sequence numbers on its command connection. Assign
sequences at dispatch, giving due ownership renewals priority over queued
application commands while preserving application command order. Keep
one bounded last mutation reply and sequence per live owner: repeating the last
sequence returns its prior mutation result; read-only inspections are recomputed
instead of caching a full lease snapshot per owner. Administrative mutations
return a bounded receipt containing the configuration fingerprint and maintenance
counts/status; retrieve full recovery and operation details with a separate status
inspection. This preserves exact mutation replay without retaining one full ledger
per owner. Older sequences reject instead of mutating again. New owners
are registered once with fresh random identities; failed registration is not
retried. Expired owners and completed leases are pruned on work/inspection/open access;
ownership renewal only extends the owner deadline. There is no
unbounded trace or permanent operation ledger in this Redis increment.

Shared admission uses Redis TIME. Public grant/expiration timestamps use that
server clock. Before dispatch, use a monotonic local bound derived from request
send time and the server's remaining validity; do not compare another host's
wall clock to Redis timestamps. Renewal also uses a conservative local bound.
Arbitrary server clock changes, Redis eviction/state loss, replica promotion,
Cluster/Sentinel and strict cap guarantees across such failures are excluded.
No existing connection silently recreates missing state.

### Policies, packaging and verification

Preserve the core's weighted concurrency, minTime, fixed-phase reservoir reset,
manual increments, per-job expiration, cancellation and error identity. Compare
the full normalized policy and ownership timeout when opening an existing pool.
Callbacks remain in the caller's runtime and never run inside a Redis script.

The optional Redis package must not load SQLite or a native addon. A shared
scheduling/lifecycle module may be extracted from core, preserving its API and
all SQLite conformance. Test the coordination primitive first, then the public
API on Node and Bun, on macOS and Linux, and with clients on both hosts sharing
an isolated Redis instance. Add lost reply/subscription, stale sequence,
partition/live-owner, renewal and clock-skew cases. Record exact receipts and
fresh blind reviews per increment. No package publication is authorized.

## 16. SQLite messaging increment (DECIDED, 2026-09-12)

Implement @semaphile/messaging as a TypeScript library and `semaphile message`
CLI. A common directory may contain independent pools/<name>/ and messaging/
stores, each with its own gate and database. Pool formats and mismatch rules
remain unchanged. Section 20 adds Redis messaging and durable topics. Runtime-specific adapters,
live reconfiguration and cross-store transactions remain deferred.

### Delivery and presence

Explicitly created mailbox names are durable and unique within a store.
Replacement sessions inherit pending deliveries. Registration is optional
presence held by a unique lifetime lock; it does not own claims. Unknown
direct recipients fail. Broadcast atomically snapshots online names and
creates every delivery or none; zero recipients fails. Committed deduplicated
sends retain their recipient snapshot. Dedupe keys are store-scoped and
conflicting reuse fails. Receive oldest currently deliverable messages first;
processing/completion order across receivers is not promised.

Stable message/delivery identities differ from fresh per-attempt claim
receipts. Only an unexpired current receipt may ack, release or renew; stale
operations cannot affect replacements. Duplicate successful ack is idempotent.
Claims survive command exit and session death. At-least-once eligibility ends
at expiry or retry exhaustion; external effects can repeat. Ack means durable
consumer acceptance, not task completion. Default claim lifetime: five minutes.
Standalone wait prints a delivery and receipt and exits without releasing it.

Listeners and CLI command handlers default to ack on success; manual mode
requires explicit ack. Senders may request either mode; receivers declare
accepted modes. Incompatibility fails the delivery before invoking a handler.
Consumers can deduplicate handoff using the stable delivery identity.
Listeners renew on computed deadlines while handlers run, up to a finite
configurable maximum (default one hour per attempt), never beyond message
expiry or after claim expiry. Claim loss signals cooperative cancellation;
external effects may continue. Manual handler return stops renewal. Default
listener concurrency is one (local, not a global guarantee). Close stops new
claims and awaits handlers with bounded renewal, without draining the mailbox.

Default retry budget is five attempts. Handler failure and claim expiry share
persisted attempt counts and exponential retry deadlines starting at one
second. Exhaustion is retained as failed. Explicit retry resets the budget
and records an event. Expired messages require a new send.

### Configuration and retention

Shared settings are fixed at creation. Every messaging client compares full
normalized expectations: configMismatch=warn (default) reports differences
and adopts persisted settings; error rejects before registration or logical
mutations. This policy is client-local. Invalid input always fails. Limiter
mismatches continue to fail fast.

CLI --store overrides nearest semaphile.json discovery from cwd upward; stop
at the first file, never skip invalid/incomplete files. Relative paths resolve
against the file. Explicit client/listener options override file defaults.
Library open takes an explicit path; a helper supplies discovery. Init creates
config and missing stores resumably without overwriting conflicts or changing
persisted settings. Info reports paths, formats, expected/persisted settings
and differences without participant registration or logical mutations.

Terminal history defaults to seven days, with earlier eviction for size.
Pending delivery state/bodies are protected. Compact dedupe records survive
while pending and seven days after all deliveries become terminal, independently
of history eviction. Defaults: maxBodyBytes=1 MiB, maxPendingPerRecipient=1000,
maxMessages=10000, maxEvents=100000, maxContentBytes=128 MiB accounted logical
content (not physical file size). Refuse new sends when protected data fills
capacity; cleanup/ack must remain possible. Bound cleanup and paginate history.
Consumer events support topic labels without topic subscriptions.

### Implementation and verification (ENGINEERING)

Messaging format is distinct from pool formats. Section 17 advances the
initial 1.0 format to 1.1 through an explicit offline upgrade: add a nullable
messages.trace column in the same FULL transaction as the format update.
Trace bytes count toward content retention and expire with the envelope. Reuse private
native machinery at build time, with no descriptor exports or install-time
compilation. Retain rollback journal, synchronous FULL and busy_timeout=0.
All database access takes a short exclusive gate on a worker. Arm inbox
watches before final checks; notify affected inboxes before mutations and
hold the gate through commit/rollback. Empty read-only checks never publish.
Wait only on kernel events, cancellation or computed deadlines. Handlers run
outside locks. Names map to opaque filesystem identities; stable coordination
files are retained. CLI commands receive a JSON envelope on stdin and use
explicit executable/argument arrays without implicit shell interpolation.
Presence wrappers/handlers are explicit consumer commands, not infrastructure
daemons. Existing clock/reboot/power-loss limitations remain explicit.

Prove two-process handoff, process crashes, stale receipts, renewal/retry limits,
atomic broadcasts and dedupe, retention pressure, idle waits, cancellation,
responsive event loops, config precedence and warning/error modes, handler
lifecycle, CLI, strict consumer types and offline/public-only artifacts on
macOS/Linux under Node and modern Bun. Retain limiter regressions, exact private
receipts and fresh reviews per increment. No publication is authorized.

Messaging logical accounting reserves 8 KiB per pending delivery for later claim
and error fields. Terminal rows count their bounded error text and metadata;
mailbox/session metadata and event fields also count. Account once per mutation
batch. Capacity cleanup may continue in bounded batches only after actual
progress, yielding the gate between batches; idle refusals never retry. This
engineering detail preserves terminal cleanup at capacity without weakening
retention or delivery properties. Observational explicit-store info reports
absent expectations explicitly; supplied or project expectations are normalized.

Engineering clarification from messaging review: positive wait deadlines include
RPC and gate delay and are checked before claiming; zero performs one inspection.
A renewal response may observe an already acknowledged retained receipt as `acked`
without renewing or mutating it. This prevents false claim-loss cancellation after
another process durably accepts a manual delivery; no expired claim is revived.
CLI termination signals request active-child cancellation with five-second
SIGTERM-to-SIGKILL escalation; library close remains graceful by default.

## 17. Observability (DECIDED)

Instrumentation is optional and client-local: it never changes normalized pool
policy, admission, callback results, or cleanup guarantees. SQLite, Redis and
memory clients expose typed lifecycle events and optional OpenTelemetry adapters.
Capture submission context and restore it for callbacks. Distinguish caller
settlement, callback settlement, lease release and final operation cleanup.
Observers are bounded, failure-isolated and never awaited under a gate or lease.
Telemetry is lossy observation, not a durable request ledger. Bodies, arbitrary
headers, credentials and raw exception messages are not captured by default.
Identifiers may correlate spans, but never become unbounded metric dimensions.

The optional @semaphile/otel package supplies library adapters and a standalone
CLI SDK/exporter entry point. Applications own their SDK. Standalone CLI telemetry
is explicitly enabled, preserves stdout and operation exit results, and flushes
within a bounded shutdown deadline. Initially support OTLP HTTP/protobuf, traces
and metrics. Propagate W3C trace context; baggage requires an explicit allowlist
(empty by default), on both extraction and injection, with bounded size.

### Shared collector

`semaphile telemetry collect` is an explicitly managed monitoring process, never
started automatically by limiter clients. Discover all pools within configured
local roots and Redis namespaces by default. Repeated --pool and --include
selectors form a union; --exclude always wins. Glob matching is case-sensitive.
--watch-pools defaults on; --no-watch-pools freezes initial identities. External
collectors cannot discover memory pools. Discovery never creates limiter pools.
Serve /metrics and /healthz at 127.0.0.1:9464 by default; --host/--port override.
Optional OTLP exporting samples every 15 seconds by default. Telemetry config is
client-local; CLI overrides project defaults, credentials use environment names.

Collectors register per canonical pool, including overlapping collectors. Warn
on partial or complete ownership conflicts, identifying pools and collectors.
Default startup rejects conflicts and releases partial acquisitions. Later
conflicts warn and skip pools. --allow-overlap explicitly permits duplicate
collection without evicting existing collectors; warn about duplicate metrics.
Warn on ownership changes, not every scrape, and expose conflicts in health.
Local registrations use lifetime locks and serialized registration checks;
Redis registrations use token-checked renewable leases. Lost registration stops
collection and invalidates cached measurements. Registration recovery does not
promise exactly-once exporting or stronger Redis failover guarantees.

Monitoring alone may sample on scrapes and OTLP export cycles. This is the owner-
approved exception to the no-polling rule: bound and coalesce sampling/discovery;
never introduce admission polling. Report sample age/errors, never convert failed
reads to zero. Shared effective lease occupancy is distinct from callbacks still
executing after lease expiry. Observation must not register request work.

Redis pool discovery metadata stores namespace and pool name without credentials,
atomically on new-client open in the existing pool hash slot. Preserve existing
pool keys and state. Validate metadata against live state; old pools become
discoverable on new-client open, or can be selected by explicit name. Cluster
discovery scans primaries in bounded batches, not KEYS.

### Messaging tracing

Messaging format semaphile-messaging/1.1 adds optional bounded trace metadata,
separate from application content and excluded from dedupe identity. A duplicate
send retains the first committed trace context. Account metadata within existing
content retention limits. Invalid automatically captured telemetry is dropped
with diagnostics, never a reason to reject otherwise valid work.

An explicit offline upgrade preserves pending messages, receipts, dedupe and
history. Ordinary open never migrates. Operators stop all clients; reject detected
live registrations, but do not claim these prove all old clients are absent.
Old messages have no synthesized sender context. Mixed 1.0/1.1 clients are not
supported. Send/receive/process/settlement instrumentation preserves correlation
across broadcasts and redelivery, with a processing span per attempt. Respect
ambient context using links. Handler subprocesses receive current delivery context
with stale inherited per-message context cleared. CLI exporting remains opt-in.

### Engineering and verification

Implement limiter events/adapters/collector before messaging propagation. Preserve
SQLite limiter format 1.4 and Redis state 2; discovery/collector metadata are
separate, versioned records. Validate optional instrumentation with no native
install-time compilation. Test Node and modern Bun on macOS/Linux; actual Redis
Cluster, collector contention/crashes/lease loss/overlap, bounded scrapes, OTLP and
Prometheus receivers, message context/dedupe/redelivery and interrupted upgrades.
Retain conformance, private raw receipts, fresh reviews and handoffs per milestone.
No publication, Evie source edits, dashboard, durable ledger, proxy, automatic
collector election/restart or OTLP logs are included in this increment.

Collector engineering: add a nonblocking native gate acquisition for observation
and collector registration. Busy gates produce a failed sample, not a blocking
wait or an admission retry loop. Keep all SQLite/native work on a worker thread.

## 20. Redis messaging and durable topics (DECIDED, 2026-09-14)

Owner approved implementation after interview. Redis messaging takes precedence
over the proposed secrets proxy. Redis is an alternative authoritative store,
not a SQLite mirror. Its runtime must load neither SQLite nor a native addon and
requires no local coordination files. One authenticated/TLS-capable endpoint is
supported; Cluster routing, Sentinel discovery and offline replication are deferred.
Retain the existing messaging delivery, retention, mismatch, tracing and receipt
contract, including acknowledgment as durable acceptance rather than completion.

### Redis connections and readiness

Add @semaphile/redis/messaging using a native-free shared messaging lifecycle.
Identify stores by database, namespace and store name. Recover connections and
resume waits automatically. Bound queued commands (default 1000) and operation
time (default 30 seconds). Reconnect with 500 ms exponential backoff capped at
10 seconds with bounded jitter. Never blindly replay dispatched mutations whose
reply was lost; report an explicit uncertain outcome. Validate persisted store
identity, format and settings after reconnect. Missing/replaced state is terminal,
never an invitation to recreate it. Prioritize renewal/cleanup over ordinary work.
Subscription-before-check and computed expiry timers replace periodic inbox polls.
Preserve confirmed claim deadlines across disconnection and signal cooperative
cancellation at expiry; an uncertain renewal cannot extend local ownership.
Presence is a separately renewable session, default 30 seconds.

Warn by default when persistence/eviction settings are unsafe or uninspectable;
optional strict startup rejects such settings. Strict requires AOF, always-flush,
flushing during rewrite, healthy persistence and noeviction. Never configure the
server automatically or equate this startup check with infrastructure durability.

### Durable topic subscriptions on both backends

Add named subscriptions with exact topic-name filters, inspection, listing,
removal, and publication. Each subscription owns an independent delivery queue;
workers sharing it compete for deliveries. Atomically snapshot subscriptions at
publication, with one delivery per matching subscription, or refuse the entire
publication (including zero matches/full target). New subscriptions receive only
future publications; existing subscriptions retain offline deliveries. Direct send
and descriptive topic metadata never implicitly publish. Dedupe retains the
original fanout snapshot. Existing message expiry, protected pending accounting,
claim fencing, history and retry bounds apply to subscription deliveries.

Subscriptions persist by default. Optional inactivity TTL retires temporary
subscriptions, cancels pending/claimed deliveries and records an event. Connected
listeners renew activity even while idle; publishing does not renew it. Retirement
invalidates claims and signals cooperative cancellation, without promising to stop
external effects. Recreating a name starts a new generation. Mutating existing
subscription policy is not implicit: require identical normalized creation options.

Advance SQLite messaging formatMinor to 2 (semaphile-messaging/1.2), with explicit
offline upgrade preserving all prior data and rollback on failure. Ordinary opens
never migrate. Limiter formats are unchanged. Redis has its own versioned format.

### Shared agent payloads and interfaces

Optional native-free versioned types/validators define question (required text,
nonempty unique options with required id and label, optional example), answer
(required selectedOptionId, optional notes), and turn-completed (required project,
run, turn identity and outcome; optional summary). Validate answers against their
question. Envelope fields carry correlation, reply destination, sender and expiry.
Runtime UI, workflow execution and universal harness adapters remain application
responsibilities. Question acceptance and a later correlated answer are distinct.

Redis CLI/config selectors are explicit and mutually exclusive with SQLite path
selectors. Credentials are environment references. Redis-only configuration must
not require or create local storage. Keep current SQLite API/discovery compatible.

### Verification (ENGINEERING)

Implement in independently reviewed increments: native-free client boundary;
Redis mailbox parity/recovery; subscriptions and SQLite upgrade; payloads/CLI/
telemetry/documentation. Use indexed Redis records and atomic Lua state transitions
with pre-write validation; no periodic polling. Run Node/Bun conformance on macOS
and Linux and cross-host real Redis, covering uncertainty, renewal loss, restart,
missing state, subscription fanout/expiry/capacity, dedupe, upgrade rollback and
native-free installed consumers. Preserve receipts, review dispositions and prior
limiter regressions. Publication and merging proxy branches are separate actions.
