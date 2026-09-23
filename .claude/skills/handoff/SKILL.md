---
name: handoff
description: Create a structured session handoff so a fresh Claude Code session can pick up immediately — deep conversation mining with self-validation, not a freeform summary. Use whenever work is pausing or wrapping up ("do a handoff", "save session progress", "wrap up for today", "end of day", "pausing for review", switching machines or sessions), when context is running low and there's real conversation history to mine, or before a compact — even if the user never says "handoff".
argument-hint: '[optional reason, e.g. "context low", "end of day", "pausing for review"]'
---

# Session Handoff

Provenance and upstream comparison: `references/attribution.md`. Chain
tracking uses the goal/loop-folder shape this repo already has, not a
separate ticketing tool.

**Guards:**

- **Not plan mode.** This skill writes files. If in Claude Code plan mode,
  exit first.
- **Not shadowing.** Never write a handoff-like document freeform outside
  this skill. Freeform summaries look right but skip chain tracking,
  self-validation, and evidence mining.
- **Not when merely discussing.** Don't create a handoff for questions
  about handoffs ("what does handoff do") or edits to an existing one.
  When work is clearly pausing, wrapping up, or a compact is imminent,
  proceed even without the word "handoff" — that's exactly what the
  description triggers on. If it's genuinely ambiguous whether the user
  wants one created now, ask first.

`$ARGUMENTS` is a soft hint for framing, not a substitute for mining the
actual conversation — extract maximum value before closing, don't just jot
a summary.

## Where a handoff lives

**ONE location, always: `.evie-kit/handoffs/`** at the repo root —
`.evie-kit/handoffs/handoff-<YYYYMMDD-HHmmSS>-<slug>.md` (datestamp
first, matching the draft-folder convention). No goal-folder branch, no
`.claude/` fallback: whether a goal is active changes what the handoff
SAYS, never where it goes.

Why the evie-kit runtime owns the directory (EVA-41):

- **Gitignored, and the runtime guarantees it.** `evie-kit setup` and
  `evie-kit upgrade` ensure a `handoffs/` rule in
  `.evie-kit/.gitignore`, so handoffs are invisible to `git status`
  and can never be swept up by a stray `git add -A`. Handoffs are
  machine-local ephemera; durable rationale belongs in `RESULT.md`, an
  ADR, or the tracker issue — reference those, don't duplicate them
  here.
- **Not `.claude/`**, which is Claude Code's namespace — writing
  runtime-managed artifacts into (and gitignoring) another tool's
  directory breaks the day that tool redefines it. `.evie-kit/`
  already has this exact shape: committed `settings.ts` beside
  gitignored `settings.local.*`.
- **Per-worktree by construction.** Inside a goal worktree the path
  resolves to THAT worktree's own `.evie-kit/handoffs/`, and the
  worktree copy engine excludes the directory by shipped default — a
  new worktree starts empty and writes its own chain.

Chain tracking is unaffected: the chain tag still comes from the active
goal/loop-folder slug (Step 2), it is just no longer the directory.

## The frontmatter identity contract (EVA-73)

Every handoff OPENS with snake_case YAML frontmatter identifying who
wrote it and under how much context pressure — the shared directory has
concurrent cc/codex writers, and identity is what keeps their files
distinguishable (and lets the PostCompact hook stamp the right one):

- `session_id` — the writing session's own id (`$CLAUDE_CODE_SESSION_ID`
  for Claude Code sessions).
- `session_name` — the herdr agent name, when one exists
  (`$EVIE_KIT_SESSION_NAME`, injected at launch by `goals execute`).
