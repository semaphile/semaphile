# Goal artifact templates

Format specs for the artifacts the lifecycle produces beyond the
frontmatter and `MAP.md` templates already in SKILL.md /
`references/wayfinder.md`. Read the relevant section before writing the
artifact. Each template says whether it is **generated** (code writes
this exact shape — never hand-invent a divergent one) or **convention**
(assembled by the agent; the shape below is what every real goal folder
on main follows).

Contents: [GOAL.md body](#goalmd-body) ·
[results/RESULT.md](#resultsresultmd) ·
[results/GATES.md](#resultsgatesmd) ·
[Results-round INDEX.md](#results-round-indexmd) ·
[Goal-round BRIEF.md](#goal-round-briefmd) ·
[Goal-round CRITIQUE.md](#goal-round-critiquemd) ·
[Goal-round INDEX.md](#goal-round-indexmd) ·
[Tracker issue body](#tracker-issue-body)

## GOAL.md body

**Convention** (verified against `@evie-kit/goals`' `createDraft`,
which generates only the H1 — everything below it is authored during
drafting/refinement):

```markdown
# {Title Case title, 35–50 chars, in the goal TYPE's grammar — verb-first for feat/docs/research/chore, the stated symptom for bug (EVA-145) — same rules as the tracker issue title it becomes}

## Problem

{Why this goal exists: the defect, gap, or opportunity, with pointers
to evidence (audit findings, prior goals, code). If this goal
supersedes drafts or references locked goals, say so here.}

## Scope

{What to build/change, concrete enough for a fresh executor session.
Split into `### Workstream X — name` subsections when there are
independent chunks; number the steps inside each.}

## Green gates

{Numbered list — THE definition of "done", authored at drafting time
(lifecycle step 7 gates on these). Each gate must be checkable by the
executing session itself: a measurable state ("body under 500 lines",
"no pass-rate regression"), a passing tool run, or a completed review
wave. The blind multi-tool review wave is the default final gate for
coding goals.}

{Write every gate under the project's goal-conditions convention
(`.evie-kit/conventions/goal-conditions.md`, EVA-227): a true/false
predicate about finished work, never an imperative, with its proof
named inline — the `/goal` evaluator judges from the transcript alone.
Copy that file's "Standing gates for this project" section in as
gates of their own, then add the goal's specific ones, its stated
constraints as predicates, its non-goals, and a stop clause.}

{The STANDARD LINT GATE for a coding goal (EVA-209, decision 6) reads
exactly this formula — copy it, never a looser paraphrase:
"Workspace typecheck passes AND the fast tier passes (`bun run lint`:
every `tools.lint` root green, no network) AND the deep requirement is
satisfied — exactly one of valid `passed` Sonar evidence for this
head, a validated `not applicable` (the change set touches nothing in
the effective Sonar scope; fast tier only, no deep coverage claimed),
or a recorded user waiver (`evie-kit lint waive`, disclosed, never
green). `evie-kit lint gate` runs the whole formula and writes the
receipt (exit 0 green, 3 waived — a fast-tier failure is never cured
by a Sonar waiver; an outage is 4, temporarily skipped, and blocks
the lock); `evie-kit lint eligibility` decides whether the head being
locked is still covered (descent plus nothing exercised changed, not
sha equality)."}

## References

{Pointers the executor will need: prior goals' artifacts, research
docs, vendored specs. Reusable research belongs in project-level
`docs/research/`, linked from the goal's `references/INDEX.md`.}

## Executor notes (self-sufficiency)

{Everything a fresh session needs that isn't derivable from the repo:
setup steps, credentials location, known gotchas from prior waves,
commit/branch conventions, the completion procedure. GOAL.md must be
self-sufficient — this section is where that promise is kept.

Always include the goal's diff base: "Review-wave diff base: `main`" —
or, for a stacked goal, "Review-wave diff base: `<stacked_on parent>`
(this goal stacks on it; waves diff `<parent>...HEAD`, never the
parent's own changes)". The wave driver derives BASE from the
`stacked_on` frontmatter; this line makes the executor expect it.}
```

## results/RESULT.md

**Convention** (the shape every completed goal's RESULT.md on main
follows):

```markdown
# {ISSUE-KEY} Result: {Goal Title}

## What changed

{Narrative of the work actually done: commits (hash + subject), files,
and the why behind non-obvious choices. Written for the next goal's
executor and the map-level reformulation pass — record friction and
surprises, not just outcomes.}

## What did NOT need changing

{Scope items that turned out already-done or unnecessary, with the
evidence — prevents the next session from re-deriving the same
conclusion. Omit if empty.}

## Gate {N} — {gate name, one section per green gate, in GOAL.md order}

{Evidence the gate passed: real numbers, command output summaries,
links to committed artifacts (benchmarks, review INDEX.md). The
mechanical receipt — exact command, exit code, counts, timestamp,
commit hash — lives in `results/GATES.md` (EVA-79); this section
carries the narrative around it. A gate
that was adjusted or waived is recorded here with the user decision
that authorized it — never silently.}

## Changelog entry

{The changelog-ready distillation (EVA-160, on repos where the
versioning regime is armed — `.evie-kit/conventions/versioning.md`
exists): 2–4 bold-lead paragraphs (`**X.** detail`) written to land
VERBATIM as the release entry's body when the driver merges — what
shipped and why it matters to a consumer of the toolkit, never
process narrative. Append a `**Migration:** …` paragraph when a
consumer or agent must act on upgrade (`**Migration:** none
required…` records the explicit no-action case; omit the paragraph
entirely when there is nothing to say). On an armed repo
`goals merge` REFUSES a landing whose RESULT.md lacks this section
(the no-entry-no-merge check) and appends it to CHANGELOG.md under
the release's section at the seam. Unarmed repos omit this section.}

## Follow-ups

{Anything surfaced but out of scope — candidate new goals, each
referencing this one. Omit if none.}
```

## results/GATES.md

**Convention** (EVA-79) — the executor's gate-evidence receipts: one
entry per green gate, appended as gates run and finalized during the
completion sequence. Commit the file BEFORE spawning the review wave —
interactive reviewers review ephemeral worktrees cut from HEAD, so an
uncommitted receipts file is invisible to them, and a gate claim with
no receipt is itself a reviewable finding. Reviewer prompts link this
file with calibrated trust (coherence checks; cheap spot-reruns only;
service-dependent gates get evidence review only — reviewers never
launch services):

```markdown
# {ISSUE-KEY} Gate evidence

Receipts for `{goal-folder-name}`'s green gates, in GOAL.md order.
Each receipt records the run the executor actually made — never a
reconstruction after the fact.

## Gate {N} — {gate name}

- Command: `{the command; secret VALUES replaced by their env var names}`
- Exit code: {integer}
- Headline: {the run's key counts — "412 pass, 0 fail", "0 errors",
  "lint clean" — enough for a reviewer to judge plausibility. For a
  REVIEW-WAVE gate that is the roster and the completion count, never
  the finding counts (EVA-97): those belong behind the Evidence
  pointer, for the same blindness reason the WAIVER shape states
  below.}
- Timestamp: {ISO 8601, when the run finished}
- Tested commit: {hash of the commit the gate ran against}

## Gate {N} — {gate name} (NOT GREEN — {one-line disposition})

- Command: `{the command; secret VALUES replaced by their env var names}`
- Exit code: {the NONZERO integer}
- Headline: {what actually happened — "3 fail, 1 pre-existing"}
- Timestamp: {ISO 8601}
- Tested commit: {hash}
- Disposition: {why this is not a blocker, in one or two sentences —
  a pre-existing failure proven against the base, an environment
  dependency this machine lacks, a user decision that authorized it}

{A gate that RAN and exited nonzero takes this shape (EVA-97). The
heading says NOT GREEN and the disposition is mandatory: a receipt
whose exit code is 1 sitting under a heading that reads green asks a
reviewer to trust a claim the numbers below it contradict, and that is
the receipts file failing at the one job it has. A gate that is not
green and has no disposition is not a receipt — it is an unfinished
gate.}

## Gate {N} — {gate name} (WAIVER)

- Status: {in-flight | waived | not mechanically runnable}
- Evidence: {where it lands or lives — the wave's reconciled INDEX.md
  path, the recorded user decision — as a POINTER only}

{A gate the executor could not run mechanically — a review wave in
flight, a user-waived gate, a process gate with no command — takes
this shape instead. It is a WAIVER, not a missing receipt, and those
three fields are all of it: never summarize what a prior review round
FOUND. Reviewers are blind to earlier rounds' findings, and this file
is the one thing they read inside `results/` — a summary here reaches
them through the single hole in the blindness wall. The pointer is the
whole answer; its contents are not this round's business. The review
wave's own entry is finalized at completion, after its INDEX.md
reconciliation.}
```

**Never commit a secret.** The receipts file is durable, committed,
and read by every reviewer, so a command is recorded in its
reproducible SHAPE — inline credentials, tokens, signed URLs, and
connection strings are replaced by the environment variable names that
supply them (`SONARQUBE_TOKEN=… ` becomes `SONARQUBE_TOKEN`), never by
their expanded values.

**Tested commit, not receipt commit.** Committing the receipts moves
the head past the commit they record, so the recorded hash can never
equal the reviewed head — reviewers check ANCESTRY instead (the tested
commit is the head or an ancestor whose delta to the head touches
nothing that gate exercises, normally just this file). A gate re-run
after fixes gets a FRESH receipt (append or replace) describing the
latest run: the tested commit must be the last commit that changed
anything the gate exercises. Receipts left behind by later code
changes are exactly what reviewers' coherence checks catch.

## Results-round INDEX.md

**Generated** — `@evie-kit/goals`' `runReviewWave` writes this exact
shape into `reviews/results-{NNN}/` (a wave IS a results-kind review
round, EVA-30; the goal-kind round's INDEX template — promote-readiness
verdicts, typed blocks — is authored in the stacked
goal-critique-agent-loop goal, alongside the machinery that writes it);
the executing
session then EDITS the "Merged findings" section in place:

```markdown
# Review results-{NNN}

Blind multi-tool review wave for `{goal-folder-name}` ({ISO timestamp}).
Each reviewer ran as a labeled tab in the executing session's own herdr
workspace. Model/effort/args columns record per-reviewer provenance;
`(default)` means nothing was passed and the harness kept its own default.

{verdict line — one of:
"All reviewers completed." |
"All live reviewers completed; skipped (recorded, not silent): {tools}." |
"WAVE FAILED: {tool (status), …} — failures are reported, never
silently absorbed; rerun or reconcile explicitly."}

| Tool | Outcome | Findings | Model | Effort | Args | Detail |
| ---- | ------- | -------- | ----- | ------ | ---- | ------ |

{one row per tool in the wave: outcome status, FINDINGS.md link,
provenance, skip/failure detail — plus one terse row per tool ABSENT
from the wave (`not-configured` — no settings block, or its `stages`
exclude this round's kind (EVA-30); or `not-in-wave` when the driver
didn't pass `definedTools`): no findings link, rendering only, never
part of the wave verdict (EVA-11 enabled-only semantics)}

## Merged findings

{Generated as a "RECONCILIATION REQUIRED" placeholder. The wave is
not a passed gate until the executing session replaces it: read every
reviewer's FINDINGS.md, merge the findings, and record each one's
disposition (fixed / rejected-with-reason / deferred to a NAMED
follow-up issue — the key, not just "a new goal") by its own judgment
— no mechanical union or vote rule. SonarQube findings additionally
take their disposition ON THE SERVER (EVA-111, the close-out ratchet
in `review-waves.md`): fixed, or marked Accepted/False-Positive with a
comment carrying the goal key — a deferred one cites the follow-up
key, so no finding is left OPEN as its own record.}

## Gate evidence

{Also generated (EVA-79), filled in the same pass: one line per green
gate naming which reviewers re-verified it and which accepted it on
evidence, plus any receipt they judged missing or stale. Per-tool
FINDINGS.md files are machine-local and vanish with the worktree, so
this roll-up is the durable record of whether the gates were actually
re-run. Postures come only from the INTERACTIVE reviewers — the
headless engines never receive the audit contract, and record as not
applicable. Two placeholders replace the roll-up when it would be
meaningless: **NO GATE AUDIT IN THIS WAVE** when no interactive
reviewer completed (that wave proves nothing about the gates), and
**NO RECEIPTS TO AUDIT** when the pre-wave check found the receipts
missing from HEAD (the reviewers ran blind to the evidence, so the gap
itself is the wave's gate finding).}
```

## Goal-round BRIEF.md

**Generated** — `@evie-kit/goals`' `renderRoundBrief` (via
`runGoalReviewRound` / `goals goal-review round`) writes this exact
shape into `reviews/goal-{NNN}/BRIEF.md`; the `--brief`/`--brief-file`
body the main agent authors lands under "Update":

```markdown
---
round: { NNN }
timestamp: { ISO timestamp }
author: main-agent
---

# Round brief — goal-{NNN}

Main-agent brief to the goal critics of `{goal-folder-name}` — the
outbound half of the file-mediated loop, recorded beside the critiques
(committed under `goals.drafts.commit: true`; a plain on-disk record
until the promotion capture under the EVA-62 local default) so both
directions are auditable. Engines this round: {tools}.

## Update

{the main agent's body: what changed since the last round — grill
answers, GOAL.md edits — or the opening statement for round 1}

## Instructions to critics

{generated: re-read GOAL.md + this brief, write this round's critique
to `<engine>/CRITIQUE.md` per `<engine>/PROMPT.md`}
```

## Goal-round CRITIQUE.md

**Convention enforced by the generated PROMPT.md** — each critic writes
`reviews/goal-{NNN}/{engine}/CRITIQUE.md` to this contract (the round
machinery parses the frontmatter and fails a round on a missing
verdict; snake_case keys, as all frontmatter):

```markdown
---
agent: { tool }
model: { model or "(default)" }
reasoning_effort: { effort or "(default)" }
round: { NNN }
timestamp: { ISO timestamp, critic-written }
verdict: { ready_to_promote | not_ready }
findings: { OPTIONAL integer, EVA-45 — the count of distinct findings
this critique raises (plan holes/risks + open questions); feeds the
flat-series heuristic; absent is tolerated everywhere }
---

## Summary

## Plan holes and risks

## Green-gate checkability

{per gate: can the executing session itself check it?}

## Sizing sanity

## Open questions and grill suggestions

{candidate USER interview questions, sharpest first — deduped across
engines and routed by the main agent}

## Wayfinder signal

{none | consider-wayfinder | strongly-wayfinder, with why}

## Promote-readiness verdict

{restate the frontmatter verdict with the reasons driving it — never
leave this section empty; the frontmatter carries the machine-readable
copy, this section the rationale}

CRITIQUE COMPLETE
```

(The `CRITIQUE COMPLETE` marker is the exact last line — deliberately
distinct from the results-wave `REVIEW COMPLETE`, so one kind's
artifact can never satisfy the other kind's completion detection.)

## Goal-round INDEX.md

**Generated** — `renderGoalRoundIndex` writes this into
`reviews/goal-{NNN}/`; the main agent then EDITS the "Routed feedback"
section in place (the goal-kind counterpart of the results wave's
merged-findings reconciliation):

```markdown
# Review goal-{NNN}

Goal-review (pre-promotion critique) round for `{goal-folder-name}`
({ISO timestamp}). GOAL-kind contract (ADR 0004): dialogic,
spec-scoped, NON-blind — critics read the live draft worktree under a
read-only contract, see prior rounds, and stay open for follow-ups.
`BRIEF.md` is the main agent's recorded round brief (the outbound
half of the loop; committed per the draft-commit policy, EVA-62).

{verdict line — "All critics completed. Verdicts this round: …" |
"ROUND FAILED: {engine (status), …} — failures are reported, never
silently absorbed; rerun or reconcile explicitly."}

| Engine | Outcome | Delivery | Critique | Verdict | Model | Effort | Detail |
| ------ | ------- | -------- | -------- | ------- | ----- | ------ | ------ |

{one row per engine: outcome, delivery mode (spawned/nudged/respawned),
CRITIQUE.md link, promote-readiness verdict, provenance}

## Routed feedback

{Generated as a "RECONCILIATION REQUIRED" placeholder. The round is
not consumed until the main agent replaces it: dedup the typed blocks
across engines, route grill suggestions to the user (AskUserQuestion)
and wayfinder signals to the escalation picker, and record each
plan-hole's disposition — feedback reaches GOAL.md via the user's
answers, never silently auto-folded.}
```

When executing that routing, the explain-first rule applies
(`goal-reviews.md` invariant core rule 4): each relayed grill
suggestion carries the critic's reasoning — what breaks, why it
matters — in prose before the picker. (The generated placeholder
string itself predates this rule; updating `renderGoalRoundIndex`'s
emitted text is a package change, tracked as an EVA-36 follow-up.)

## Tracker issue body

**Convention** (assembled by the promotion step's `createIssue`
callback — `promoteGoal` hands it the parsed GOAL.md and a
commit-pinned permalink builder):

- The body **mirrors the GOAL.md body** section-for-section (Problem,
  Scope, Green gates, …) — it is the same spec on a shareable,
  team-visible surface, not a summary of it.
- Every pointer to a repo file becomes a **git permalink with the
  pushed head commit baked in** (the branch is pushed before the issue
  is drafted precisely so these resolve), rendered as inline Markdown
  links; external URLs stay plain links.
- The issue title is the GOAL.md H1: Title Case, 35–50 chars, in the
  goal type's grammar (verb-prefix for feat/docs/research/chore, the
  stated symptom for bug — EVA-145), plus any issue-title conventions
  the project's team keeps.
  the issue lands where the layered `.evie-kit` settings'
  `tools.tracker.*` block points (EVA-26): the Linear team/project of
  `tools.tracker.linear`, or the GitHub repo of `tools.tracker.github`
  — never a destination hardcoded in skill text. A team may keep a
  separate sandbox project for throwaway dogfood goals.
- After promotion the issue is the primary review surface (lifecycle
  step 4); GOAL.md remains the executable source of truth.
