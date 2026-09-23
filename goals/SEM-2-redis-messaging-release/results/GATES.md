# SEM-2 Gate evidence

Receipts follow GOAL.md gate order. Package and archive source is
`59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9`. Fixture-only commit `25e315859b8e54f598d86353ebfe9df8fe309689`
closes each fault case's clients, avoiding interference between reconnect tests.
It changes no package bytes. Raw command output and status records are retained at
`/Users/openclaw/src/divideby0/semaphile/.scratch/docs/receipts/`.
Each gate identifies its tested commit; unchanged suites retain their prior
receipts with the source-equivalence checks described under gate 4.

## Gate 1 — Extraction and exclusions

- Command: `python3 goals/SEM-2-redis-messaging-release/results/verify-source.py`; `git diff 3ec254e..25e315859b8e54f598d86353ebfe9df8fe309689`; `git grep -n -i -E 'proxy|http-policy' -- packages conformance tools docs SPEC.md README.md CHANGELOG.md package.json`.
- Exit code: 0 (audit and diff; inventory has expected matches).
- Headline: 5/5 static assertions; four export maps and locks verified; all 17 shared-ancestor commits dispositioned; no proxy package/CLI/runner route.
- Timestamp: 2026-09-23T23:22:31.461063+00:00
- Tested commit: 25e315859b8e54f598d86353ebfe9df8fe309689 (audit script recorded with these receipts; assertions inspect that product tree).
- Evidence: EXTRACTION.md and CONTRACT.md; private sem-2-isolated-static-audit.log and sem-2-isolated-proxy-inventory.log.

## Gate 2 — Contract, docs and exports

- Command: `python3 goals/SEM-2-redis-messaging-release/results/verify-source.py`; `npm run check:docs`; installed archive command under gate 6.
- Exit code: 0.
- Headline: section 20 matches the pinned feature byte for byte; 18 public Markdown files pass; all four installed exports/peers validated.
- Timestamp: 2026-09-23T23:23:01.340Z
- Tested commit: 25e315859b8e54f598d86353ebfe9df8fe309689 (audit and documentation subject unchanged by later receipts).
- Evidence: CONTRACT.md maps every DECIDED clause to tests or explicit source inspection; no new TLS certificate-deployment claim. docs/redis-messaging.md discloses one OS account per host; separate-account/private-file evidence remains deferred in references/deferred-os-account-validation.md.

## Gate 3 — Deployment and ACL boundary

- Command: `node conformance/run.mjs redis`; `bun conformance/run.mjs redis` on both native hosts. The runner includes `conformance/redis/messaging-acl.mjs`.
- Exit code: 0 for all four invocations.
- Headline: all six ACL cases passed per pairing, within the 164/164 Redis count: independent configs/distinct restricted credentials; no local files; out-of-scope key/publish/subscribe denial; warn/strict inspection; computed keys; notification permission.
- Timestamp: 2026-09-23T23:21:51.304453+00:00 (Linux Node start; other invocation times are in each log)
- Tested commit: 25e315859b8e54f598d86353ebfe9df8fe309689.
- Identity: Darwin arm64 uid 502, Node 22.21.1 and Bun 1.4.2; Linux x64 uid 1000, Node 22.23.0 and Bun 1.4.2; Redis 8.4.0 on both.
- Evidence: private sem-2-isolated-macos/{node,bun}-redis.log and sem-2-isolated-linux/{node,bun}-redis.log. These prove a single unprivileged OS account per host, not separate homes or OS-user isolation.

## Gate 4 — Source and cross-host regressions

- Command: `node conformance/run.mjs <suite>` and `bun conformance/run.mjs <suite>` for each suite below on both hosts; `PATH=$NODE22_BIN:$PATH python3 -u $PRIMARY/.scratch/run-sem2-crosshost.py`.
- Exit code: 0 for all 20 source invocations and cross-host harness.
- Headline: 627/627 reported scenarios per platform/runtime pairing, 2508/2508 total; cross-host 6/6. Counts sum RESULT lines; auxiliary PASS-only assertions also execute but are not added.
- Timestamp: 2026-09-23T23:21:51.304453+00:00 (Linux Node start; other invocation times are in each log)
- Tested commits: core `ce00f9b9c40da52f72988295d578264582e7f55a`; messaging/administration `1421359191e7932e3e8eddd2e8f37599b4a0feb8`; OTel/cross-host `59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9`; Redis `25e315859b8e54f598d86353ebfe9df8fe309689`.
- Evidence: private sem-2-final-{macos,linux}/ core logs; sem-2-reviewed-{macos,linux}/ messaging/administration logs; sem-2-nominated-{macos,linux}/ OTel logs; sem-2-isolated-{macos,linux}/ Redis logs; sem-2-nominated-crosshost.log. Every included invocation exits 0.
- Ancestry checks: `git diff ce00f9b..HEAD -- packages/core` and `git diff 1421359..HEAD -- packages/messaging conformance/messaging conformance/administration` both produce no changes. Core package source and its archive hash are unchanged. Redis changes after 1421359 were exercised by the newer Redis and OTel runs. After 59127e4 only fault-case cleanup changed; package, cross-host and exact-archive subjects are unchanged.
- Superseded attempts: Linux Node runs at 1421359 and 59127e4 failed the new subscription-outage fixture because earlier clients remained open and reconnected into subsequent cases. Isolated diagnostic and per-case cleanup established the interference; 25e3158 fixes the fixture. Failed logs remain retained and are not counted green.

