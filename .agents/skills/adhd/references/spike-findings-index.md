# Spike findings index

The `adhd` skill's multiplexer branch-execution design (now the three
config keys `adhd.branchExecution` / `adhd.multiplexer` / `adhd.layout`;
originally a single `herdr-panes`/`herdr-tabs` `paneStrategy` string) was
built on four separate empirical spikes, run in this order. Each corrected
something the previous round assumed or got wrong. Full narrative accounts
for the first three live in the goal folder that produced this skill:

`~/src/divideby0/evie-kit/goals/EVA-1-goal-lifecycle-orchestration-workflow/references/agent-teams-tmux-spike-findings.md`

covering:

1. **Local `Task`-tool subagent observability** — corrected an initial wrong
   claim that subagents are architecturally invisible while running.
   Confirmed real, live, externally-readable via `herdr pane read` against
   CC's own in-pane picker (`↓`/`Enter`) — but strictly sequential, one
   branch's transcript at a time.
2. **CC native `teammateMode: tmux` agent-teams** — confirmed real
   independent OS processes, real tmux driving via CLI (not hooks), a
   previously-undocumented `--agent-id`/`--team-name`/etc. invocation, and
   that herdr's own shipped hook (`herdr-agent-state.sh`) deliberately
   ignores teammates/subagents today (an intentional anti-noise decision,
   not a gap).
3. **The `adhd` skill run under herdr, prose-only (no scripts)** — proved
   the mechanism works end-to-end (CC discovered the herdr CLI on its own,
   split real panes, ran isolated frames, reported honestly on what it
   skipped) but surfaced that CC defaults to `claude -p` (headless, runs
   once and exits) unless told otherwise — silently defeating the
   observability the whole strategy exists for.

## Round 4 — this skill's `scripts/`, tested live (2026-07-11)

After round 3, the skill body was updated with prose instructions telling
CC to use interactive `claude`. A live user test of that prose-only version
(same day, separate session) surfaced two further problems that prose
alone did not prevent, even with the `-p` warning already in place:

- **Uneven pane layout.** CC split 3 panes by calling `herdr pane split`
  repeatedly against whatever pane was "current" at each step, rather than
  computing the split ratios needed for genuinely even N-way division.
  Screenshot evidence showed one pane visibly larger than the other two.
  herdr's `pane split` primitive is binary-only (`--ratio` on a single
  from/to split) — there is no native "split into N even panes" call, so
  getting this right requires either doing the math up front or getting
  lucky, and prose instructions did not reliably produce the math.
- **User's structural ask.** Independent of the bug, the user asked for
  (a) real scripts instead of markdown-only instructions, matching the
  upstream `adhd-agent` npm CLI precedent of having deterministic tooling
  behind the loop, (b) frame prompts written to files rather than sent as
  raw pasted text, and (c) frame output written to files in the same
  folder rather than only replied inline in the interactive session.

**Response:** built `scripts/write-frame-prompts.ts`,
`scripts/spawn-frames.ts`, `scripts/collect-frames.ts`, and
`scripts/lib/herdr-layout.ts` (even-split math, unit-verified). Two more
real bugs were caught and fixed during live testing of the scripts
themselves, not just designed away on paper:

