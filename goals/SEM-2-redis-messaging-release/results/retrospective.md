---
goal: SEM-2
frames: [plain]
written: 2026-09-23T18:06:08-05:00
schema: 1
---

# SEM-2 Retrospective: Add Redis Messaging to the Release Line

<!-- The executor's pre-lock retrospective (EVA-238). Process learnings about
     HOW the work went — tooling friction, instruction gaps, convention
     collisions, wasted turns — never the work items themselves (those are
     RESULT.md's Follow-ups). `evie-kit goals retrospective check <KEY>` must
     pass before the locking commit; the routed candidates reach the lock
     report and the merge briefing, where the orchestrator turns them into
     planning requests. -->

## Routed learnings

<!-- Process learnings, one row each. ROUTE every row:
       convention-skill-candidate  — should change how future goals run
                                     (a convention file, a skill, a template);
       evie-kit-change-candidate   — should become a draft/issue against evie-kit
                                     (a verb, a refusal, the harness, a review engine);
       one-off                     — record only (Target may be —).
     Candidates name a Target: the file/skill/convention, package/verb, or issue key.

     Ask yourself about the TOOLING this goal was executed WITH, not just the work:
       - Which evie-kit verb or refusal fought you, and what should it have done?
       - What did the harness (the /goal contract, the watch, compaction, the guard)
         get wrong or make slower?
       - What instruction, convention, or template was missing or misleading?
       - Which turns were wasted, and what would have prevented them?

     A small goal with nothing to route writes the single line "No process learnings."
     in place of the table. Keep it honest: this record is committed BEFORE the
     final review round, whose reviewers read it and may contradict the floor
     from the diff, and the merge briefing carries what it routes. Because that
     round reads this table BLIND, rows name tooling and process gaps and never
     cite an earlier round's findings, reviewers, or dispositions; which engine
     earned its keep belongs under the computed section below, not here. -->

| # | Learning | Route | Target |
| --- | --- | --- | --- |
| 1 | Public contributor commands need validation without machine-local toolkit links; executor checks should remain separate. | convention-skill-candidate | CONTRIBUTING.md release checklist |
| 2 | Source extraction needs a semantic pass over retained prose, beyond link/privacy lint, because appended feature docs can contradict old paragraphs. | convention-skill-candidate | goals release-extraction template |
| 3 | Committed Sonar properties and machine-local overrides should expose scope disagreement before an expensive scan. | evie-kit-change-candidate | lint explain and Sonar preflight |
| 4 | npm ci removes machine-local toolkit links; supported repair restored them but also ran unrelated credential integration checks. A link-only repair would reduce friction. | evie-kit-change-candidate | onboard repair workflow |
| 5 | Immutable source-named archive directories made a second candidate safe: earlier bytes stayed intact while fixes received fresh identities. | one-off | docs/releases.md |
| 6 | A compaction-ready handoff did not itself authorize an early turn end; the stop hook correctly required execution to continue. Keep milestone handoffs separate from completion claims. | convention-skill-candidate | goal and handoff executor instructions |

## Reviewer feedback quality

<!-- reviewers:begin (computed — refresh with `evie-kit goals retrospective refresh <KEY>`) -->
Computed by `evie-kit goals retrospective reviewers` from the reconciled merged-findings tables of results-004 (20 merged findings).
Coverage gaps — reconciled as prose, not counted: goal-001, goal-002, goal-003.

| Engine | Rounds | Model(s) | Raised | Accepted | Rejected | Unique accepted |
| --- | --- | --- | --- | --- | --- | --- |
| claude-code | 1 | claude-opus-5-5 | 13 | 13 (100%) | 0 | 8 |
| fable | 1 | claude-fable-5-1 | 10 | 9 (90%) | 1 | 2 |
| coderabbit | 1 | — | 3 | 3 (100%) | 0 | 0 |
| codex | 1 | — | 3 | 3 (100%) | 0 | 2 |
| sonarqube | 1 | — | 0 | 0 (—) | 0 | 0 |

Unique accepted = accepted findings no other engine raised: the earning-its-keep signal. An engine with zero unique accepted findings across the goal returned only what the others would have caught anyway.
Zero unique accepted this goal: coderabbit.
<!-- reviewers:end -->

<!-- Add one or two sentences of judgment under the numbers: which engine's
     findings were worth acting on, whether a model ramp changed what was
     caught, and whether a subscription engine earned its keep on THIS goal. -->

The independent engines contributed different checks, including focused behavioral probes and public-contributor validation. Their overlap made the recovery and history-cost problems easier to prioritize; the computed table below covers the reconciled round, with the additional AGENTS Codex review attributed explicitly.

## Trajectory

### Was the thing built valuable?

The candidate now joins the existing local messaging API with a native-free Redis transport and records reproducible source and portable artifact identities. It remains pre-merge evidence; publication requires the owner’s final source and archive checks.

### What did it open?

The release handoff makes separate OS-account validation and unported observer-fencing work visible. Those are follow-up decisions outside this messaging candidate, not implicit passing tests.

### What would you do differently?

I would check retained prose and public contributor commands earlier, and exercise long outages and worst-case encoded text before assembling the first archive set. I would still preserve every archived source identity and use independent blind review before locking.
