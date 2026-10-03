---
goal: SEM-3
frames: [starfish]
written: 2026-10-03T14:36:01-05:00
schema: 4
---

# SEM-3 Retrospective: Test Redis Messaging Across OS Accounts

<!-- The executor's pre-lock retrospective (EVA-238, EVA-264, EVA-284). Judge the
     work's sizing against the computed seeds; then your OWN learnings, each landing
     in a committed file a future agent reads; then the friction with the tooling,
     routed toward future goals, evie-kit, or a third-party library or tool; then
     answer the reviewers' observations. Never the work items themselves (those are
     RESULT.md's Follow-ups). After the final round: `retrospective refresh <KEY>`,
     then `retrospective check <KEY>`, which must pass before the locking commit. -->

## Summary

<!-- Two to four plain sentences for a reader who never opened this goal (EVA-282):
     what it built, how the review went, which initial risks came true, and which
     emerged. They lead the retrospective comment the lock posts to the tracker issue,
     so no tables, no lists, no round ids. Write this section last. -->

This goal built a fixture that runs the SEM-2 Redis messaging candidate between three dedicated OS accounts on macOS and in a disposable Linux cloud VM, with root-run setup and teardown scripts, Terraform and Ansible for the cloud leg, and a 100-case matrix per platform. The review rounds so far found real defects in the privileged and cleanup paths, which are fixed, but nothing has run under real accounts yet, so the platform, matrix and cleanup gates are still open. The risks that emerged were trust boundaries between the controller account and root, cleanup that could report success when it had failed, and platform behaviour (nested macOS groups, Debian group deletion) that only showed up on close reading. This retrospective is written before the final review round and will be refreshed after it.

## Sizing

<!-- Was the work the right size (EVA-284)? Give each axis exactly one verdict —
     right-sized | oversized | undersized | unknown — and a one-line reason that cites
     the seeds above or the diff. There is no default: `unknown` means too little
     evidence to judge, never a way to skip the question.
       Goal or inline    oversized = an inline change would have done;
                         undersized = it should have been split
       Executor model    the model and effort against what the work needed
       Reviewers         the engines, models and rounds against what they caught
       Tests             the suites run (full vs selective) and their cost
       Change footprint  what the diff adds, tests included: worth keeping permanently?
     A mid-session model switch belongs in the executor model's reason.
     `retrospective refresh` rewrites the seeds between the markers and never touches
     this table. -->

<!-- sizing:begin (computed — refresh with `evie-kit goals retrospective refresh <KEY>`) -->
**Planned baseline**: not recorded — no accepted-plan snapshot is bound (the goal launched before EVA-284, or without an accepted plan).

**Executor model**: launched claude-opus-5-5 on claude-code (the launch record); the baseline is not recorded. A switch during the session is the executor's to note in its reason.

**Reviewer engines**: results rounds — codex 1 of 2 completed (1 failed), sonarqube 2 of 2 completed, coderabbit 2 of 2 completed, fable 2 of 2 completed, opus55-medium 1 of 1 completed (advisory), opus55-xhigh 1 of 1 completed (advisory), sonnet55-xhigh 1 of 1 completed (advisory); goal rounds — claude-code 4 of 4 completed, codex 4 of 4 completed, pi-gemini 4 of 4 completed (advisory). The planned roster is not recorded.

**Round budget**: results — 0 finding against budget not recorded, 1 verification, 0 failed, 1 short; goal — 1 finding against budget not recorded, 3 verification, 0 failed, 0 short.

**Initial risks**: none identified; 4 emergent.

### Time spent

**Timing snapshot**: not recorded — no results/timing-summary.json (lock preparation freezes it with `goals timing snapshot`).
<!-- sizing:end -->

