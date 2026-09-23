# SEM-2 Gate evidence

Receipts follow GOAL.md gate order. Product and archive source is
`ce00f9b9c40da52f72988295d578264582e7f55a`. Fixture-only commit `3dfbcf9526f47f015a4cab4d85e0026acae38dd5` corrects the installed-memory
import and compares preserved trace with its known input. It changes no package
bytes. Raw output is retained outside the disposable worktree at
`/Users/openclaw/src/divideby0/semaphile/.scratch/docs/receipts/`.

## Gate 1 — Extraction and exclusions

- Command: `python3 goals/SEM-2-redis-messaging-release/results/verify-source.py`; `git diff 3ec254e..3dfbcf9526f47f015a4cab4d85e0026acae38dd5`; tracked proxy-reference inventory command in CONTRACT.md.
- Exit code: 0 (audit and diff; inventory has expected matches).
- Headline: 5/5 static assertions; four export maps and locks verified; all 17 shared-ancestor commits dispositioned; no proxy package/CLI/runner route.
- Timestamp: 2026-09-23T22:42:17.858831+00:00
- Tested commit: 3dfbcf9526f47f015a4cab4d85e0026acae38dd5 (audit script recorded with these receipts; assertions inspect that product tree).
- Evidence: EXTRACTION.md and CONTRACT.md; private sem-2-static-audit.log and sem-2-proxy-inventory.log.

## Gate 2 — Contract, docs and exports

- Command: `python3 goals/SEM-2-redis-messaging-release/results/verify-source.py`; `npm run check:docs`; installed archive command under gate 6.
- Exit code: 0.
- Headline: section 20 matches the pinned feature byte for byte; 19 public Markdown files pass; all four installed exports/peers validated.
- Timestamp: 2026-09-23T22:41:30.447848+00:00
- Tested commit: 3dfbcf9526f47f015a4cab4d85e0026acae38dd5 (same fixture bytes as the checked working tree).
- Evidence: CONTRACT.md maps every DECIDED clause to tests or explicit source inspection; no new TLS certificate-deployment claim. docs/redis-messaging.md discloses one OS account per host; separate-account/private-file evidence remains deferred in references/deferred-os-account-validation.md.

## Gate 3 — Deployment and ACL boundary

- Command: `node conformance/run.mjs redis`; `bun conformance/run.mjs redis` on both native hosts. The runner includes `conformance/redis/messaging-acl.mjs`.
- Exit code: 0 for all four invocations.
- Headline: all six ACL cases passed per pairing, within the 157/157 Redis count: independent configs/distinct restricted credentials; no local files; out-of-scope key/publish/subscribe denial; warn/strict inspection; computed keys; notification permission.
- Timestamp: 2026-09-23T22:42:20.301607+00:00
- Tested commit: ce00f9b9c40da52f72988295d578264582e7f55a.
- Identity: Darwin arm64 uid 502, Node 22.21.1 and Bun 1.4.2; Linux x64 uid 1000, Node 22.23.0 and Bun 1.4.2; Redis 8.4.0 on both.
- Evidence: private sem-2-final-macos/{node,bun}-redis.log and sem-2-final-linux/{node,bun}-redis.log. These prove a single unprivileged OS account per host, not separate homes or OS-user isolation.

## Gate 4 — Source and cross-host regressions

- Command: `node conformance/run.mjs <suite>` and `bun conformance/run.mjs <suite>` for each suite below on both hosts; `PATH=$NODE22_BIN:$PATH python3 -u $PRIMARY/.scratch/run-sem2-crosshost.py`.
- Exit code: 0 for all 20 source invocations and cross-host harness.
- Headline: 619/619 reported scenarios per platform/runtime pairing, 2476/2476 total; cross-host 6/6. Counts sum RESULT lines; auxiliary PASS-only assertions also execute but are not added.
- Timestamp: 2026-09-23T22:42:20.301607+00:00
- Tested commit: ce00f9b9c40da52f72988295d578264582e7f55a.
- Evidence: private sem-2-final-macos/ and sem-2-final-linux/ full per-suite logs/status; sem-2-final-linux-matrix.log; sem-2-final-crosshost.log.