- `written` — ISO-8601 timestamp of the write.
- `context_used` — context tokens in use at write time (a watchdog
  nudge quotes the exact value; otherwise `evie-kit handoff identity`
  reads it from the session's own transcript).
- `compacted_at` — NEVER hand-written: the PostCompact hook stamps it
  mechanically when a compaction completes, closing the handoff as the
  record of that cycle.
- `supplements` — safety-net captures only, written by the PreCompact
  hook itself: the mined handoff this capture is a tail delta of (see
  the safety-net section below). Never hand-written either.

`evie-kit handoff identity` prints the whole block filled in — copy
its output. Fields that don't resolve are omitted, never placeholders.
The CONTRACT is agent-neutral (codex handoffs adopt the same fields);
the command is the Claude Code convenience.

## The PreCompact safety net (one implementation, two wirings)

A PreCompact hook writes an automatic safety-net handoff before Claude
Code compacts context — raw git/goal state plus the `/compact` argument,
not a substitute for this skill's mining pass.

**The capture supplements the mined handoff, it never stands beside it
as a peer (EVA-73 addendum).** When a mined handoff resolves for the
compacting session — newest file whose frontmatter `session_id` matches
(un-stamped current-cycle files outrank ones a prior compaction already
closed; sibling safety-net captures are excluded), falling back to the
`compact-ready.json` marker's named handoff — the capture stamps a
`supplements: <path>` frontmatter key, opens with a loud banner ("The
mined handoff for this session is X — read it first"), and frames its
commits section as the TAIL DELTA since that handoff's `written`
timestamp. A newest-first reader who lands on the thin capture is
redirected instead of stranded — the exact "newest handoff" concurrency
bug this goal exists to kill. The standalone snapshot shape survives
ONLY when nothing resolves (the true safety-net case: no mined handoff
was ever written).

The implementation is
`@evie-kit/handoff`'s `precompact` command; there are exactly TWO
sanctioned wirings of it in `.claude/settings.json` (EVA-14), matching
where the repo sits:

- **The evie-kit checkout itself** wires the DIRECT SOURCE PATH —
  `bun packages/handoff/src/precompact-handoff.ts` — deliberately: the
  safety net must fire even in a fresh worktree where `bun install`
  never ran, so it cannot go through node_modules.
- **Every other project** (wired by `evie-kit setup`) invokes the
  linked package by path, anchored on the project root —
  `bun "$CLAUDE_PROJECT_DIR/node_modules/@evie-kit/cli/src/evie-kit.ts"
handoff precompact` (hook commands run through a shell from the
  SESSION's cwd, which may be a subdirectory; the anchor keeps the
  safety net firing regardless) — the source path doesn't exist there.
  NEVER wire bare
  `bunx evie-kit …`: an uninstalled name falls back to the public npm
  registry (dependency confusion — `evie-kit` is not ours there).

**Toolchain guard (EVA-81)**: in a consumer project the linked path is
machine-local — git carries the hook WIRING, never the toolchain it
names. Check the ENTRYPOINT before concluding anything: when
`node_modules/@evie-kit/cli/src/evie-kit.ts` is itself absent, the
machine's bootstrap has not run and the repo is not broken — run it once
BY PATH (`bun /path/to/evie-kit/packages/cli/src/evie-kit.ts
onboard`); `EVIE-KIT.md` at the project root has the full bootstrap,
and under Claude Code setup's committed SessionStart preflight announces
the same thing at session start (that hook is a Claude Code mechanism;
other runtimes get the pointer file alone). A module-not-found naming some OTHER module while that
entrypoint exists is an ordinary dependency problem, not a missing
bootstrap — read which module the error names.

Both wirings run the same `run()`; output and location rules above apply
identically. The PostCompact record-closer (EVA-73,
`packages/handoff/src/postcompact-handoff.ts` / `evie-kit handoff
postcompact`) follows the SAME two-wiring rule, with one difference:
PostCompact matches on `trigger` like PreCompact, and the record-closer
must run for auto and manual alike, so it wires as a single matcherless
entry. Since EVA-105 that hook has a THIRD job: after closing the
record it spawns a detached `evie-kit goals auto-continue`, which puts
the session back to work. Nothing about writing handoffs changes — but
it is why a compacted session now resumes on its own, and why the
handoff's quality decides what that resumed session knows. The guards
that can stand the nudge down (a cited legal pause, a locked goal, the
`execution.autoContinue` opt-out) live in the spawned verb; see the
goals skill's `references/executor-compaction.md`.

**Safety net vs watchdog — two hooks, two moments.** The PreCompact
hook fires AT compaction: the decision to compact is already made
(auto or manual), and the hook captures raw state so the next turn has
orientation. Its before-compaction sibling is the CONTEXT WATCHDOG
(EVA-68, `packages/goals/src/context-watchdog.ts`, wired on Stop +
PostToolUse): it reads real usage from the transcript and, past the
`execution.compaction` thresholds, drives THIS skill — a soft-threshold
note asks for a mined handoff at the next stopping point; a
hard-threshold Stop fire blocks and forces the mining pass immediately,
then the outside hand (or the user, for an orchestrator session)
compacts referencing it. When both fire in one cycle, that is by
design: the watchdog produced the good handoff BEFORE compaction; the
safety net still captures the `/compact` argument and final state at
the moment itself.

## Step 1: Gather state

Run in parallel, inline Bash (cheap — never spin up agents for this):

```bash
git log --oneline -20
git diff --stat
git status -s | head -30
git branch --show-current
```

Also: `ls .evie-kit/handoffs/` to find prior handoffs in this chain.

## Step 2: Chain detection

**Resolve the chain tag:** the goal/loop-folder slug if one exists (e.g.
`ABC-1-some-goal-slug`, or a still-draft
`YYYYMMDD-HHmmSS-{slug}`), else `standalone-<7-char-hex>` (generate
with a quick random-hex one-liner).

**Find the prior handoff in this chain**, two tiers, stop at first match:

- **Tier A — explicit pointer.** Did the user start this session by pointing
  at a specific prior handoff file? That's the parent; read its header,
  continuation seq = parent's + 1.
- **Tier B — folder scan, FILTERED BY CHAIN TAG.** Every chain in this
  checkout shares one directory, so the globally-newest file is routinely
  someone else's work — another goal, a standalone session, an automatic
  PreCompact capture. Walk `ls .evie-kit/handoffs/*.md` newest-first,
  read each one's `**Chain:**` header, and take the newest file whose tag
  MATCHES the tag resolved above; a non-matching file (or one with no
  chain header, as safety-net captures have) is skipped, never a reason
  to stop searching. Then **confirm** the match by reading its "Where
  We're Going" section before claiming continuation: is this session's
  work a direct follow-on of those named next-actions? If clearly yes,
  inherit the chain and increment seq. If unclear or unrelated, treat
  this as seq 1 of a fresh sub-chain and note the sibling file for
  reference only, not as parent. If genuinely ambiguous, ask the user.

No match in either tier: seq 1, parent none.

## Step 3: Read the parent (mandatory if one exists)

If a parent handoff exists, **read it in full** before mining the current
conversation — extract its Goal, Where We Are, Key Decisions, What We Tried,
Where We're Going, Open Questions, and any named identifiers (file paths,
function names, package names). "Since Last Handoff" in the new handoff
requires comparing what was planned against what actually happened.

**Stale-reference check:** grep each identifier named in the parent against
the current codebase. Flag any that no longer resolve — renamed files,
deleted functions, moved packages. This is cheap and catches drift a naive
summary would silently miss.

## Step 4: Mine the conversation

Choose a mining pass based on how much history there is to cover, and
**announce which one and why** before starting — the announcement makes
the choice auditable in the transcript and gives the user their one chance
to upgrade Quick to Deep before mining begins, not after:

| Pass  | When                                | Approach                                                                                                                                                   |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick | Short session, little tool activity | Single pass over the extraction checklist below                                                                                                            |
| Deep  | Long session or many tool calls     | Two passes: first pass captures structure (goals, decisions, files touched), second pass fills in specifics (numbers, exact errors, rejected alternatives) |

**Extraction checklist** (apply per pass — this is where the value is; don't
skim):

- Goal and objective (what this session/goal is actually trying to achieve)
- Work completed — every file modified, with specifics, not just filenames
- Approaches tried, in order — both what worked and what didn't
- Failed approaches and _why_ — the single most expensive thing to
  re-discover if omitted
- Test results and measurements — raw numbers, not "tests passed"
- Decisions made and rejected alternatives, with rationale
- Discoveries and gotchas (the CLAUDE_CODE_TASK_LIST_ID-style surprises)
- Any `CONTEXT.md`/ADR artifacts touched (cross-reference `domain-modeling`)
- Open questions and things explicitly deferred
- Dependencies on other in-flight work (other goals, other worktrees)

## Step 5: Write the handoff

Read `references/output-template.md` for the section structure. Write the
whole thing in **one** `Write` call covering every section — this is the
baseline, not a rough draft to flesh out later. Open the file with the
frontmatter identity block (run `evie-kit handoff identity` first —
see "The frontmatter identity contract" above; a watchdog nudge already
quotes your `session_id` and `context_used`, use those values).

**Then do a gap pass:** read the file back, scan the conversation again
specifically for anything the first pass under-captured (a table you
skipped, a measurement mentioned without its number, an approach named but
not detailed), and `Edit` it in. Don't skip this pass just because the first
one felt thorough — REMvisual's own evidence is that first passes
systematically under-mine detail.

**Don't duplicate what already exists elsewhere.** If a decision is already
captured in a GOAL.md, an ADR, a Linear ticket, or a commit message,
reference it by path/URL instead of restating it.

**Redact secrets.** No API keys, tokens, passwords, or PII — this document
may itself become a future session's prompt.

## Step 6: Self-validate

Read `references/validation.md` and run every check listed there. If
anything fails, expand the thin section before proceeding — don't hand off a
handoff that fails its own checklist.

Then fill in the handoff's `## Self-Check` section (last section in the
template) — what the trace records, and the honesty rules for writing it,
are specified once in `references/output-template.md`'s Self-Check block;
follow that spec exactly rather than reconstructing it from memory. The
trace is what lets a future reader (or a reviewer of the handoff practice
itself) distinguish a mined-and-verified handoff from a freeform summary
that merely looks like one.