| Axis | Verdict | Reason |
| --- | --- | --- |
| Goal or inline | undersized | One goal carries two provisioning paths, two root-run admin scripts, a mid-flight cloud amendment and the harness; the final review had to be split into three units to stay reviewable. |
| Executor model | right-sized | Opus 5.5 handled the shell, Terraform, Ansible and harness work; the defects reviewers found were platform facts and boundary cases, not reasoning the model could not do. |
| Reviewers | right-sized | Independent engines each caught defects no other caught; the scanner covered almost none of this change, which lives outside its configured sources. |
| Tests | unknown | Only static checks, stubs and same-UID dev runs have run; the real tests need the owner checkpoints, so their cost and adequacy cannot yet be judged. |
| Change footprint | right-sized | The fixture, scripts and cloud code are the reusable deliverable the owner asked to keep; the case inventory is independent of the cloud layer and can target another leg later. |

## Frame: Starfish

<!-- Keep / Less of / More of / Stop / Start — Start-Stop-Continue with two dials added, for practices that are right in kind but wrong in amount. The built-in default since EVA-284. (Patrick Kua's Starfish retrospective) -->

### Keep doing

<!-- What practices earned their place and should continue unchanged? -->

Exercising every fix without provisioning: stub tools for audit and destroy paths, planted-link tests for root-run writers, launch-failure and signal tests of the controller, mocked teardown loops. Each one either confirmed a fix or found a bug in the test itself, before anything ran as root. Recording each resource as intended before creating it and as observed after, and refusing on any identity mismatch, also held up under every review.

### Less of

<!-- What was right in kind but overdone — too many rounds, too much ceremony? -->

Re-staging and re-hashing the whole tree after every small commit. Each packet needed new hashes, and several packets went stale before anyone could act on them. Batching fixes before re-staging would have produced fewer, more durable packets.

### More of

<!-- What was right in kind but underdone — a check, a read, a test you wish you had done more? -->

Reading the platform's own behaviour before encoding an assumption about it. The fixed list of macOS implicit groups and the assumption that `userdel` leaves groups alone were both wrong, and both were checkable read-only in a minute (`id -G nobody`, the image's `login.defs`). The same goes for the tool surface of the pinned image (no procps) and the container's capability set.

### Stop doing

<!-- What should stop entirely? -->

Writing ad-hoc shell checks that print counts after a failed query. One of my own read-only refreshes printed "0 networks" while gcloud's login had expired; the fail-closed pattern belongs in throwaway scripts as much as in the deliverable.

### Start doing

<!-- What new practice, verb, or convention would have helped? -->

A short threat model at the start of any goal that ships root-run scripts: which account is trusted, which paths it controls, and what root may do with them. Most of the privileged-path defects follow from not writing that down before the first script.

## Risk register

<!-- GOAL.md's initial risk register, copied with each row's # (EVA-282). Give every
     initial row exactly ONE Outcome:
       did not occur | occurred and mitigated | occurred and unresolved | retired
     (`retired` = no longer applicable). `occurred and unresolved` and `retired` need
     a one-line Explanation; the others may carry one. Add each risk that EMERGED during
     the goal as a row whose # is `emergent` (Kind, Surface, Likelihood and Impact as in
     GOAL.md; an Outcome is optional). A row may point at a What I learned row by number
     in its Explanation ("see learning 2"); nothing routes a risk for you.
     With no initial rows, the section carries "None identified." until a risk emerges; then
     replace the line with the table. `retrospective check` compares these rows with
     GOAL.md's register, and the lock refuses a register edited after the check. -->

| # | Risk | Kind | Surface | Likelihood | Impact | Outcome | Explanation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| emergent | Root follows or writes into controller-owned paths | security | destructive-fs | high | high | occurred and mitigated | Root copied, chowned and followed links in paths the controller account controls; fixed before any root run (see learning 4). |
| emergent | Cleanup reports success after failing | correctness | destructive-fs | high | high | occurred and mitigated | Audits could report clean when their queries failed, and destroy refused partial or post-deadline state; fixed and stub-tested (see learning 3). |
| emergent | Platform account behaviour differs from assumptions | correctness | — | high | medium | occurred and mitigated | Nested macOS groups would have failed every identity check, and Debian's userdel would have stopped Linux teardown; fixed (see learnings 1 and 2). |
| emergent | Owner packet outdated by later fixes | operational | — | high | medium | occurred and mitigated | Packets went stale as fixes landed; each refreshed packet is marked not to be activated until the final review is reconciled. |

