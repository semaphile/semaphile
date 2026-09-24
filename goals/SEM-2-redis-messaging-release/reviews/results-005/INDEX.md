# Review results-005

Blind multi-tool review wave for `SEM-2-redis-messaging-release` (2026-09-23T23:27:05.102Z).
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

Round purpose: **verification** — this round checked a fix batch rather than hunting fresh defects, so it is EXEMPT from the results-round budget (EVA-90, grill Q4; the earning-through-rounds-3-4 shape of EVA-40/EVA-80). What it verified: Verify the bounded recovery, subscription fencing, retention accounting, permission handling, contributor checks and evidence fixes in commits 1421359 through b928d06, including the regenerated portable candidate and four-pairing regressions.

All reviewers completed.


| Tool | Outcome | Findings | Model | Effort | Summary | Args | Detail |
|---|---|---|---|---|---|---|---|
| claude-code | completed | [FINDINGS.md](claude-code/FINDINGS.md) | claude-opus-5-5 | high | (default) |  |  |
| sonarqube | completed | [FINDINGS.md](sonarqube/FINDINGS.md) | (default) | (default) | (default) |  |  |
| coderabbit | completed | [FINDINGS.md](coderabbit/FINDINGS.md) | (default) | (default) | (default) |  |  |
| fable | completed | [FINDINGS.md](fable/FINDINGS.md) | claude-fable-5-1 | high | (default) |  |  |
| codex | excluded | — | | | | | excluded by the frontmatter engines override — see the roster banner |

## Merged findings

Reviewed head: `b928d062412f`. All four engines completed. The separate fresh
read-only Codex verification also completed with no actionable findings; it
verified receipt ancestry, all four durable hashes, 5/5 static assertions and
4/4 in-memory probes. Its report is retained in primary private
`reviews/sem-2-codex-2.md`.

This round consolidated 10 items, with no blocker or major defect, compared
with 20 items in results-004. The owner retained one source/artifact goal;
the 6626-line/85-file advisory was considered and that agreed unit preserved.
This was the declared verification round. Two fresh Codex reviews have run;
accepted closing corrections receive affected regression and archive checks.
No third broad finding round is required by this reduced finding set.

Gate status: **passed**. Bounded closing corrections in c711d15, 2910e5a,
2a78f00 and `800c8c53b8548250da6bf4a684bf796f1e9e1a73` are verified by the final 2520/2520 source
matrix, 6/6 cross-host cases, 20/20 exact installed groups and passing quality
formula. The callback-timer regression is deterministic under a frozen wall
clock. Final source/archive identity and receipt ancestry are in GATES.md.

