# Review results-004

Blind multi-tool review wave for `SEM-2-redis-messaging-release` (2026-09-23T22:46:52.241Z).
Each reviewer ran as a labeled tab in the executing session's own herdr
workspace. Model/effort/summary/args columns record per-reviewer
provenance (summary = codex `model_reasoning_summary`, EVA-58);
`(default)` means nothing was passed and the harness kept its own default.
Per-tool output dirs are machine-local since EVA-59 (gitignored raw
dumps) — the FINDINGS.md links resolve only on the machine that ran the
wave, and only until the goal worktree is reaped; the committed record
is this INDEX and its merged findings, so reconcile BEFORE the record
outlives the raw output.

**ROSTER NARROWED** — this round ran with fewer engines than its configured baseline roster (claude-code, codex, sonarqube, coderabbit, fable): codex (excluded by the frontmatter engines override). A narrowed round is a recorded, visible act — never a silently shrunken gate.

Round purpose: **finding** — a defect-hunting round, counted against the results-round budget.

All reviewers completed.


| Tool | Outcome | Findings | Model | Effort | Summary | Args | Detail |
|---|---|---|---|---|---|---|---|
| claude-code | completed | [FINDINGS.md](claude-code/FINDINGS.md) | claude-opus-5-5 | high | (default) |  |  |
| sonarqube | completed | [FINDINGS.md](sonarqube/FINDINGS.md) | (default) | (default) | (default) |  |  |
| coderabbit | completed | [FINDINGS.md](coderabbit/FINDINGS.md) | (default) | (default) | (default) |  |  |
| fable | completed | [FINDINGS.md](fable/FINDINGS.md) | claude-fable-5-1 | high | (default) |  |  |
| codex | excluded | — | | | | | excluded by the frontmatter engines override — see the roster banner |

## Merged findings

Review head: `7cde84a645c30f9f4a53da3d30cea138862ac428`. Gate is **not yet
passed**: accepted fixes are committed in 1421359, d9a7dec and 59127e4. The updated
matrix and exact archives pass; a fresh verification wave remains required. This first finding round
has 20 consolidated items below. Raw engine findings and the separate fresh
Codex review are preserved under the primary checkout's private
`.scratch/docs/reviews/sem-2-results-004/` and `sem-2-codex-1.md`.

