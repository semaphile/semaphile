# SEM-2 Gate evidence

All eight gates are satisfied for the messaging-only 0.3.0 candidate.
Final package, fixture and portable-archive source is `800c8c53b8548250da6bf4a684bf796f1e9e1a73`.
Receipts and completion commits change only goal records. Raw output lives at
`/Users/openclaw/src/divideby0/semaphile/.scratch/docs/receipts/`;
`sem-2-redis-messaging-release.md` pastes the final command output.
No quality gate was waived.

## Gate 1 — Extraction and exclusions

- Command: `python3 goals/SEM-2-redis-messaging-release/results/verify-source.py`; `git diff 3ec254e..800c8c53b8548250da6bf4a684bf796f1e9e1a73`; `git grep -n -i -E 'proxy|http-policy' -- packages conformance tools docs SPEC.md README.md CHANGELOG.md package.json`.
- Exit code: 0 (the inventory has expected, dispositioned matches).
- Headline: 5/5 static assertions; four export maps/locks checked; all 17 shared-ancestor commits dispositioned; no proxy package, public core policy export, CLI command or runner route.
- Timestamp: 2026-09-23T23:54:11.135041+00:00.
- Tested commit: `800c8c53b8548250da6bf4a684bf796f1e9e1a73`.
- Evidence: EXTRACTION.md, CONTRACT.md, private sem-2-completion-static-audit.log and sem-2-completion-proxy-inventory.log. Third-party version/resolved/integrity triples are unchanged against pinned main.

## Gate 2 — Contract, docs and exports

- Command: static audit above; `npm run check:docs`; exact installed-consumer commands under gate 6.
- Exit code: 0.
- Headline: SPEC section 20 matches pinned feature byte for byte; 18 public Markdown documents pass; four installed export/peer maps verified, including negative core/http-policy and core/http-policy.js imports.
- Timestamp: 2026-09-23T23:53:57.339274+00:00 (quality command batch start).
- Tested commit: `800c8c53b8548250da6bf4a684bf796f1e9e1a73`.
- Evidence: CONTRACT.md maps every DECIDED clause to tests or source inspection. Deployment/release docs disclose one OS account per host and link the separate-account debt via issue 2. TLS option forwarding is inspected; no new certificate-deployment claim is made.

## Gate 3 — Deployment and ACL boundary

- Command: `node conformance/run.mjs redis` and `bun conformance/run.mjs redis` on both native hosts; includes messaging-acl.mjs.
- Exit code: 0 for all four invocations.
- Headline: 7/7 ACL groups per pairing within 167/167 Redis cases: independently configured restricted users exchange; no local coordination; denied outside keys/channels; warn/strict readiness; computed-key and notification permission; definitive EVAL/TIME ACCESS and restoration without reconnecting established sockets.
- Timestamp: 2026-09-23T23:53:45.590957+00:00 (macOS Node Redis start; each log carries its own time).
- Tested commit: `800c8c53b8548250da6bf4a684bf796f1e9e1a73`.
- Identity: Darwin arm64 uid 502, Node 22.21.1 / Bun 1.4.2; Linux x64 uid 1000, Node 22.23.0 / Bun 1.4.2; Redis 8.4.0 on both.
- Evidence: private sem-2-completion-{macos,linux}/{node,bun}-redis.log. Separate OS users, homes and private-file isolation remain unverified, as explicitly agreed.

## Gate 4 — Source and cross-host regressions