## What I learned

<!-- YOUR OWN learnings, first (EVA-264): what this goal taught YOU that the next
     agent working here should not have to rediscover. Ask yourself:
       - What did you learn about the codebase or the domain — a term, an invariant,
         a module that only makes sense beside its caller?
       - Where did your first approach go wrong, and why?
       - What did the review findings teach you about this code?
       - What should the next agent in this area know FIRST?
     Harvest the reviewers' "Notes for the next agent" here too: route the ones that
     outlast this goal, phrased as facts about the code, never as "reviewer X said"
     (the final round reads this table blind; a row citing a round id or an
     engine's numbered finding fails the check).

     ROUTE every row to a committed file:
       context-md        a domain TERM for the nearest package glossary; the row
                         reads `Term: meaning`, Target = packages/<pkg>/CONTEXT.md
       learnings-file    a lesson, gotcha, or approach;
                         Target = .evie-kit/learnings/<topic>.md
       instruction-line  a rule EVERY agent in the project needs; the Learning cell
                         IS the proposed one-line text, Target = CLAUDE.md or AGENTS.md.
                         Proposed only: the user approves it at the merge picker and
                         the orchestrator applies it after the merge.
     Write every context-md and learnings-file target NOW, on this branch, with
     `evie-kit learnings add` (one file per learning), and commit it before the final
     round, which reviews it; the check refuses a target that is not committed.

     Nothing durable learned? Write the single line "No own learnings." in place of
     the table. There is no quota: never pad a row to fill the section. -->

| # | Learning | Route | Target |
| --- | --- | --- | --- |
| 1 | Every local macOS account inherits computed and nested groups (everyone, localaccounts, _lpoperator, sharepoint groups); derive the inherited set at run time from hidden reference accounts and still forbid privileged groups. | learnings-file | .evie-kit/learnings/macos-inherited-groups.md |
| 2 | With USERGROUPS_ENAB yes (Debian, the redis images), userdel deletes the user's private group, so teardown must reconcile groups before groupdel. | learnings-file | .evie-kit/learnings/debian-userdel-private-groups.md |
| 3 | A failed query inside a shell test substitution reads as "absent"; capture first and fail on the query's own exit, and treat a missing Terraform state as an error once anything was applied. | learnings-file | .evie-kit/learnings/shell-absence-queries.md |
| 4 | Root-run scripts must not follow links in, write into, or widen access to a less-privileged account's paths; write as that account with noclobber and verify root-private copies. | learnings-file | .evie-kit/learnings/root-scripts-untrusted-paths.md |
| 5 | Container root without DAC capabilities must switch to the owner to read or empty 0700 directories, setpriv needs SETPCAP to clear the bounding set, and the redis image has no procps. | learnings-file | .evie-kit/learnings/container-root-without-dac.md |

## Tooling friction

<!-- Friction with the TOOLING this goal ran with, one row each. ROUTE every row:
       convention-skill-candidate  — should change how future goals run
                                     (a convention file, a skill, a template);
       evie-kit-change-candidate   — should become a draft/issue against evie-kit
                                     (a verb, a refusal, the harness, a review engine);
       upstream-bug                — a bug in a third-party library or tool, to report
                                     upstream (drafted for a human; never auto-filed);
       replace-candidate           — a tool that does not fit the job, to replace;
       remove-candidate            — a dependency or tool that is bloat, to remove;
       one-off                     — record only (Target may be —).
     Candidates name a Target: the file/skill/convention, package/verb, or issue key;
     the three third-party routes name the library or tool.
     Which evie-kit verb, refusal, or harness step (the /goal contract, the watch,
     compaction, the guard) fought you, and what should it have done?

     No friction? Write the single line "No tooling friction." in place of the table.
     Rows name tooling and process gaps and never cite an earlier round's findings,
     reviewers, or dispositions; which engine earned its keep belongs under the
     computed section below. -->

| # | Friction | Route | Target |
| --- | --- | --- | --- |
| 1 | The review harness's allowlisted answer to the codex self-updater dialog was typed into codex's composer as text, so the agent never received the review and the leg stalled; it needed an in-place retry. It should select the menu option, or launch codex with the update check off. | evie-kit-change-candidate | goals review (codex reviewer prompt answering) |
| 2 | `goals tracker comment --event review-round --body-file` stamps a marker without the round id, so the next round's post was refused as a duplicate and needed `--force`. The marker should carry the round. | evie-kit-change-candidate | goals tracker comment |
| 3 | The codex reviewer offers no per-launch argument or config override, so its update check could not be turned off for a review without editing the shared codex configuration. | evie-kit-change-candidate | codex reviewer launch |
| 4 | The goal re-arm reported "no position record" because this repository keeps handoffs in the private `.scratch/docs/handoffs/` tree that AGENTS.md mandates, which the re-arm does not search. | evie-kit-change-candidate | goals re-arm / handoff location |
| 5 | The pause marker was removed by another process twice before the executor could delete it, which makes "the executor deletes its own marker" unverifiable. | evie-kit-change-candidate | goals resume / pause marker ownership |
| 6 | The home-path guard is line-oriented and missed terminal-wrapped fragments of home paths in raw screen captures. | evie-kit-change-candidate | names home-paths |
| 7 | The retrospective's reviewer-quality reader only parses an integer `#` column, so merged findings numbered with a prefix were silently counted as zero. It should report rows it skips. | evie-kit-change-candidate | goals retrospective reviewers |
| 8 | The pause guard blocks read-only shell commands, such as printing the contract file, that a stop-hook evaluator then asks to see; only the file-read tool works while paused. | evie-kit-change-candidate | pause guard / stop-hook evaluator |
| 9 | SonarQube's configured sources are `packages/`, so the deep tier is not applicable to a change confined to `conformance/accounts`; the shell, Terraform and Ansible are covered only by ShellCheck, terraform validate and ansible-lint receipts. | convention-skill-candidate | review roster for conformance-only goals |
| 10 | zsh, the session shell, reads `$P:t…` as a path modifier, reserves `status`, does not word-split unquoted variables and aliases `mv` and `mk`; several throwaway commands failed for those reasons. | one-off | — |

## Reviewer feedback quality

<!-- reviewers:begin (computed — refresh with `evie-kit goals retrospective refresh <KEY>`) -->
Computed by `evie-kit goals retrospective reviewers` from the reconciled merged-findings tables of results-005, results-006 (18 merged findings).
Coverage gaps — reconciled as prose, not counted: goal-001; UNRECONCILED, not counted: goal-002, goal-003, goal-004.

| Engine | Rounds | Model(s) | Raised | Accepted | Rejected | Unique accepted |
| --- | --- | --- | --- | --- | --- | --- |
| fable | 2 | claude-fable-5-1 | 13 | 13 (100%) | 0 | 13 |
| coderabbit | 2 | — | 2 | 2 (100%) | 0 | 2 |
| codex | 1 | gpt-6-astra | 2 | 2 (100%) | 0 | 2 |
| sonarqube | 2 | — | 1 | 0 (0%) | 1 | 0 |

Unique accepted = accepted findings no other engine raised: the earning-its-keep signal. An engine with zero unique accepted findings across the goal returned only what the others would have caught anyway.
Zero unique accepted this goal: sonarqube.

Itemized per engine: at most six findings each, the most novel first (unique accepted, then accepted with other engines, then skipped; higher severity first within each). Unclassified rows are counted, never listed as skipped.

**fable**

- Unique accepted: No gate receipts existed at the round's head (accepted as-is)
- Unique accepted: Receipts omitted the filter flags and the participant launch argv
- Unique accepted: ACL and readiness opens did not assert or record the resolved `semaphile.json`
- Unique accepted: A6 restored EVAL and TIME only on the success path
- Unique accepted: Not-yet-run gates were labelled WAIVER with no recorded waiver
- Unique accepted: On Linux, container root cannot search the service's 0700 directory, so the ownership receipt recorded EACCES for two entries
- And 7 more; see the round INDEXes.

**coderabbit**

- Unique accepted: The mode check failed with GNU `stat`, refusing every run directory on a Linux operator host
- Unique accepted: The planner's goal-review records carry home-folder paths

**codex**

- Unique accepted: `userdel` removes each fixture user's empty private group (`USERGROUPS_ENAB yes`, confirmed in the pinned image's `login.defs`), so the following `groupdel` exits 6 and teardown, including the rehearsal's recovery teardown, stops
- Unique accepted: A signal during Redis startup saw no handle, skipped the stop and wrote a clean receipt; a signal mid-provisioning could purge while the main flow kept writing