| Suite | macOS Node | macOS Bun | Linux Node | Linux Bun |
| --- | ---: | ---: | ---: | ---: |
| messaging | 109/109 | 109/109 | 109/109 | 109/109 |
| redis | 157/157 | 157/157 | 157/157 | 157/157 |
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
- Timestamp: 2026-09-23T22:41:30.447848+00:00 (repository checks); formula timestamp is in lint/receipt.json.
- Tested commit: 3dfbcf9526f47f015a4cab4d85e0026acae38dd5; product source ce00f9b9c40da52f72988295d578264582e7f55a unchanged.
- Evidence: lint/receipt.json, lint/sonar-evidence.json; private sem-2-quality-final.log and sem-2-lint-final.log.
- Supported tool source: evie-kit 6f0303703e00d7b9029396fb0eda69a1f8304d97; existing oxlint command adapter, no new root package dependency.
- Effective Sonar scope: sources packages (machine-local settings override); exclusions node_modules, dist, target, test files, conformance fixtures and goal records as spelled in receipt. Four package tsconfigs; server/auth remain machine-local. Scanner 8.0.1.6346, server 26.2.0.119303.
- Disclosure: zero in-diff open issues satisfies the configured goal formula. There are 71 outside-diff open issues and the project dashboard quality gate is ERROR. LCOV warnings mean this record makes no coverage claim. No waiver was requested or granted. Final lint eligibility remains required at lock.

## Gate 6 — One exact portable archive set

- Command: build with `npm run build` on both native hosts; `node packages/core/assemble-native.mjs .tmp/sem2-linux-native`; copy verified Linux native pair to messaging; `npm pack --ignore-scripts --json --pack-destination $CANDIDATE_DIR` once per package; `SEMAPHILE_CANDIDATE_DIR=$CANDIDATE_DIR SEMAPHILE_020_MESSAGING_ARCHIVE=$OLD_ARCHIVE SEMAPHILE_TESTED_COMMIT=$TESTED_COMMIT node conformance/release/candidate.mjs` and Bun equivalent on both hosts.
- Exit code: 0 for all four archive invocations.
- Headline: 5/5 installed groups per pairing, 20/20 total; four hashes identical before/after each run; MIT/license/README/privacy/native identity audit 4/4.
- Timestamp: 2026-09-23T22:44:53.395721+00:00
- Tested commit: 3dfbcf9526f47f015a4cab4d85e0026acae38dd5 for final fixture; archives built from ce00f9b9c40da52f72988295d578264582e7f55a.
- Durable archive directory: `/Users/openclaw/src/divideby0/semaphile/releases/candidates/redis-messaging/0.3.0/ce00f9b9c40da52f72988295d578264582e7f55a/`.
- Evidence: ARTIFACTS.json records package versions, exact paths, hashes and native source/binary identities; durable SHA256SUMS and release.json; private sem-2-archive-final-{macos,linux}.log and sem-2-archive-audit.log.
- Real 0.2.0 messaging archive SHA-256: `600200f3c20612d789189be55ca0b16089cd9a1d5346f740a6932bcb79d2bb20`. Installed 0.2.0 creates a 1.1 store; installed candidate CLI explicitly upgrades to 1.2; pending content, trace, dedupe and prior receipt survive.
- Installed copy isolation removes core, messaging native files and SQLite implementation files, then exercises Redis library and CLI. The archive set is not modified or repacked.
- Both core/messaging archives contain real Darwin arm64 and Linux x64 binaries with matching source digest. Version and every Semaphile peer are exactly 0.3.0. No install hook compiles native code.

## Gate 7 — Fresh blind review (WAIVER)

- Status: in-flight
- Evidence: reviews/results-004/INDEX.md and primary private reviews/sem-2-codex-1.md (to be produced).

## Gate 8 — Action boundary (WAIVER)

- Status: not mechanically runnable
- Evidence: final RESULT.md action record and reviewed diff; lock is not yet claimed.