- Command: `node conformance/run.mjs <suite>` and Bun equivalent for each suite below on both hosts; `PATH=$NODE22_BIN:$PATH python3 -u $PRIMARY/.scratch/run-sem2-crosshost.py`.
- Exit code: 0 for all retained/final source invocations and the cross-host harness.
- Headline: 630/630 reported scenarios per pairing; 2520/2520 source total; cross-host 6/6. Counts sum RESULT lines and exclude auxiliary PASS-only assertions.
- Timestamp: 2026-09-23T23:53:12.521525+00:00 (final macOS matrix start; per-invocation times are in raw logs).
- Tested commit: `800c8c53b8548250da6bf4a684bf796f1e9e1a73` for messaging, Redis, administration, OTel and cross-host. Core retains `ce00f9b9c40da52f72988295d578264582e7f55a` evidence.
- Ancestry: `git diff ce00f9b..800c8c53b8548250da6bf4a684bf796f1e9e1a73 -- packages/core` is empty. Core source, native digests/binaries and every extracted package file are unchanged. The newly packed core archive has a different compressed-byte hash; the new exact set is independently tested under gate 6.
- Evidence: private sem-2-completion-{macos,linux}/ full logs/status; sem-2-final-{macos,linux}/ core logs; sem-2-completion-linux-matrix.log; sem-2-completion-crosshost.log; sem-2-core-payload-equivalence.log (69 identical extracted core files).

| Suite | macOS Node | macOS Bun | Linux Node | Linux Bun |
| --- | ---: | ---: | ---: | ---: |
| messaging | 110/110 | 110/110 | 110/110 | 110/110 |
| redis | 167/167 | 167/167 | 167/167 | 167/167 |
| core | 292/292 | 292/292 | 292/292 | 292/292 |
| administration | 14/14 | 14/14 | 14/14 | 14/14 |
| otel | 47/47 | 47/47 | 47/47 | 47/47 |

Cross-host covers four runtime combinations, acknowledged AOF send across an
actual Redis restart, and an existing waiter reconnecting across a restart.
The shared topics timeout case freezes the wall clock; both backends pass.
Fault coverage includes explicit uncertain-listener restart and a stale local
subscription snapshot kept alive by a peer. Synthetic upgrade rollback/crash
cases remain; the real archived 0.2.0 installed-CLI upgrade is under gate 6.
Historical 1050/1050 is not counted.

Superseded failed receipts are preserved: Linux Node at 1421359 and 59127e4
exposed earlier fault clients reconnecting into later cases, fixed in 25e3158.
The 2a78f00 Linux Node run exposed caller-timer expiry before a wall-clock
comparison, fixed in 800c8c5. A focused old-build run reproduced the stale
snapshot bug after a build failed from omitted CARGO_HOME; the corrected build
and final matrix pass. None of these failed runs is counted green.

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
- Exit code: 0 for the formula and each repository check.
- Headline: typecheck passed; fast.configured=true and fast.ok=true; packages/, conformance/, tools/ have zero warnings/errors; deep.state=passed with zero in-diff findings.
- Timestamp: 2026-09-23T23:54:41.296Z (formula); repository batch began 2026-09-23T23:53:57.339274+00:00.
- Tested commit: `800c8c53b8548250da6bf4a684bf796f1e9e1a73`.
- Evidence: lint/receipt.json, lint/sonar-evidence.json, private sem-2-completion-quality.log and sem-2-completion-lint.log.
- Supported toolkit revision: 6f0303703e00d7b9029396fb0eda69a1f8304d97. Existing oxlint command adapters; no private toolkit dependency in public npm lint.
- Effective Sonar scope: packages, matching tracked properties/local settings; four package tsconfigs and recorded exclusions for dist, dependencies, tests/conformance and goal records. Host/auth remain machine-local. Scanner 8.0.1.6346, server 26.2.0.119303.
- Disclosure: project dashboard ERROR and 71 outside-diff issues remain. Both review scans passed with zero in-diff issues. No waiver or coverage claim. The 2910e5a scan found one catch-binding rule, fixed in 2a78f00; the earlier d9 scan was invalidated by source movement and is diagnostic. Final 800c8c5 evidence supersedes both.
- Authorship is verified and final lint eligibility passes at the checked source; both are checked again at the receipts head before lock. Later changes remain goal-record-only.

## Gate 6 — One exact portable archive set