| # | Severity | Raised by | Finding | Disposition |
| --- | --- | --- | --- | --- |
| 1 | major | codex 1; fable 1; coderabbit wait finding | Wait and confirmed-claim recovery | Accepted. Pre-dispatch wait TIMEOUT blocks on connection wake/reconnect or caller deadline, then retries without replaying uncertain claims. Independent confirmed handlers and temporary subscription activity retain their own deadlines through transient errors. Concurrent outage and subscription-refresh regressions added; four-pairing Redis matrix passes after fixture isolation in 25e3158. |
| 2 | major | codex 2 | Retired subscription retry | Accepted. SQLite retry now checks subscription state and destination existence before restoring pending state. Failed → retired → recreated-generation test passes on SQLite and Redis. |
| 3 | major | codex 3 | Escaped terminal error accounting | Accepted. Redis terminal delivery accounting counts bounded UTF-8 error text rather than JSON escape overhead, preserving the specified 8 KiB reservation. NUL-filled 4096-byte error test passes at 20000-byte capacity. |
| 4 | major | fable 2; coderabbit event-index finding | Full event-index scan | Accepted. trimEvents checks staged count and fetches only oldest bounded batches when trimming is necessary. Retention ordering and Redis commandstats test verify info does not read the event range. Broader query optimization is not needed for this finding. |
| 5 | minor | claude-code 3 | Uncertain cleanup before admission | Accepted. Admission distinguishes uncertain cleanup from the undispatched mutation; failed pressure cleanup preserves the original definitive refusal. Lost-sweep reply regression passes. |
| 6 | minor | fable 3 | Corrupt metadata recovery | Accepted. Root type/metadata decoding is guarded and validated before execution; corrupt or replaced state returns terminal STATE_LOST. Wrong-type/malformed metadata regression passes. |
| 7 | minor | fable 4; claude-code 8 | Lua/ACL error classification | Accepted. Lua reply-table failures preserve permission/type classification; trim/preflight errors use the same structured envelope. ACL tests require NOPERM/ACCESS and directly prove computed-key denial; complete grants already pass the exchange. |
| 8 | minor | fable 5 | Old socket tears down reconnect | Accepted. EVAL failure tears down only the socket that issued it, preserving a newer reconnect. Existing lost-reply/reconnect tests remain in the matrix. |
| 9 | major | claude-code 1; fable 6 | Private toolkit lint dependency | Accepted. Public npm lint uses installed oxlint directly across all three roots. evie-kit remains a separate executor gate, with no private toolkit dependency in the contributor command. |
| 10 | major | claude-code 2/6; fable 8; coderabbit README/comparison/testing | Contradictory and historical docs | Accepted. Removed local-only/unimplemented contradictions and labeled feature-branch counts historical. Candidate runtime/evidence is identified separately. |
| 11 | minor | claude-code 9; fable 7 | Unreproducible Sonar scope | Accepted. Tracked Sonar properties match effective packages scope/exclusions; removed stale LCOV input. The final 25e3158 scan passes; host/token remain local. |
| 12 | minor | claude-code 7 | Wrong excluded import probe | Accepted. Installed probe now rejects core/http-policy and core/http-policy.js, the actual excluded exports; manifest parity already checks all packages. RESULT/CONTRACT now identify the excluded core policy export. |
| 13 | nit | claude-code 12 | Archive hash assertion | Accepted. Exact-archive fixture asserts ending hashes equal saved starting hashes. All four runs against the 59127e4 archive set pass with equal hashes. |
| 14 | nit | claude-code 11; fable 9 | Ignored docs inflate count | Accepted. Public docs checker excludes ignored docs/research; the reproducible tracked count is 18. Historical raw receipt remains intact; final GATES states 18 public files. |
| 15 | nit | claude-code 14 | Optional core peer disclosure | Accepted. Changelog tells Redis limiter users to install matching core explicitly because it is now optional for messaging-only use. |
| 16 | minor | claude-code 5 | Excluded observer fix disclosure | Accepted as disclosure. Changelog and final handoff name excluded observer/retry fixes 1b56123 and c9ac5cc and the stale collector-identifier risk. Product port remains outside the accepted messaging scope. Owner must consider it before publication. |
| 17 | nit | claude-code 13 | Public lifecycle link | Accepted. Public guide links the tracker issue instead of lifecycle filesystem layout; issue #2 already carries the linked separate-OS-account debt record. |
| 18 | nit | claude-code 10 | Inventory receipt command | Accepted. Final GATES inlines the actual inventory command and its successful exit code. |
| 19 | minor | claude-code 4 | Queued cancellation and graceful close | Accepted signal plumbing; rejected public-close inference: transport calls now forward their cancellation signal. Rejected the proposed public close timing guarantee: shared-transport.close deliberately drains accepted observations before dispatching transport close, and existing reentrant-close tests depend on this. A focused proposed test confirmed that ordering. The public API has no cancellation signal for ordinary send/receive; their operation timeout remains the bound. No silent change to graceful-close semantics. |
| 20 | nit | fable 10 | Presence expiry diagnostics | Rejected a new mandatory presence-loss diagnostic/API. Presence is explicitly a separately renewable session; expiry makes the registration offline, and reconnect must not blindly recreate it. Added operational guidance to inspect agents and register again. This is a documented lifetime boundary, not failed message delivery. |

Sonar raised zero in-diff findings. Its 71 labeled preexisting findings remain
outside this wave's triage, as the engine's scope instructions require. The
project ERROR dashboard is disclosed; no waiver or coverage result is inferred.

The oversized-unit advisory was considered. The owner explicitly retained one
goal for source integration and portable candidate verification. This round
therefore kept the agreed unit and roster; the next round will declare
verification after this fix batch. The two-finding-round limit remains intact.
The separate fresh Codex review fulfills AGENTS.md; it is additional to the
accepted four-engine wave, not a replacement for a missing engine.

## Gate evidence

| Gate | Opus posture | Fable posture | Reconciliation |
| --- | --- | --- | --- |
| 1 extraction | Accepted on evidence; spot-read exclusions and ancestry | Accepted on evidence; spot-read package/lock boundaries | No product extraction expansion; inline inventory receipt correction accepted. |
| 2 docs/contract | Reverified docs, 18 passing; accepted export/spec evidence | Reverified docs, 18 passing; read contract mapping | Contradictory prose and count discrepancy fixed; final rerun pending. |
| 3 ACL deployment | Accepted on evidence | Accepted on evidence | Stronger denial assertions added; four-pairing rerun required. |
| 4 source/cross-host | Accepted on evidence | Accepted on evidence | Newly identified regressions fixed; prior receipts are not final evidence for changed source. |
| 5 quality | Accepted on evidence; no private toolkit in reviewer tree | Reverified core/messaging/Redis typecheck and format; accepted other receipts | New source/config scan and checks required. |
| 6 archives | Accepted on evidence | Accepted on evidence | Prior exact set remains preserved; fixes require a new source-identified set and four installed runs. |
| 7 review | Correct in-flight pointer | Correct in-flight pointer | All four engines completed; reconciliation is complete, verification remains pending. |
| 8 action boundary | Accepted on evidence and diff | Accepted on evidence and diff | No publication/protected merge or excluded feature action. |

Sonar and CodeRabbit do not perform gate-receipt audits; not applicable.