- **First script draft launched a frame into the seed/orchestrator pane
  itself** (`paneIds[0]` was the seed pane, and the frame-assignment loop
  used it as frame 0's pane) — fixed by having `spawn-frames.ts` compute an
  `(N+1)`-way even split and only assign the `N` genuinely NEW panes to
  frames, leaving the seed pane as a a separate, untouched orchestrator
  slot. Added an explicit assertion (`framePaneIds.length !== frames.length`
  → abort before launching `claude` anywhere) so this class of bug fails
  loudly instead of quietly launching into the wrong pane again.
- **`herdr wait output --match ">"` never matched.** Claude Code's actual
  interactive prompt glyph is `❯` (U+276F), not a plain ASCII `>` — the
  script's boot-detection wait timed out even though the session had
  booted correctly and was genuinely idle at its prompt. Confirmed via
  direct `herdr wait output --match "❯"` succeeding immediately once
  corrected.

Both were caught by actually running the scripts against a live herdr
workspace (not just reading them), confirmed via `herdr pane layout`
showing genuinely even split ratios (`0.333`/`0.5` for a 3-way split) and a
full round-trip: prompt file → interactive pane → real Claude Code session
→ output file → `collect-frames.ts` returning valid parsed JSON for every
frame. This is the same "verify empirically, not from reading the code"
discipline used throughout the earlier three spikes.

## Round 5 — `/goal` completion gating + `herdr wait agent-status`, tested live (2026-07-11)

The user asked two further questions after Round 4: (1) could herdr's
blocking `wait` primitives replace `collect-frames.ts`'s sleep-based file
polling, and (2) could each frame's launch instruction be structured as a
Claude Code `/goal` (real built-in command, confirmed against
https://code.claude.com/docs/en/goal.md — v2.1.139+, sets a completion
condition that Claude keeps working toward across turns, evaluated by a
fast model after every turn, until satisfied) with an explicit "output
file exists and is valid JSON" condition, replacing the old
reply-with-a-magic-string convention.

Both were spiked live before any script changes, in a disposable pane:

- **`/goal` works exactly as documented.** Sent
  `/goal read <prompt> and follow it; done only when <output> exists and
is valid JSON`, watched the pane show `Goal set: ...` and a live
  `◎ /goal active (Ns)` status indicator, watched it hit and need approval
  on a real permission prompt mid-task, and watched it finish with
  `✔ Goal achieved (1m · 1 turn · 802 tokens)` — genuinely gated on the file
  existing and parsing, confirmed by then `cat`-ing the file myself.
- **`herdr wait agent-status` needed the RIGHT status value, found only by
  testing.** Initially waited on `--status idle`, which hung indefinitely
  even after the goal had visibly completed in the pane. `herdr agent get
<paneId>` revealed the actual status was `done`, not `idle` — herdr
  distinguishes a `/goal`-completed pane's status from a merely-idle one.
  Switching to `--status done` returned instantly
  (`herdr wait agent-status <paneId> --status done` matched immediately
  once the pane was actually done). This is a stronger, more specific
  completion signal than plain `idle` (which a pane can also report while
  legitimately stuck, e.g. on an unanswered permission prompt — confirmed
  in the same test run, see below).

### Real bug found integrating both into `spawn-frames.ts`: send-text/Enter race

Rewriting `spawn-frames.ts` to send the `/goal` command instead of the old
instruction text surfaced a genuine timing race not seen in Round 4's
testing: `herdr pane send-text` immediately followed by
`herdr pane send-keys ... Enter` could leave the `/goal ...` command sitting
unsubmitted in the composer — visible in the pane's transcript, but never
actually pressed Enter on. Confirmed by reading two freshly-spawned panes
seconds after `spawn-frames.ts` returned: both showed the full `/goal`
text in the prompt line with no `Goal set:` acknowledgment underneath.
Manually sending another `Enter` immediately fixed it, confirming this was
a timing race, not a broken command.

**Fix:** added a 500ms delay between `send-text` and `send-keys Enter`,
then a verification read (`herdr pane read --source recent`) checking for
`"Goal set:"` or `"/goal active"` in the output; if neither appears, retry
the `Enter` once more. Re-ran the full pipeline after the fix — both panes
set their goals correctly on the first attempt, no manual intervention
needed.

### Confirmed, separately: every fresh pane hits a real permission prompt

Both frame panes in the full re-test independently stopped at an identical
`Do you want to create <file>.output.json?` permission prompt before
writing their output — this is expected default Claude Code behavior for a
fresh session with no pre-approved permissions, not a bug in the scripts.
Worth calling out explicitly for anyone deploying `herdr-panes`/
`herdr-tabs` for real: **a project relying on this strategy needs its
permission mode configured** (e.g. a settings file with the relevant edits
pre-approved, or an explicit `--dangerously-skip-permissions`-equivalent
for throwaway ideation panes) or every single frame will independently
stall on its first write until someone manually approves it — which
defeats "walk away and let it run" for anything beyond a 2-frame smoke
test. Not yet solved in `spawn-frames.ts`; flagged as a follow-up.

Full pipeline re-verified end to end after all three fixes (even split,
`/goal` gating, `done`-status wait, send/Enter race fix): 2 frames, real
interactive panes, `/goal` set correctly on first attempt, permission
prompts approved, `collect-frames.ts` exited 0 with valid parsed JSON for
both frames.

## Round 6 — closing the permission-prompt gap: `--permission-mode acceptEdits` (2026-07-11)

User confirmed the real Claude Code permission-mode docs
(https://code.claude.com/docs/en/permission-modes.md) and asked for the
fix to be scoped to just the spawned sessions — a CLI flag on the launch
command, not a `.claude/settings.local.json` file dropped anywhere on disk
(which would have worked too, but leaves a file behind and has a wider
blast radius than necessary for something this narrow).

Corrected an earlier inaccuracy on this thread: `default` (labeled
"Manual" in the CLI, reads-only, everything else prompts) is genuinely
Claude Code's real out-of-the-box default — which matches exactly what
every prior spike in this document hit. `auto` mode is a real, separate
mode, but it's account/plan/model-gated (Sonnet 5 / Opus 4.7+ on most
providers, sometimes needs `CLAUDE_CODE_ENABLE_AUTO_MODE`) and not the
same thing as what any of these spikes were actually running under.

Added `--permission-mode acceptEdits` to every frame's `claude` launch
command in `spawn-frames.ts` (`launchFrame()`). `acceptEdits` auto-approves
file creates/edits within the pane's own working directory — exactly what
a frame needs (read its prompt file, write its output file in the same
`runDir`) — without granting `bypassPermissions`' unrestricted scope.
Also folded in `herdr agent rename <paneId> "adhd:<frameId>"` alongside the
existing `pane rename` call, closing a separate open item (naming frame
sessions so they're identifiable in herdr's sidebar agent list, per the
socket-api docs' `display_agent`/`custom_status`/`state_labels` fields
for further customization if ever needed — not yet used, name/label alone
was judged sufficient for now).

Re-ran the full pipeline live with both changes: 1 frame, spawned,
`/goal` set correctly, **zero manual intervention required** — no
permission prompt appeared at all, `collect-frames.ts` exited 0 with valid
JSON, and `herdr agent list` confirmed `name: "adhd:10-year-old"` was set
correctly on the pane. This closes the previously-documented "known
follow-up, not yet solved" gap from Round 5.

## Round 7 — real user test: scripts skipped, panes too crowded, naming collision (2026-07-11)

User ran the skill live in a real sandbox project (`/tmp/adhd-live-test`),
following the exact repro steps given (config file with
`adhd.paneStrategy: herdr-panes`, then `/adhd ...` inside a herdr pane).
The run produced three side-by-side split panes (`ten-year-old`,
`game-design`, `inversion`) all independently stuck on the identical
create-file permission prompt — the exact prompt Round 6's
`--permission-mode acceptEdits` fix was supposed to eliminate.

**Root cause, confirmed by evidence, not assumption:** the run directory
CC created was named `adhd-run-1/` — a naming convention that appears
nowhere in `write-frame-prompts.ts`, `spawn-frames.ts`, or
`collect-frames.ts`. This means CC did not actually call `spawn-frames.ts`
for this run; it re-derived the pane-splitting/launch mechanism from
scratch again, despite the skill body's existing (but apparently not
forceful enough) instruction to use the scripts verbatim. Since the
`acceptEdits` flag only exists inside `spawn-frames.ts`'s own launch
command, an independently-reasoned launch never got it.