- Command: `npm run build` on both native hosts; `node packages/core/assemble-native.mjs .tmp/sem2-linux-native`; copy the verified Linux pair to messaging; `npm pack --ignore-scripts --json --pack-destination $CANDIDATE_DIR` once per package; `SEMAPHILE_CANDIDATE_DIR=$CANDIDATE_DIR SEMAPHILE_020_MESSAGING_ARCHIVE=$OLD_ARCHIVE SEMAPHILE_TESTED_COMMIT=$TESTED_COMMIT node conformance/release/candidate.mjs` and Bun equivalent on both hosts.
- Exit code: 0 for all four exact-archive runs.
- Headline: 5/5 installed groups per pairing, 20/20 total; four hashes asserted equal before/after each run; metadata/license/README/privacy audit 4/4.
- Timestamp: 2026-09-23T23:59:22.846728+00:00 (first exact-archive run; others carry their own times).
- Tested commit: `800c8c53b8548250da6bf4a684bf796f1e9e1a73`, both package source and fixture.
- Durable directory: `/Users/openclaw/src/divideby0/semaphile/releases/candidates/redis-messaging/0.3.0/800c8c53b8548250da6bf4a684bf796f1e9e1a73/`.
- Evidence: ARTIFACTS.json, durable release.json/SHA256SUMS, private sem-2-completion-archive-{macos,linux}.log and sem-2-completion-archive-audit.log; native build logs under sem-2-completion-{macos,linux}/build.log.
- Real 0.2.0 archive SHA-256: 600200f3c20612d789189be55ca0b16089cd9a1d5346f740a6932bcb79d2bb20. Its 1.1 store upgrades explicitly to 1.2 through the installed candidate CLI; pending content, trace, dedupe and a prior receipt survive.
- Native-free fault isolation removes core/messaging native and SQLite implementation files only from installed copies. The same four archives remain unchanged across both hosts/runtimes.
- Both native targets have verified source/binary identities. All four versions and Semaphile peers are exactly 0.3.0; no install hook compiles native code. Historical checkpoint archives and the earlier ce00f9b/59127e4 candidates are preserved.

## Gate 7 — Fresh blind review

- Command: `evie-kit goals review --goal SEM-2 --purpose verification --verifying '<bounded fix/evidence scope>'`; independent `codex exec --sandbox read-only` review of the last 13 commits at b928d06.
- Exit code: 0 for all agreed engines and the separate Codex review; reconciliation passed.
- Headline: results-004 had 20 consolidated items; results-005 has 10 minor/nit items, no blocker/major, all dispositioned. CodeRabbit had no new findings; Codex had no actionable findings; Sonar had zero in-diff findings.
- Timestamp: 2026-09-23T23:27:05.102Z (verification wave start).
- Reviewed commit: b928d062412f. Accepted closing corrections through `800c8c53b8548250da6bf4a684bf796f1e9e1a73` were verified by focused regressions, the full affected source matrix, quality formula and new exact archives above. Two fresh Codex reviews ran; this smaller verification set did not trigger the stop/split clause.
- Evidence: reviews/results-005/INDEX.md, earlier results-004/INDEX.md, primary private reviews/sem-2-codex-2.md and sem-2-results-005/ raw reports. GATES was committed before both waves. The retrospective is refreshed and checked before lock.

## Gate 8 — Action boundary

- Status: verified by the reviewed diff and execution record; no mechanical test can prove every absent action.
- Evidence: RESULT.md and final diff. No npm publication, protected merge, proxy product, Sentinel, harness adapter or range registry was added/performed. Refused supervisor probes were not retried. Only the goal branch is pushed at lock.
- Candidate handoff: the orchestrator lands the branch; the owner confirms final source/archive identity, optional-core install behavior and known excluded observer fixes before publication. Separate OS-account debt remains linked and unverified.

The reported conformance total is 2546/2546: 2520 source scenarios, six
cross-host cases and 20 installed groups. Static and quality checks are separate.