| Suite | macOS Node | macOS Bun | Linux Node | Linux Bun |
| --- | ---: | ---: | ---: | ---: |
| messaging | 110/110 | 110/110 | 110/110 | 110/110 |
| redis | 164/164 | 164/164 | 164/164 | 164/164 |
| core | 292/292 | 292/292 | 292/292 | 292/292 |
| administration | 14/14 | 14/14 | 14/14 | 14/14 |
| otel | 47/47 | 47/47 | 47/47 | 47/47 |

Cross-host cases are all four Node/Bun sender/relay combinations, acknowledged
AOF send across an actual Redis restart, and an existing waiter reconnecting
across an actual restart. The harness uses the isolated final Linux source.
Synthetic upgrade rollback/crash cases remain in the messaging suite; the real
0.2.0 installed-CLI case is in gate 6. Historical 1050/1050 is not counted.

### Retained runner inventory

- otel: native-gate, lifecycle, local-observer, http-lifecycle, adapter, exporter, collector, collector-faults, redis-observer, redis-timeout, cli, cluster, messaging, messaging-cli, package.
- core: native-binding, telemetry, recovery, recovery-backend, maintenance-state, queue-deadlines, execution, http, http-sqlite, memory, memory-recovery, artifacts, native-headers, admission, budgets, min-time, test, package, backend-regression.
- redis: messaging-acl, messaging, messaging-topics, messaging-faults, messaging-cli, messaging-otel, messaging-package, backend-order, primitive, recovery, execution, http, client, faults, startup-race, package.
- administration: pool-cli.
- messaging: shared-client, agent-messages, topics, upgrade, trace-store, telemetry, primitive, retention, review-regressions, client-regressions, faults, listener, cli, package.

Each listed file is run by conformance/run.mjs; helper modules are imported by
those cases. The new exact-archive fixture is additional to this inventory.

## Gate 5 — Quality formula

- Command: `bun node_modules/@evie-kit/cli/src/evie-kit.ts lint gate`; `npm run typecheck`; `npm run lint`; `npm run lint:types`; `npm run format:check`; `npm run check:docs`.
- Exit code: 0 for the repository checks; final formula receipt under results/lint/.
- Headline: typecheck and fast roots packages/, conformance/, tools/ pass with no errors/warnings. Receipt requires configured=true, ok=true and deep.state=passed.
- Timestamp: 2026-09-23T23:23:01.340Z (repository checks); formula timestamp is in lint/receipt.json.
- Tested commit: 25e315859b8e54f598d86353ebfe9df8fe309689; product source 59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9 unchanged.
- Evidence: lint/receipt.json, lint/sonar-evidence.json; private sem-2-isolated-quality.log and sem-2-isolated-lint.log.
- Supported tool source: evie-kit 6f0303703e00d7b9029396fb0eda69a1f8304d97; existing oxlint command adapter, no new root package dependency.
- Effective Sonar scope: sources packages (tracked properties and machine-local settings agree); exclusions node_modules, dist, target, test files, conformance fixtures and goal records as spelled in receipt. Four package tsconfigs; server/auth remain machine-local. Scanner 8.0.1.6346, server 26.2.0.119303.
- Disclosure: zero in-diff open issues satisfies the configured goal formula. There are 71 outside-diff open issues and the project dashboard quality gate is ERROR. No coverage claim is made; the stale LCOV input was removed. No waiver was requested or granted. Final lint eligibility remains required at lock.

## Gate 6 — One exact portable archive set

- Command: build with `npm run build` on both native hosts; `node packages/core/assemble-native.mjs .tmp/sem2-linux-native`; copy verified Linux native pair to messaging; `npm pack --ignore-scripts --json --pack-destination $CANDIDATE_DIR` once per package; `SEMAPHILE_CANDIDATE_DIR=$CANDIDATE_DIR SEMAPHILE_020_MESSAGING_ARCHIVE=$OLD_ARCHIVE SEMAPHILE_TESTED_COMMIT=$TESTED_COMMIT node conformance/release/candidate.mjs` and Bun equivalent on both hosts.
- Exit code: 0 for all four archive invocations.
- Headline: 5/5 installed groups per pairing, 20/20 total; four hashes identical before/after each run; MIT/license/README/privacy/native identity audit 4/4.
- Timestamp: 2026-09-23T23:15:22.802301+00:00 (first exact-archive run; other run times are in each log)
- Tested commit: 59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9, both fixture and package source. Later fault cleanup does not touch this fixture or packages.
- Durable archive directory: `/Users/openclaw/src/divideby0/semaphile/releases/candidates/redis-messaging/0.3.0/59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9/`.
- Evidence: ARTIFACTS.json records package versions, exact paths, hashes and native source/binary identities; durable SHA256SUMS and release.json; private sem-2-nominated-archive-{macos,linux}.log and sem-2-nominated-archive-audit.log.
- Real 0.2.0 messaging archive SHA-256: `600200f3c20612d789189be55ca0b16089cd9a1d5346f740a6932bcb79d2bb20`. Installed 0.2.0 creates a 1.1 store; installed candidate CLI explicitly upgrades to 1.2; pending content, trace, dedupe and prior receipt survive.
- Installed copy isolation removes core, messaging native files and SQLite implementation files, then exercises Redis library and CLI. The archive set is not modified or repacked.
- Both core/messaging archives contain real Darwin arm64 and Linux x64 binaries with matching source digest. Version and every Semaphile peer are exactly 0.3.0. No install hook compiles native code.

## Gate 7 — Fresh blind review (WAIVER)

- Status: in-flight
- Evidence: reviews/results-004/INDEX.md and primary private reviews/sem-2-codex-1.md. Verification wave and fresh Codex verification remain pending.

## Gate 8 — Action boundary (WAIVER)

- Status: not mechanically runnable
- Evidence: final RESULT.md action record and reviewed diff; lock is not yet claimed.