**sonarqube**

- Skipped: S2970 read the local `expect(label, actual, expected)` helper as an incomplete test assertion — False positive: the helper pushes to `problems`, which callers treat as INVALID or FAIL
<!-- reviewers:end -->

<!-- Add one or two sentences of judgment under the numbers: which engine's
     findings were worth acting on, whether a model ramp changed what was
     caught, and whether a subscription engine earned its keep on THIS goal. -->

fable produced the most accepted findings, mostly evidence and assertion gaps; codex, once it ran, caught the two cleanup defects that would have broken teardown and signal handling. CodeRabbit added two unique, cheap catches. SonarQube earned nothing here because this change lies outside its configured sources, which is a roster fit question rather than a tool fault. The advisory lanes, scored outside the gate, found the privileged-path blockers no gating engine raised.

## Observation responses

<!-- The reviewers' observations (EVA-284): judgments about past choices the diff
     cannot fix, recorded in each round INDEX's "Reviewer observations" section. Answer
     every one: a Response is required, agreement is not; Pointer names any action or
     learning it led to ("learning 2", an issue key) or —. Two observations that say the
     same thing may share a row: list both ids in its Source cell. `retrospective
     refresh` adds a row for each new observation and never touches an answered one;
     with none in any round, the section carries the single line "None.".
     Answering never opens another review round. -->