## Step 7: Report

Tell the user, concisely:

- File path and line count
- Chain info (tag, seq, new chain vs continuation, parent link if any)
- Any stale references found in Step 3
- Self-check outcome
- The single most important next action

## Step 8: Ask what happens next

End with an `AskUserQuestion` picker — this is a lifecycle seam with a
closed set of legal next steps, so never prose like "say the word".
Grill-me's standing "Go Deeper" rule applies additively here
(`grill-me/SKILL.md`, "The standing 'Go Deeper' option"): with a slot
free after the options below, the last slot carries `Go Deeper`; a
full set uses the announced free-text fallback. Recommended option
first:

- **Compact now, keep working** _(recommended when the handoff was
  triggered by context pressure)_ — the handoff file is exactly the
  post-compaction orientation the next turn needs. On a herdr-hosted
  session that **nothing is watching** (no live
  `.evie-kit/handoffs/watch.pid` — a watched executor signals
  `compact-ready.json` instead; the two flows are ALTERNATIVES, never
  both against one pane), ARRANGE it yourself (EVA-73): spawn the
  detached helper, substituting the exact path Step 5 wrote —

  ```bash
  # <HANDOFF> = the exact .evie-kit/handoffs/… path written in Step 5
  # A GOAL EXECUTOR passes its key — that is what selects the /goal
  # re-arm continuation instead of the plain pointer line:
  evie-kit goals self-compact --handoff <HANDOFF> --goal <KEY>
  # An orchestrator or hand-started session (no goal) omits it:
  evie-kit goals self-compact --handoff <HANDOFF>
  ```

  — it preflights the pane in the foreground (a refusal is printed to
  you, never buried in a log; your own pane is found via the ambient
  `HERDR_PANE_ID`/`HERDR_SESSION` env, EVA-124), then detaches: types
  the `/compact` citing that SPECIFIC file into this pane and
  IMMEDIATELY queues the continuation — Claude Code holds queued input
  through the compaction and delivers it after, so work resumes
  unattended with nothing gating the sends. The detached worker then
  lingers up to `--compact-timeout` (default 10m) holding its
  per-session lease — a report-only observation window during which a
  second `goals self-compact` for this session refuses with "already
  driving"; pass a smaller `--compact-timeout` to shorten it. If it refuses (not a herdr-hosted pane), hand
  over the paste-ready command instead, fully substituted — the ACTUAL
  filename you just wrote, never a placeholder and never "the newest
  handoff" (concurrent writers share the directory):

  ```text
  /compact Preserve in the summary, verbatim: the handoff path .evie-kit/handoffs/handoff-20260728-204911-<slug>.md (the resume anchor). After the summary, re-read that handoff (its "Where We're Going" section above all) and continue the work it describes; do not re-explore what it already records.
  ```

  This is `pasteReadyCompactCommand`'s shape (EVA-125's split-semantics
  family, the standalone form: no continuation follows a manual paste,
  so the one line carries the summarizer's preservation duty AND the
  resume duties — see the goals skill's
  `references/executor-compaction.md`, the role-keyed guidance bullet).