| # | Severity | Raised by | Finding | Disposition |
| --- | --- | --- | --- | --- |
| 1 | minor | claude-code | Dispatched uncertain claim stops listener | Accepted documentation/test correction; rejected automatic retry as mandatory. SPEC 20 requires explicit uncertainty for lost mutation replies. The existing listener reports the error through done/onError; preserving that surfaced result is intentional. Public guidance now distinguishes idle wait recovery from explicit listener restart. A new lost-receive test verifies error reporting, no immediate takeover, fresh delivery, and expired-claim redelivery on an explicit restart. Confirmed independent handlers retain their own deadlines. |
| 2 | minor | claude-code | Old expiry snapshot invents retirement | Accepted, fixed. An expired snapshot no longer becomes STALE when the first touch fails: it preserves the transport error because another worker may have renewed the subscription. Early operation TIMEOUT is no longer converted to caller-deadline exhaustion. A peer-renewed old-handle regression reproduces the old STALE failure and passes with the fix, including explicit retry after reconnect. The final matrix exposed an early timer callback before the wall-clock deadline comparison; an explicit caller-expired flag and frozen-clock regression now preserve null for caller expiry. This preserves uncertainty without adding polling or extending unconfirmed ownership. |
| 3 | minor | claude-code; fable | Gate 7 evidence points at prior wave | Accepted. Final GATES cites results-005 and sem-2-codex-2.md; prior-round evidence remains historical. |
| 4 | minor | claude-code; fable | Fixture-isolation learning omitted | Accepted. Retrospective routes per-case fault-client cleanup to the conformance conventions/docs/testing.md. |
| 5 | minor | fable | OOM or concurrent type change partially writes Lua state | Rejected the claimed failure mechanism. Lua execution blocks concurrent commands, so another client cannot change a key type between preflight and write. Redis checks the memory-allocating first write before mutation; later writes are allowed once execution has crossed that boundary. A focused Redis 8.4 noeviction/maxmemory probe returned UNCERTAIN with every persisted store key byte-identical to the pre-send snapshot; a direct allocating-first-write probe also left no key. A preceding notification is a hint, not persisted partial state. No shebang or pcall change is needed for this finding. Evidence and primary sources below. |
| 6 | minor | fable | Definitive permission reply becomes UNCERTAIN and reconnects | Accepted, fixed for definitive permission refusals. Driver ErrorReply NOPERM/NOAUTH/WRONGPASS and Redis 8.4 script-ACL replies become ACCESS without breaking established sockets. ACCESS during reconnect is terminal. EVAL/TIME revocation tests cover startup and established connections, restore access, and assert no extra SUBSCRIBE on live sockets. Arbitrary Lua runtime errors remain conservatively UNCERTAIN because a reply alone does not prove no earlier writes occurred. |
| 7 | minor | fable | Local retirement cancellation loses STALE reason | Rejected the proposed new error-code guarantee. SPEC 20 requires invalidated claims and cooperative cancellation, which occur. A local watchdog bounds confirmed activity; it cannot prove global retirement when another participant may renew. Standard ABORTED/cancelled-listener behavior is therefore preserved, while authoritative server generation checks still report STALE. The suggested idle connected waiter test would not expire normally because connected activity renews its TTL. No new reason-propagation API is added. |
| 8 | nit | fable | Backend import diagnostic hides original cause | Accepted, fixed. CONFIG still gives the actionable matching-package guidance, while error.cause retains the actual loader failure for programmatic diagnosis. |
| 9 | nit | fable | Startup leaks raw driver errors | Accepted, fixed. Permission refusals from connect/subscribe are MessagingError ACCESS; other raw connection failures become UNAVAILABLE. Notification ACL test now asserts the public code. Existing classified errors remain intact. |
| 10 | nit | fable | Optional core peer needs owner visibility | Accepted handoff disclosure; rejected changing the selected feature export/peer contract during reconciliation. Feature parity and messaging-only scope are explicit gate obligations. CHANGELOG and RESULT explain that limiter consumers install core explicitly; final publication review must confirm this install behavior. No new interview or peer change is needed to prepare the agreed candidate. |

The OOM diagnostic is retained at private
`receipts/sem-2-lua-oom-audit-final.log` (2/2 checks). The first exploratory
probe assumed success; its UNCERTAIN outcome prompted the full before/after
key comparison rather than a success claim.
[Redis scripting documentation](https://redis.io/docs/latest/develop/programmability/eval-intro/)
describes atomic execution and first-write memory behavior;
[Redis Lua flags](https://redis.io/docs/latest/develop/programmability/lua-api/#script-flags)
describes the distinct shebang defaults. These support the scoped rejection,
not a blanket promise that arbitrary Lua errors roll back.

Sonar reports zero in-diff findings and 71 labeled preexisting findings. The
project dashboard ERROR is disclosed; no waiver or coverage claim is inferred.
CodeRabbit reports no new findings. Raw reports are preserved under primary
private `reviews/sem-2-results-005/`; suggested commands were assessed, not
executed as reviewer instructions.

## Gate evidence

| Gate | claude-code posture | fable posture | Reconciliation |
| --- | --- | --- | --- |
| 1 extraction | Accepted on evidence; inspected manifests and ancestry | Accepted on evidence; inspected ancestry/proxy inventory | No extraction expansion. |
| 2 contract/docs | Reverified docs, 18/18; accepted other evidence | Accepted on evidence and source reading | Behavior/documentation findings are dispositioned above; final docs check passes after corrections. |
| 3 ACL | Accepted on evidence; matched allowlist to Lua commands | Accepted on evidence | Extended EVAL/TIME and public-code checks included in passing final four-pairing run. |
| 4 source/cross-host | Accepted on evidence; verified source-equivalent ancestor deltas | Accepted on evidence; verified ancestry/counts | Final affected matrix and cross-host checks pass after closing fixes. Core remains unchanged. |
| 5 quality | Accepted on evidence; isolated tree lacked package dependencies | Accepted on evidence; isolated tree lacked dependencies | New lint formula and repository checks pass against final package source. |
| 6 archives | Accepted on evidence; inspected fixture and unchanged package ancestry | Accepted on evidence; checked fixture groups | New immutable source-named archive set passes all four installed combinations. |
| 7 review | In-flight waiver valid, stale pointer flagged | In-flight waiver valid, stale pointer flagged | This reconciled INDEX is the final wave record; separate Codex verification is additional. |
| 8 action boundary | Accepted on evidence and diff | Accepted on evidence and diff | No publication/protected merge or excluded feature action. |

Headless Sonar and CodeRabbit gate audits: not applicable.
