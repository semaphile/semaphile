# Review goal-001

Goal-review (pre-promotion critique) round for `20260923-132437-redis-messaging-release`
(2026-09-23T18:40:35.696Z). GOAL-kind contract (ADR 0004): dialogic,
spec-scoped, NON-blind — critics read the live draft worktree under a
read-only contract, see prior rounds, and stay open for follow-ups.
`BRIEF.md` is the main agent's local round brief (uncommitted draft policy) (the
outbound half of the loop). `Summary` records the codex
`model_reasoning_summary` launch mode (EVA-58), not a summary of the
critique; `(default)` means nothing was passed — for engines without
the knob (claude-code) that is the only value.

All critics completed. Verdicts this round: claude-code=not_ready, codex=not_ready. (Consensus is judged across engines' LATEST verdicts — `goals goal-review status` — and never auto-promotes: promotion stays a user action.)
Advisory critics, OUTSIDE consensus (EVA-243): pi (completed, not_ready) — their critiques are read and routed like any other, LABELLED advisory-sourced when routed to the user (a below-floor reviewer's items carry that tag); their verdicts never count toward consensus, and goal-stage critiques are not scored (the scoring protocol is the results wave's findings table).

| Engine | Outcome | Delivery | Critique | Verdict | Model | Effort | Summary | Detail |
|---|---|---|---|---|---|---|---|---|
| claude-code | completed | spawned | [CRITIQUE.md](claude-code/CRITIQUE.md) | not_ready | claude-opus-5-5 | high | (default) |  |
| codex | completed | spawned | [CRITIQUE.md](codex/CRITIQUE.md) | not_ready | gpt-6-astra | xhigh | detailed |  |
| pi | completed (advisory) | spawned | [CRITIQUE.md](pi/CRITIQUE.md) | not_ready | google/gemini-3.1-pro-preview | high | (default) |  |

## Routed feedback

All three critiques were read and reconciled on 2026-09-23. This is a
planning review, not evidence of a passing implementation or permission
to promote. GOAL.md and its references remain unchanged. The findings
below are dispositions and proposed amendments pending the owner-directed
refinement; they are not silently adopted product decisions.

### Owner-facing routing

1. **Goal size and completion boundary** — all three critics signal
   consider-wayfinder. Route one scope picker: split source integration
   from post-landing portable release preparation (recommended), retain
   one goal with explicit prerequisites, or chart a map. The work is
   understood well enough that a broad discovery map is not presently
   the planner's recommendation. No extra goal is created without the
   owner's choice.
2. **Lint prerequisite** — Codex 1 / Opus 2, 15: accepted. The literal
   gate formula was copied into a repository with no tools.lint roots;
   a zero exit alone can also admit a deep state that the goal excludes.
   Decide bounded supported configuration within the chosen scope versus
   a separate prerequisite. Do not silently weaken the required deep
   evidence or turn absence into not-applicable. Include existing
   lint:types, format:check, typecheck and check:docs explicitly.
3. **Account boundary** — Codex 4 / Opus 7–8: accepted. Ask separately
   whether two OS users with distinct Redis ACL users are required, or
   only two Redis users. Define allowed-store, denied-store/channel and
   warn/strict inspection cases. Existing limited permissions do not
   become new per-message authorization or mTLS features.
4. **Version provenance** — Opus 1, 13: accepted. The Q3 briefing checked
   npm but omitted the pushed checkpoint/0.3.0 and local archives at
   releases/0.3.0. The earlier decision record assigns 0.3.0 to the HTTP
   milestone and 0.4.0 to MCP. The newer owner choice remains 0.3.0;
   disclose the collision and obtain an informed handling decision before
   promotion. Preserve all existing archives and refs. A distinct
   candidate directory plus source/hash-qualified identities is feasible;
   changing the selected version is not assumed.

### Engineering and evidence dispositions

| Topic | Source | Disposition |
| --- | --- | --- |
| Portable artifacts | Codex 2; Opus 4, 6, 10–11 | Accept explicit same four archive hashes across all required pairings, both real native targets, clean builds, source/binary manifests and artifact-consuming harnesses. Separate provisional candidate evidence from the final landed release identity. |
| Native-free wording | Codex 3; Opus 11 | Accept clarification: no native/SQLite load or local coordination requirement, no install-time compilation, operation with those installed components removed. Existing packaging may still contain those bytes. |
| Shared telemetry prerequisite | Codex 5; Opus 3; Pi 2 (advisory) | Verify and seed the audit with the earlier invalid-baggage trace-dropped correction. It is outside baa06dc..5b565ac but its assertion is in the selected shared telemetry test. Minimal contract-preserving fixes fit the existing dependency audit; unrelated ancestor fixes need individual disposition. No automatic inclusion of proxy ancestry. |
| Proxy residue and locks | Opus 5–6; Pi 3 (advisory) | Accept explicit checks across source, CLI/help, scripts, conformance runner, exports, peers, package locks, specs and docs. Reconcile selected lock entries while preserving third-party identities or documenting required changes. Regeneration is not itself a product decision; its dependency diff is the evidence. |
| Previous-release upgrade | Codex 6; Opus 13 | Accept an actual identified 0.2.0 fixture plus installed candidate CLI, preserving synthetic rollback/crash tests. Explain pilot 0.4.0 replacement separately. Transactional failed-upgrade rollback is not a promised downgrade after success. |
| Host preflight and final receipts | Codex gates 4, 7; Opus 9–10 | Accept early host/tool access checks, explicit retained suite inventory, runtime identities, final-source eligibility and rerun rules. No platform requirement is silently dropped. |
| Contract/docs/export evidence | Codex gates 1–2; Opus 12, 14 | Accept contract-to-test/API comparison and preserved historical section references; check:docs alone checks links/privacy, not API parity. Do not describe a candidate as published. |
| Review/seat boundaries | Codex gates 7–8; Opus 15–16 | Record the actual results roster and repository two-round budget at orchestrator launch planning. Preserve planner/orchestrator/executor ownership. Missing launch-size metadata is not by itself a pre-promotion defect; no arbitrary estimate or operational approval is invented here. |

### Rejected or narrowed claims

- **Pi 1 (advisory):** a single executor is not inherently unable to
  coordinate macOS/Linux checks. The repo has historical remote-host and
  cross-host receipts. Current access must be verified; impossibility is
  unsupported. Pi's suggestion to drop the required matrix is rejected.
- **Pi 3 (advisory):** the pinned feature has package-lock.json files but
  no tracked bun.lock. Claims of inevitable massive conflicts and mandatory
  full regeneration exceed the supplied evidence. Dependency preservation
  and selective reconciliation remain valid concerns.
- **Opus 4:** a real merge commit does preserve the candidate commit as an
  ancestor. It is incorrect that the candidate commit never appears in
  main's history after such a merge. Fast-forward-only landing conflicts
  with this project's real-merge convention and is not recommended.
  The valid issue is the distinction between tested candidate artifacts
  and artifacts identified with the eventual landed source.
- **Opus 6:** package-lock-only is not a guarantee of unchanged transitive
  resolution. Require an examined dependency diff rather than relying on
  the command spelling as proof.
- **Pi gate 5:** calling the lint formula straightforward overlooks the
  configuration gap independently identified by Astra and Opus.
- Absence of a fix from main is not automatically a regression relative
  to published 0.2.0. Shared fixes must be justified by contracts, tests
  and the selected scope, not the fact that they exist in proxy ancestry.

### Execution and integrity record

The user explicitly authorized this three-engine review. It ran through
the completed, unmerged EVA-243 CLI at
530fc3dabfc08f22d38342b87e585fe24362701c by absolute path. No toolchain
link, upstream branch or global settings were changed. Relevant copied
goal instructions matched linked main; ordinary upgrade could not supply
this unmerged feature. Engine sessions remain available for follow-up.

Pi ran through evie-kit's persistent RPC pane host, whose display renders
logs rather than the native Pi TUI. It was not a direct print-mode run.
Pi is advisory because the goal has no selected executor model against
which the floor can be established, not because this round established
that a named executor outranks it. Advisory verdict does not count toward
consensus. No reviewer was silently omitted.

All 360 pre-review tracked-source and goal/reference hashes matched after
the round. The temporary worktree-only reviewer settings were restored
byte-for-byte after checking for concurrent edits. Verification records
are private under .scratch/redis-release-goal-review in the primary root.
The round artifacts remain local/uncommitted under the draft policy.

### Routing update after review

The owner selected Keep one goal over the proposed split and planning
map. GOAL.md now distinguishes candidate verification from final landed
release checks and requires one portable archive set. Round-1 verdicts
remain verdicts on the earlier draft; no re-review has run. Lint setup,
account boundary and version-provenance handling remain pending.

The owner subsequently selected bounded lint setup within the existing
goal, stopping if new toolkit development is needed. GOAL.md records
that prerequisite and preserves the strict evidence requirements. The
account-boundary picker returned no answer, so it remains open. Existing
0.3.0 checkpoint/archive handling also remains to be clarified. No new
review has consumed these revisions.


Account routing resolved: the owner selected OS and Redis users, asked
about Docker, then confirmed after the Linux-container/native-macOS
explanation. GOAL.md now includes both account boundaries, private-file
isolation and explicit Redis permission checks. Version provenance is
still pending. No new review or implementation validation has run.


Version routing resolved: owner reconfirmed 0.3.0 after disclosure of the
historical proxy checkpoints/archives, choosing separate source-identified
candidate output and preservation of old refs/bytes over targeting 0.5.0.
Accepted engineering clarifications are now folded into GOAL.md: shared
telemetry audit, proxy residue/lock inspection, native-free runtime meaning,
actual 0.2.0 upgrade fixture, suite inventory and API/contract comparison.
No new review verdict or passing implementation evidence is claimed.