- **Clear and re-point (a reset, not a compaction)** — `/clear` this
  session and re-bind a fresh one to the handoff you just wrote, via
  `evie-kit goals self-compact --strategy reset --handoff <HANDOFF>`.
  What it buys: a single AUDITED source of truth (this handoff went
  through mining, a gap pass, and self-validation; a `/compact` summary
  goes through nothing), instant deterministic mechanics, and zero
  summary drift.

  **State what it DROPS in the option's own description, so the choice
  is knowing** — everything the handoff did not capture, because there
  is no summary safety net behind a reset (the PreCompact hook does not
  fire on `/clear`), plus session identity: the session id rotates, the
  `/goal` binding dies with the conversation and is re-issued from a
  regenerated resume file, and anything keyed to the old session —
  in-flight monitors, standing orders, leases — does not come back. If
  the handoff's gap pass was thin, DO NOT offer this option; offer the
  compaction instead.

  Available only to a session whose root carries a recorded launch
  instruction — a goal executor. An orchestrator or hand-started
  session has no contract to re-issue, so the verb refuses loudly: a
  `/clear` there would leave the pane with no standing orders at all.
  The full mechanic, its live `/clear` verifications, and the
  contract-normative/handoff-positional rule live in the goals skill's
  `references/executor-compaction.md`.