**Fix:** upgraded the "use the scripts, not prose" instruction from a
strong suggestion to an explicit MANDATORY directive with a concrete
trip-wire: _"if you find yourself typing a raw `herdr pane split`/
`tab create` call for ADHD branch execution, stop — that means these
scripts were skipped."_ Cites this exact incident (mismatched run-dir
naming, permission prompts the scripts would have prevented) as the
evidence for why this is non-negotiable, not stylistic preference.

**Second finding, from the same screenshot:** the 3-pane grid was visibly
cramped — each pane's content compressed into a narrow column, hard to
read. User asked to default to `herdr-tabs` instead of `herdr-panes` (one
full-screen tab per frame, no grid crowding). Updated the skill body:
`herdr-tabs` is now presented as the recommended/default herdr mechanism;
`herdr-panes` is now explicitly framed as an opt-in choice for anyone who
specifically wants the packed-grid view.

**Third finding, caught while live-testing `herdr-tabs` for the first time
(it had only ever been code-reviewed, not actually run before this
round):** `herdr agent rename` requires globally UNIQUE names across the
entire herdr server, not just within one workspace. A second test run
using the same frame ids (`adhd:game-design`) as the user's still-open,
stuck session (`workspace wE`, 3 panes blocked on the permission prompt)
failed immediately with `agent_name_taken`. This is a real, load-bearing
bug: repeated or concurrent ADHD runs with overlapping frame names would
always collide.

