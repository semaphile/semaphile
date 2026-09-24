# Review goal-001

Goal-review (pre-promotion critique) round for `20260924-000114-cross-account-messaging`
(2026-09-24T05:24:13.963Z). GOAL-kind contract (ADR 0004): dialogic,
spec-scoped, NON-blind — critics read the live draft worktree under a
read-only contract, see prior rounds, and stay open for follow-ups.
`BRIEF.md` is the main agent's committed round brief (the
outbound half of the loop). `Summary` records the codex
`model_reasoning_summary` launch mode (EVA-58), not a summary of the
critique; `(default)` means nothing was passed — for engines without
the knob (claude-code) that is the only value.

All critics completed. Verdicts this round: claude-code=not_ready, codex=not_ready. (Consensus is judged across engines' LATEST verdicts — `goals goal-review status` — and never auto-promotes: promotion stays a user action.)
Advisory critics, OUTSIDE consensus (EVA-243): pi-gemini (completed, not_ready) — their critiques are read and routed like any other, LABELLED advisory-sourced when routed to the user (a below-floor reviewer's items carry that tag); their verdicts never count toward consensus, and goal-stage critiques are not scored (the scoring protocol is the results wave's findings table).

| Engine | Outcome | Delivery | Critique | Verdict | Model | Effort | Summary | Detail |
|---|---|---|---|---|---|---|---|---|
| claude-code | completed | spawned | [CRITIQUE.md](claude-code/CRITIQUE.md) | not_ready | claude-opus-5-5 | high | (default) |  |
| codex | completed | spawned | [CRITIQUE.md](codex/CRITIQUE.md) | not_ready | gpt-6-astra | xhigh | detailed |  |
| pi-gemini | completed (advisory) | spawned | [CRITIQUE.md](pi-gemini/CRITIQUE.md) | not_ready | google/gemini-3.1-pro-preview | high | (default) |  |

## Routed feedback

All three critiques were read. The review driver exited 0; that is a successful
review process, not a promotion-ready verdict. Astra and Opus both return
not_ready; Pi/Gemini independently returns not_ready in an advisory posture.
Self-reported finding counts are Astra 7, Opus 20 and Pi/Gemini 7; those counts
include overlapping questions and are not 34 distinct defects.

The owner has now selected one goal with explicit checkpoints (grill Q5),
and that execution shape is folded into GOAL.md. Other revisions remain pending. The table records
proposed dispositions and the remaining interview routing. The original owner
choices (messaging included, three accounts, cloud container, removal) stand.

| Consolidated item | Sources | Disposition and next action |
| --- | --- | --- |
| Fixed behavioral inventory and a real cross-UID driver | Astra 1; Opus 1 | Accept for proposed revision. Keep 48 direct exchanges distinct from a bounded, named set of cross-account topic/lifetime cases and per-UID ACL/readiness reruns. Existing one-process suites are not cross-account evidence. |
| Exact installed archive set | Astra 2; Opus 2/Q1 | Accept; route artifact baseline choice to owner. Recommend the exact SEM-2 candidate bytes on both platforms, with loaded paths and hashes proving actual use. A fresh pack changes what is certified. Match Linux libc if any native package is exercised. |
| Actual private configurations, process identities and clean environment | Astra 3; Opus 9/10/14; Pi 3/Q3 (advisory) | Accept for proposed revision. Test the actual synthetic config/credential inputs used by each participant, pair denials with successful owner reads, assert permission-denial reasons and real/effective IDs/groups, and reject inherited controller credentials. Prove noninteractive switching without cached admin authentication. |
| Redis topology and administrative role | Astra 4; Opus 5; Pi 2 (advisory) | Accept for proposed revision. Pin a fixture Redis service and separate its administrative controller from all three restricted participants. Inject its endpoint explicitly; no nested Docker or participant socket access. Include service state/logs in resource accounting. |
| Temporary authorization and complete resource inventory | Astra 5; Opus 6/7; Pi 1/Q1 (advisory) | Accept for proposed revision. Include runner authorization, groups, service/network/volume/image resources and paths; root-owned runner/manifest boundaries; avoid adding default staff access to personal homes. Exact bootstrap commands remain reviewed executor deliverables, not a new request for broad root delegation. |
| Partial setup, failure recovery and repeated cleanup | Astra 5; Opus 15 | Accept for proposed revision. Incrementally record created resources, refuse ownership mismatch, support safe cleanup after partial setup, and verify collision refusal and harmless repeated cleanup. Do not equate a single successful run with unlimited reproducibility. |
| Review, reruns, teardown and final audit order | Astra 6; Opus 8/Q2; Pi 4 (advisory) | Accept for proposed revision. Recommend setup → tests → blind review/fixes/reruns → durable receipt capture → owner-assisted teardown → read-only cleanup audit → completion. Include actual cleanup evidence and a return to approved provisioning if an exercised change follows teardown. No lock with required cleanup outstanding. |
| Receipt integrity and private/public split | Astra 6; Opus 9 | Accept. Propose case/run nonces, identities, commands, outcomes and before/after manifests. Keep absolute private evidence locations in private records; use stable repo-relative references in shareable results. Existing receipt inspection is not a new test run. |
| Three users plus shared-group outsider | Astra gate 2; Opus 11; Pi 3/Q3 (advisory) | Accept engineering clarification: two fixture users share the explicit handoff group and the third supplies the denied outsider case; all three retain isolated private homes and participate in messaging. No fourth created user needed. |
| Accessible historical references | Opus 13; Astra citation note | Accept reproducibility concern. The worktree profile excludes SEM-2; materialize a bounded, commit-pinned debt/artifact reference or document exact git-show reads. Do not copy private host inventory. |
| Public verification boundary and debt completion | Astra gate 7; Opus 12/Q4 | Accept for proposed revision: required debt criteria must all pass, with honest version-scoped public documentation and a follow-up evidence link. Locked SEM-2 history remains unchanged; orchestrator owns tracker lifecycle updates. Do not close an unmet gate by listing it as residual debt. |
| Product bug discovered during testing | Astra 7 | Route to owner. Recommend stop with a reproducer and separate fix decision; alternative permits bounded SPEC-preserving product fixes and reidentified archives within this goal. This interacts with the archive choice. |
| Sizing / wayfinder | Pi consider-wayfinder (advisory); Astra and Opus none | Resolved by owner: Keep one goal (grill Q5). One goal with explicit checkpoints; 48 automated exchanges are not 48 implementation tasks. Splitting can duplicate owner setup/teardown or require ownership across goals. Launch sizing remains the orchestrator's responsibility. |
| Chore label versus size | Pi sizing (advisory); Astra sizing | Reject the implication that Chore means small; it is a change category. The operational size must be estimated independently. |
| Extra authority questions and low-level mechanism choices | Opus Q3/Q5; Pi Q1/Q2/Q3 (advisory) | Do not mechanically repeat permissions or ask the owner to design command syntax. Existing decisions select the cloud container and narrow fixture-only switching. Prepare concrete procedures for the already-disclosed owner/operator checkpoints; ask only if the required authority exceeds that boundary. |

## Read-only verification

All 396 protected files (tracked files plus this draft's non-review artifacts)
match their pre-round SHA-256 hashes. Worktree status contains only the existing
untracked goals/drafts tree. The temporary worktree-only reviewer settings were
restored byte-for-byte after checking the override hash. Receipts are in the
primary checkout's `.scratch/cross-account-goal-review/round-001/`.

The three critic tabs remain available for follow-up. No promotion, executor
launch, provisioning or host mutation occurred during this review. Next: resolve the artifact/fix boundary and the proposed corrections. Sizing
was resolved in grill Q5; no new critique consensus is claimed after that edit.


## Revision submitted for verification

The owner selected exact SEM-2 archives with a separate fix decision for product
bugs, then explicitly directed completion of the remaining review work. The
planner incorporated the accepted engineering corrections in GOAL.md and the
binding verification contract: fixed 200-case inventory, actual installed bytes
and private inputs, self-reported identities, dedicated Redis topology, narrow
Mac switching, resource accounting, recovery and cleanup/audit order. Historical
debt/artifact references are now available inside this profile. All accepted
items above are implemented in the proposed contract, pending goal-002 checking;
this does not change goal-001's not_ready verdicts. Extra permission questions
remain concrete execution checkpoints, not repeated planning questions.
