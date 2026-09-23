# Section 20 verification map

Product source: `ce00f9b9c40da52f72988295d578264582e7f55a`.
The static audit compares section 20 byte for byte with pinned feature
`5b565ac9bef4ff569ac0e21726947fec279323e6`. No DECIDED clause was changed.
The table groups adjacent clauses without removing any obligation. Source
inspection complements runtime cases for constants and explicit scope exclusions.
Full commands, runtime identities and raw receipt locations are in GATES.md.

| DECIDED clause | Test and inspection evidence |
| --- | --- |
| Redis authoritative alternative; no SQLite/native runtime or local coordination | redis/messaging-package.mjs and release/candidate.mjs remove implementation/native files from installed copies; redis/messaging-acl.mjs checks independent configs create no local files. |
| One authenticated/TLS-capable endpoint; Cluster/Sentinel/offline replication deferred | messaging-acl.mjs exercises authenticated URLs; redis/messaging.ts passes URL/socket TLS options to existing driver. Public docs retain single-endpoint scope; no new routing/discovery API or mirror exists. TLS option support is inspected, not a new certificate-deployment claim. |
| Existing delivery, retention, mismatch, tracing, receipts; ack means durable acceptance | redis/messaging.mjs direct delivery, fenced/idempotent ack, retry, broadcast and mismatch; messaging retention/review-regressions/trace-store suites; redis/messaging-otel.mjs. |
| Native-free shared lifecycle and database/namespace/store identity | messaging/shared-client.mjs late cancelled claim; redis/messaging-package.mjs installed imports; messaging.ts key construction and connection validation; fault missing-state case. |
| Automatic reconnect/wait resumption, bounded queue and operation time | redis/messaging-faults.mjs outage queue, silent dispatched reply, silent startup and idle-wait reconnect cases. messaging.ts/messaging-connection.ts retain defaults 1000, 30000 ms and 500 ms exponential backoff capped at 10000 ms with jitter. |
| No blind replay; explicit uncertain mutation outcome | messaging-faults.mjs lost-send reply plus explicit dedupe resolution; lost-claim reply; uncertain renewal and silent dispatched timeout. |
| Revalidate identity/format/settings; missing/replaced state terminal | messaging-faults.mjs missing-store refusal; connection.validate reads persisted identity/config after handshake and reconnect; Lua pre-write validation refuses mismatch. |
| Renewal/cleanup priority; subscribe-before-check; computed expiry instead of inbox polling | messaging-connection.ts priority queue/publish wake; messaging-sockets.ts handshake subscribes before admission; messaging-receiver.ts wait timing. Fault/client regressions cover queued cancellation, expiry cleanup and listener renewal. |
| Confirmed claim deadline survives disconnection; cancellation at expiry; uncertain renew cannot extend | messaging-faults.mjs lost claim, skewed clock, uncertain renewal and immediately lost renewal cases; shared-client listener/watchdog regression cases. |
| Separately renewable presence with 30-second default | messaging.ts/shared-client.ts presence defaults and register/heartbeat lifecycle; messaging primitive/listener and Redis independent-client/broadcast cases. |
| Warn by default for unsafe/uninspectable settings; strict all persistence/eviction predicates; no server reconfiguration/durability promise | messaging-readiness.ts inspects all five predicates; redis/messaging.mjs strict refusal; messaging-acl.mjs denied CONFIG/INFO warning versus strict refusal. Docs disclose startup-check limit; cross-host AOF restart is separate evidence. |
| Named exact-filter subscriptions: inspect/list/remove/publish and competing workers | messaging/topics.mjs shared unchanged across SQLite and redis/messaging-topics.mjs: future-only, exact filters, competing workers, inspection/removal. |
| Atomic fanout snapshot; one per match; all-or-nothing zero/full target | topics suite future-only/exact/dedupe and full fanout cases on both backends; Lua preflight before writes. |
| Future-only creation, offline retained delivery; send/topic metadata never publish; dedupe original snapshot | topics suite future-only/dedupe case and direct metadata case on both backends. |
| Existing expiry, protected pending capacity, fencing, history/retry bounds for subscriptions | topics capacity and stale-claim retirement cases on both; shared delivery lifecycle with messaging retention/review-regressions and Redis claim-expiry tests. |
| Persistent default; inactivity TTL retirement cancels pending/claimed and records event | topics retirement and inactivity cases on both; inspect/history state and retirement event transitions in topics.ts and messaging-actions.lua. |
| Idle connected listeners renew; publication does not; cooperative cancellation only; fresh generation on recreation | topics inactivity/idle waiter, graceful-close renewal, retirement and recreation cases on both; no claim of stopping external effects. |
| Existing policy requires identical normalized creation options | topics option-drift/duplicate-filter cases on both; normalized comparison in create-subscription implementations. |
| SQLite formatMinor 2 and explicit offline upgrade; preserve data/rollback; ordinary open no migration; limiter unchanged; Redis own format | messaging/upgrade.mjs retains synthetic rollback/interruption/idempotence/live-registration tests; release/candidate.mjs real archived 0.2.0 store through installed CLI preserves trace, dedupe, receipt, pending body. Static diff leaves limiter format unchanged. |
| Native-free question/answer/turn-completed validators and all required/optional fields; answer against question | messaging/agent-messages.mjs valid optional round trips, versions/missing/duplicate/unknown selections, completion identity and defensive copies; installed consumer declarations. |
| Envelope correlation/reply/sender/expiry; acceptance distinct from later answer; UI/workflow/harness application-owned | existing envelope contract and primitive/listener cases retained; CLI and cross-host participant exchange correlated answer; agent payload module contains no UI/workflow/harness adapter. |
| Explicit mutually exclusive Redis/SQLite selectors; environment credential references; Redis no local storage; SQLite discovery compatible | redis/messaging-cli.mjs selector rejection, explicit config/discovery/init and drift; messaging CLI/package regression suites; ACL independently configured subprocesses; installed native-free CLI. |