**Fix:** `spawn-frames.ts` now derives a short, deterministic run id from
`runDir` (tail of the directory name plus a 4-char hash of the full path,
e.g. `tabs-test3-2z49`) and scopes every pane/agent name to
`adhd:<runId>:<frameId>` instead of bare `adhd:<frameId>`. The `agent
rename` call is also now best-effort (wrapped in try/catch, logs a warning
and continues) rather than fatal — a naming collision is a cosmetic
sidebar-display issue, not a reason to abort a frame that would otherwise
run fine.

Re-verified `herdr-tabs` end to end after all three fixes: real distinct
tab ids created (confirmed via `herdr tab list`/`agent list`, not just
assumed from the script's own success message), no permission prompts, no
naming collisions, `collect-frames.ts` exited 0 with valid JSON. Throughout
this round, the user's own live session (`workspace wE`) was left
untouched — all fixes were verified in separate, disposable test
workspaces.

## Round 8 — architectural correction: ADHD becomes goal-scoped, config split, sandbox location (2026-07-11)

Before any live re-test of Round 7's fixes, the user clarified the intended
flow more precisely than the skill had implemented it, in two messages:

1. "adhd should be included in a goal subfolder and each frame should have
   it's own `{goal-subfolder}/adhd/session-NNN-YYYYMMDD-HHmmSS/{frame-name}/
prompt.md`. we should only do an adhd round when refining a goal and
   provide details references to other artifacts in the goal."
2. "we should also split the values for herdr and panes/tabs into two
   separate settings. that allows us to eventually support herdr
   alternatives... let's also run our tests in
   `~/src/divideby0/evie-kit-sandboxes/{test-project-name}` instead of
   `/tmp`."

This was a real scope correction, not a bug: the skill as of Round 7 could
still run `/adhd <bare question>` standalone with no goal folder at all,
wrote one flat `<frameId>.prompt.md`/`<frameId>.output.json` file per
frame directly in the run dir (no per-frame subfolder), had no mechanism
for grounding branches in real goal artifacts (GOAL.md, references/) as
opposed to a free-text `--problem`/`--context` string, and conflated the
multiplexer choice with the layout choice in one `paneStrategy:
herdr-panes|herdr-tabs` string.

**Fixed, in order:**

1. **Goal-context gate (Step 0), checked before even explicit `/adhd`
   invocation.** ADHD now hard-refuses to run without a real `GOAL.md` to
   ground the run in — not even explicit user invocation overrides this;
   the correct response to "run /adhd on X" with no goal yet is to draft a
   goal stub first (seconds via the `goals` skill), then run ADHD against
   it.
2. **Directory shape**: `write-frame-prompts.ts` now creates one subfolder
   per frame (`<runDir>/<frameId>/prompt.md`) instead of a flat
   `<runDir>/<frameId>.prompt.md` file; `spawn-frames.ts` matches with
   `<runDir>/<frameId>/output.json`. Session folders are now
   `session-NNN-YYYYMMDD-HHmmSS` (sequential counter + timestamp) as the
   user specified, distinct from `questions/`'s timestamp-only convention
   (asked the user to confirm this was deliberate; the previous turn was
   aborted before an answer came back, so proceeded with the literal
   instruction as written rather than re-blocking on an unanswered
   question the user had already moved past in their next two messages).
3. **Goal-artifact grounding**: `write-frame-prompts.ts` gained
   `--goal-file` (required) and `--reference` (repeatable) flags. Every
   frame's rendered prompt now includes a "Grounding artifacts" block with
   real file paths (this goal's `GOAL.md` plus whichever specific
   `references/` entries are relevant) that the frame session reads
   itself, rather than a paraphrased summary baked into the orchestrator's
   own prompt text.
4. **Config split**: `adhd.paneStrategy: herdr-panes|herdr-tabs` (one
   combined string) became three separate keys —
   `adhd.branchExecution: local-subagents | multiplexer | none`,
   `adhd.multiplexer: herdr` (only backend implemented so far, but the key
   now exists as its own axis so a future non-herdr backend doesn't need a
   parallel set of strategy strings), `adhd.layout: tabs | panes`.
   `spawn-frames.ts`'s CLI matches: `--strategy herdr-panes|herdr-tabs`
   became `--backend herdr --layout tabs|panes`.
5. **Test location**: per the user's explicit request, live verification
   moved from `/tmp` to `~/src/divideby0/evie-kit-sandboxes/
{test-project-name}` — built a real goal-shaped sandbox
   (`adhd-round8-test/goals/drafts/20260711-165800-todo-app-naming/` with a
   real `GOAL.md` and a `references/audience.md`) rather than a bare
   `/tmp` scratch dir, since the new goal-context gate requires one to test
   against anyway.

**Live-verified end to end after all five changes**, in the new sandbox
location, via real herdr workspace/tabs (not simulated): confirmed the
exact directory shape
(`.../adhd/session-001-20260711-165800/10-year-old/{prompt.md,output.json}`),
confirmed the rendered prompt correctly referenced both `GOAL.md` and the
passed `--reference` path by real filesystem path, confirmed
`spawn-frames.ts --backend herdr --layout tabs` produces real distinct tab
ids, confirmed `collect-frames.ts` exits 0 with valid JSON. Notably, the
collected `10-year-old` frame's ideas incorporated ADHD-audience framing
that was only present in the referenced `audience.md` file and never in
the raw `--problem` string — direct evidence the grounding-artifact wiring
is actually doing something, not just present in the prompt unused. Left
the test sandbox on disk under `evie-kit-sandboxes/` per the user's
intent for that location (inspectable artifacts, not throwaway `/tmp`).

## Round 9 — naming consistency: session-NNN everywhere, `questions/` → `grilling/` (2026-07-11)

Two more corrections, arriving right after Round 8's report:

1. "each session should be `session-NNN-YYYYMMDD-HHmmSS` (both adhd and
   grillings)." Confirms Round 8's open question from the user's side —
   the sequential-counter-plus-timestamp shape was deliberate, and applies
   to grill-me transcripts too, not just ADHD sessions. Previously
   `grilling/` (see next point) used timestamp-only
   `session-YYYYMMDD-HHmmSS.md`, inconsistent with ADHD's `session-NNN-...`
   — both are now the same shape.
2. "let's call the folder `grilling` instead of `questions`." Renamed
   throughout: `goals/SKILL.md`'s directory tree and prose, its
   `references/attribution.md`, `adhd/SKILL.md`'s directory-conventions
   example and `--reference` prose, and the real existing artifact —
   `goals/drafts/20260710-214424-goals-workflow/questions/` (containing the
   original grill-me transcript from the goals-workflow design itself) —
   moved to `grilling/session-001-20260710-221700.md` (added the `001`
   prefix at the same time, retroactively applying the new naming rule to
   the one pre-existing transcript). All three of that goal's own
   `GOAL.md` cross-references to the old path updated to match.

No script changes needed for this round — `grilling/` is grill-me's output
location, which is entirely governed by `goals/SKILL.md`'s directory
conventions (`grill-me/SKILL.md` itself never specifies its own output
path). Confirmed via full-repo grep that no other `questions/` or
timestamp-only `session-YYYYMMDD-HHmmSS` references remained anywhere
under `.claude/skills/` or `goals/` after the sweep (excluding this file's
own accurate historical narration of Round 8, which correctly describes
the pre-rename state as it was at the time).