| Source | Observation | Response | Pointer |
| --- | --- | --- | --- |
| results-005/fable/1 | GOAL.md has no risk-register section; risks are stated in prose and in the verification contract. | A risk register would have given reviewers something to check mitigations against. The emergent risks are now recorded above. | — |
| results-005/fable/2 | One chore carries two provisioning paths, two root-run admin scripts, a cloud leg and a 100-case matrix per platform, by the owner's choice of one goal with checkpoints. | Agreed that the size follows from the one-goal choice; the final review is split into three units to keep it reviewable. | references/final-review-scopes.md |
| results-005/fable/3 | The interim round used four review engines on root-run shell and Terraform code. | Agreed: the scripts run as root on the owner's machine, and the independent engines each caught defects the others missed. | — |
| results-005/opus55-medium/1 | The cloud amendment arrived after the harness and admin scripts were reviewed, and its lifecycle code had no rehearsal of partial apply or post-deadline destroy. | Agreed. Partial-apply and post-deadline destroy are now covered by stub tests, and the rehearsals now crash at two depths. | learning 3 |
| results-005/opus55-medium/2 | Each accepted fix to trusted code requires an owner-assisted macOS reinstall; the cloud amendment could have been a separate goal. | The reinstall cost is real; fixes are batched before each reinstall, and the owner chose one goal with checkpoints. | — |
| results-005/opus55-xhigh/1 | GOAL.md has no risk-register section to check mitigations against. | Same as results-005/fable/1; the emergent risks are recorded above. | — |
| results-005/opus55-xhigh/2 | The Sonar slot covers `packages/`, while this change is harness, shell, Terraform and Ansible. | Agreed; recorded as tooling friction 9. | tooling friction 9 |
| results-005/opus55-xhigh/3 | The VM deletion deadline (8 h default) and a multi-round review with reruns were not reconciled in the plan. | Agreed. destroy now handles a VM removed by the deadline, and receipts are fetched after each pass, so a long review cannot strand evidence. | learning 3 |
| results-005/opus55-xhigh/4 | The staged listing and its hash are both produced by the controller, so the reviewed content is anchored in the controller rather than an independent listing of the commit. | Accepted as a limit of the design: the owner checks the listing hash, and the listing is produced from a named commit by a committed tool, so an independent re-derivation from that commit is possible. | — |
| results-005/opus55-xhigh/5 | Interim rounds review a large body of root, cloud and harness code that cannot run until owner checkpoints. | Agreed; no review substitutes for the live runs, which gates 1 to 4 still require. | — |
| results-005/sonnet55-xhigh/1 | GOAL.md has no risk-register section. | Same as results-005/fable/1. | — |
| results-005/sonnet55-xhigh/2 | The change is about 5,500 lines for a chore, and the two admin scripts duplicate recovery logic by design. | Agreed that the duplication is a cost of two self-contained, hash-verified admin scripts; fixes are applied to both. | — |
| results-005/sonnet55-xhigh/3 | Candidate pins, the consumer lock and staging's re-derivation are three cross-checked views of the same data. | Agreed; the cross-check is deliberate, because any one view can be regenerated from the candidate commit and compared. | — |
| results-005/sonnet55-xhigh/4 | The Ansible layer mostly wraps `host.sh`; its value is the idempotence and checksum assertions. | Agreed; the Ansible layer's value is the idempotence and checksum assertions. | — |
| results-005/sonnet55-xhigh/5 | The case inventory is independent of the cloud layer, so the same scenario can later target the Colima aarch64 leg. | Agreed; the Linux aarch64 leg remains future work outside this goal. | — |
| results-006/fable/1 | GOAL.md has no risk-register section; the code's visible risks are handled in prose. | Same as results-005/fable/1. | — |
| results-006/fable/2 | The SonarQube slot covers `packages/`, so for a change confined to `conformance/accounts` it reports not-applicable. | Same as results-005/opus55-xhigh/2. | tooling friction 9 |
| results-006/fable/3 | The fixture has not run under a real identity, and post-provisioning fixes, reruns and the teardown audit will need review beyond the two-round results budget. | Agreed. Post-provisioning fixes will need verification within the two-round budget, and if that is not enough, the scope decision returns to the planner as the amendment requires. | references/final-review-scopes.md |
| results-006/fable/4 | The Linux cloud leg is a self-contained deliverable that could have been reviewed and landed separately. | Agreed; the final review now treats the cloud leg as its own unit. | references/final-review-scopes.md |

## Trajectory

### Was the thing built valuable?

Not yet proven. The fixture is complete in code and reviewed, but its value is the cross-account evidence it produces, and nothing has run under real accounts on either platform.

### What did it open?

A reusable account fixture for the range-registry work, a Linux aarch64 leg on Colima using the same case inventory, and a repeatable disposable-VM pattern for Linux x64 tests.

### What would you do differently?

Write the privileged trust model before the first admin script, read platform group and account behaviour before encoding it, and batch fixes before re-staging packets the owner must act on.

### Did a stop clause fire?

<!-- Name any stop clause in GOAL.md that fired (a written stop-and-ask condition, a hard round cap reached with an unresolved major), the cited pause it produced, and the decision it waited on. If none fired, say so in one line. -->

The provisioning checkpoints fired four times as cited pauses (the September 24 setup packet, the September 26 cloud activation packet, and two refreshed packets on October 3). Each waited on the owner's macOS administrator step and cloud approval, and both are still withheld pending the final review.