## Exports and dependency boundary

`verify-source.py` asserts all four export maps equal the pinned feature's maps
with `./http-policy` removed. It checks exact 0.3.0 Semaphile peers and unchanged
third-party version/resolved/integrity triples against pinned main. Installed
checks reject the proxy package and OTel http-policy import and reject proxy CLI
routing. Core's existing private http-policy implementation remains part of its
preexisting HTTP client; it is not the excluded public OTel/proxy feature.

## Proxy-reference inventory

The tracked product/spec/doc inventory was generated with
`git grep -n -i -E 'proxy|http-policy' -- packages conformance tools docs SPEC.md README.md CHANGELOG.md package.json`.
Its raw output is in the primary private receipt `sem-2-proxy-inventory.log`.

| Paths | Disposition |
| --- | --- |
| packages/core/src/http.ts and private http-policy.ts module | Existing main HTTP client implementation retained; no new public policy export. |
| conformance/redis/proxy.mjs, faults.mjs, messaging-faults.mjs; conformance/otel/redis-timeout.mjs | TCP fault injection owned by tests; not HTTP/MCP product proxies. |
| conformance/typescript/http.mjs and memory.mjs | Existing tests verify the private module is not exported. |
| conformance/typescript/package.mjs and conformance/redis/package.mjs | Existing forbidden-hostname/privacy vocabulary includes the word proxy. |
| conformance/release/candidate.mjs | Negative package/export/CLI assertions. |
| SPEC.md | Existing deferred/proposed proxy context and section 20 priority statement; proxy sections 18/19 absent. |
| CHANGELOG.md, docs/redis-messaging.md, docs/releases.md | Explicit exclusion and historical archive/pilot distinction; no supported proxy API promised. |
| Goal/review records and synced toolkit instructions | Lifecycle/history prose outside product packaging, retained for provenance. |

No packages/proxy or conformance/proxy directory exists. CLI and root runner have
no proxy branch. Package locks contain no @semaphile/proxy. Installed metadata
and command rejection provide evidence beyond a text search.

## Deployment scope and upgrade disclosure

Each host used one unprivileged OS account (macOS uid 502; Linux uid 1000), with
independent processes/configurations and distinct restricted Redis users. ACLs
scope the shared store's keys/channels; they do not isolate message fields among
participants. Separate OS accounts, separate homes and private-file isolation
remain unverified, as recorded in
[the debt record](../references/deferred-os-account-validation.md).
This limitation is also public in docs/redis-messaging.md and docs/releases.md.

Upgrade failure rollback is tested; successful upgrade downgrade is not promised.
Private 0.4.0 pilot replacement is documented separately from the real published
0.2.0 fixture. Historical checkpoint archives were not overwritten.