- **Close the session** — commit current work, mark the handoff closed,
  and output a pointer for the next session.
- **Draft a goal from this handoff** (EVA-226) — offered ONLY by an
  INTERACTIVE session (the orchestrator, or a hand-started session):
  the same sessions for which "Clear and re-point" refuses, so the
  rendered set stays at four; an executor's handoff never offers it,
  because interactivity brackets execution. Choose it when "Where
  We're Going" is work the lifecycle should own rather than the next
  turn of this checkout. Distill the handoff into a description file:
  Where We're Going as the ask; the rejected approaches from What We
  Tried and Key Decisions as explicit anti-goals ("do not retry X,
  because Y"); Open Questions carried over verbatim so they land in
  the draft's open-questions section. Then run the goals skill's
  intake with it —

  ```bash
  evie-kit goals draft --slug <slug> --title "<Title Case>" \
    --description-file <that file>
  ```

  — which captures the description byte-for-byte as the draft's
  `references/intake.md` and flows straight into the first grill
  question. The durable plan is then a `GOAL.md` in the lifecycle, not
  a plan file in this gitignored directory; the handoff stays the
  machine-local record the draft cites. (The handoffplan mode below is
  the machine-local alternative: a plan the SAME checkout executes
  next, never reviewed.)

- **Keep working, no compaction** — stay in this session as-is.

Default to committing on "close the session" unless the user says
otherwise.

**Per-runtime delivery (EVA-212).** On Claude Code the four options fit
one `AskUserQuestion` (full — the briefing announces the free-text
depth escape). On Codex (`request_user_input`, 2–3 options per
question) the same set splits into two questions. The primary carries
_Compact now, keep working_ / _Clear and re-point_ / _Close the
session_. A secondary "More options" question carries _Keep working, no
compaction_ beside `Go Deeper` — every option reachable, nothing dropped
(the goals skill's `references/codex-seams.md`). "Compact now" on a Codex
orchestrator arranges the SAME detached self-compact helper, which
types the Codex TUI's `/compact` into the pane. Its completion evidence
is the PreCompact/PostCompact hook pair with `trigger: "manual"` and
the rollout log's `compacted` record (EVA-212 checkpoint 0). A "None of
the above" note is free text, never a choice.

**STATED LIMIT — the skill cannot compact for you.** `/compact` and
`/clear` are user-typed slash commands with no tool equivalent: there is
no API this skill (or any hook it wires) can call to invoke them from
INSIDE the session. What a session CAN do since EVA-73 is ARRANGE the
typing from outside: spawn the detached self-compact helper (above),
which is its own process and survives both the harness's background-task
reaping and the compaction itself. The same helper types the `/clear`
under `--strategy reset` (EVA-89) — a session cannot clear itself any
more than it can compact itself; it arranges the hand that does. The PreCompact hook remains the
at-compaction complement (raw safety-net capture, not a mined handoff),
and its PostCompact sibling closes the record afterwards — stamping
`compacted_at` into this session's handoffs and writing the
`compact-done.json` completion marker. Since EVA-124 the helper does
not wait on that marker to type the continuation (it queues it through
the compaction); the marker remains the durable completion record other
flows read.

**The OUTSIDE HAND exists, though (EVA-47)**: for a goal executor
running under herdr, `evie-kit goals compact <KEY>` types the
`/compact` into the executor's pane from outside — it prompts this
skill's mined handoff first (default) and passes the handoff path in the
compaction instructions, so native compaction preserves what the goal
needs. The goals skill's `references/executor-compaction.md` owns the
cycle, the `execution.compaction` soft/hard token thresholds, and the
readiness signal (`.evie-kit/handoffs/compact-ready.json` — written
after the mined handoff at a soft-threshold milestone; summarized in
that skill's "Executor compaction" section). An executor at such a
milestone writes the handoff via this skill and signals; it still never
compacts itself — the watched-executor flow and the self-arranged
helper are ALTERNATIVES: signal the marker when a `goals watch` is
armed for your goal, spawn `goals self-compact` when nothing is
watching (the orchestrator's case).

**Context-pressure compaction SKIPS Step 8.** When this skill runs
because compaction is the known next step — the `goals compact` prompt
says it is imminent, a WATCHED executor is writing its soft-threshold
readiness handoff, or a WATCHDOG nudge (soft or hard, either role)
forced the mining pass — do NOT end with the Step 8 picker: a pending
`AskUserQuestion` parks the pane `blocked`, an outside hand's typed
`/compact` would land in the dialog instead of the composer, and for a
watchdog-nudged session the parked picker IS the human-in-the-middle
gap EVA-73 closes (results-001 codex #1). What ends the flow instead
depends on who acts next:

- **A watcher is armed** (live `watch.pid`, or the `goals compact`
  prompt itself): write the handoff, write the readiness marker
  (`compact-ready.json` naming it), and stop — the outside hand does
  the rest.
- **Nothing is watching** (the orchestrator's case, or an unwatched
  executor): write the handoff, then in the SAME turn spawn
  `evie-kit goals self-compact --handoff <that exact path>` — no
  marker (nothing consumes it), no picker; the helper's continuation
  resumes the work.

The picker remains for ordinary user-initiated handoffs, where what
happens next is genuinely the user's choice.

## Escalation: handoff + plan ("handoffplan" mode)

If the user asks to turn this handoff into an executable plan for the next
session — trigger phrases like "handoffplan", "make this into a plan",
"plan this out and hand off" — read `references/handoffplan.md` and follow
it: the full handoff above still happens first, unabridged; the mode adds
a paired plan file, a surgical commit, a ready-to-paste next-session
prompt, and always closes the session.
