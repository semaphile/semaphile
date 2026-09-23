---
name: goals
description: >-
  The goal lifecycle for this repo — draft an idea, refine it, promote it to Linear, execute it via a herdr-driven Claude Code session, gate completion on a blind multi-tool review, and lock it. Includes wayfinder-mode planning for ideas too big for one execution session. Use for ANY new feature, fix, or piece of work that will eventually touch code — even small fixes, and even when the user never mentions goals or Linear, since nothing gets built in this repo outside a goal; it also decides WITH the user when small work goes inline instead. Also use to check on a goal or its review wave ("is the review for ABC-7 done?"), or to resume or execute an already-promoted goal. /goals is a stateful door — bare /goals lists open goals and pending planning requests (the save-select), /goals draft plus a description runs capture-first intake into a working draft, /goals completed pages locked goals. Two supervising roles since EVA-218: the planner (drafts, grills, promotes, maps) and the orchestrator (launches, lock reports, merges, cleanup) — a lifecycle question raised in the planner, or planning work asked of the orchestrator, is routed through the seam ownership matrix.
argument-hint: "[draft <description> | condition <task> | completed | requests | <goal name>]"
---

# Goals

The lifecycle for anything that eventually needs to get built in this repo.
An idea starts as a loose draft, gets sharpened through interview (and
sometimes wider exploration), is promoted to a real tracker issue (Linear or
GitHub, per the project's `tools.tracker.*` block) once it has
solid footing, executes as a herdr-driven Claude Code session, and is
gated on a blind multi-tool review before it locks permanently. Nothing gets
built in this repo except through a goal — this is deliberate: it's the one
path, not one of several. What that sentence does not claim is that every
edit is goal-sized: work an interactive session could finish in the turn it
was asked in gets decided at an explicit ask, never assumed in either
direction (Proportionality, below).

Adapted from the goals-workflow design worked out in the evie-kit
repo's EVA-1 goal record (its `GOAL.md` is this skill's source spec;
its grilling transcript holds the full design rationale — decision
provenance throughout this skill cites such `EVA-N` goal records), with its
planning-for-oversized-work mode adapted from
[mattpocock/skills](https://github.com/mattpocock/skills)'
`skills/engineering/wayfinder`, retargeted onto a local-file-tree map that
rolls forward goal-by-goal (upstream's tracker-canonical mode is a deferred
per-project config option; tracker issues are created lazily). See
`references/attribution.md`.

## Roles, not products ("the agent")

Every reference to "the agent" in this skill and in anything it generates
means _whoever is directly driving right now_ — this could be OpenClaw
orchestrating from Discord (thin: it delegates the actual token-intensive
work down into spawned Claude Code sessions via herdr rather than doing it
inline) or a Claude Code session itself, paired directly with the user over
a shared herdr/tmux pane. Both surfaces support the same verbs — draft a
goal, run an interview, check review status, chart a map — without
functionality loss. Where OpenClaw would use an interactive Discord
component, a standalone Claude Code session uses its native
`AskUserQuestion` tool as the equivalent primitive. Refer to roles rather
than to "OpenClaw" or "Claude Code" by product name, so a goal file
dropped into a fresh session has no dangling references.

**Three roles supervise or perform work (EVA-218, ADR 0022).**

- **The planner** creates, grills, promotes and charts maps with the
  user. Its transcript is PLANNING ONLY: nothing about a dispatched
  goal enters it, with one exception below. A planner needs no record;
  any interactive session that is not the recorded orchestrator is a
  planner or unknown.
- **The orchestrator** owns every lifecycle question — launch sizing
  and `goals plan`/`execute`, lock reports, the merge moment, stalled
  or paused executors, cleanup and reap — and raises each one as a
  self-contained picker IN ITS OWN PANE, where the user answers when
  they choose. One per project. `evie-kit goals spawn orchestrator`
  launches it as a Claude Code session; `evie-kit goals bind orchestrator`
  makes a live session the orchestrator instead, on Claude Code, Codex
  or pi (EVA-222; the bare verb is a retired stub). Either
  verb writes the ORCHESTRATOR RECORD every lock report and role check
  reads (a pane with no record is never a lock-report target). Its
  default model is `execution.orchestrator.model` (`claude-opus-5`
  unless a layer says otherwise). It delegates judgment reads (the
  merge briefing, tracker comments) to cheaper subagents, and it never
  grills or edits a goal's problem, scope or gates. Its own operational
  writes to `GOAL.md` (`plan --accept`'s fields, the completion stamps)
  are its work.
- **The executor** is the Claude Code (or Codex, or pi) session
  actually doing plan+execute work inside a goal's worktree.

**The one thing that crosses from orchestrator to planner is a notice
line.** Planning work that surfaces on the orchestrator's side — a
requirements change, a re-grill, a follow-up goal, an investigation
that exposes new requirements, a user asking the orchestrator to draft
— becomes a written PLANNING REQUEST (`evie-kit goals requests write`,
`references/seam-ownership.md`) the user opens in the planner. The
verb may type ONE fixed notice line into the planner's pane saying a
request is waiting and where — a notice to leave pending, never an
instruction the planner acts on — and only into a live, idle,
empty-composer planner whose destination was bound at launch. In every
other state the request stays pending and bare `/goals` in the planner
lists it by name. Everything else crosses roles through the record
files or the outbox. Which role owns each seam, what it may do there,
and where a wrong-role trigger routes is the seam ownership matrix
(`references/seam-ownership.md`, generated from
`packages/goals/src/seamOwnership.ts`); a seam that fires in the wrong
role is a DEFECT this skill names, never a fallback.

**The cold-reader rule binds every orchestrator picker.** Nobody is
watching that pane when a question renders, so the question text
itself carries the goal's key AND title, the full `<KEY>-<slug>`
branch name, what the branch ships and which packages it touches, its
`stacked_on` relation, what the reviews found, and each option's
consequence — with the absent cases said out loud ("no goal or branch
exists yet" at an inline-vs-goal ask, "no review has run", "stacks on
nothing", "already landed: no new merge to offer") and proposed scope
kept distinct from shipped behavior. The facts do not shrink when the
decision does: an already-landed branch's picker still names what
shipped, the packages, the stack relation and the review findings. The merge moment's rule
below is its strictest instance; the matrix lists the facts per seam.

## Proportionality: not every edit is goal-sized (EVA-92)

A goal earns its overhead on work that is complex, wants isolation,
benefits from parallel review, or deserves a durable locked record. A
typo, a doc correction, a one-line guardrail earns none of that: run
through draft → grill → promote → execute → review → merge, such work
costs orders of magnitude more than the change itself and leaves a
locked record nobody will read.

The counterweight is an ASK, not a threshold. **When an interactive
session judges a piece of work small enough to finish inline, it asks
before doing it** — the inline-vs-goal seam, below. The seam is the
SIZE judgement itself, so it fires in BOTH directions: a session about
to open a goal for something that looks small raises the same picker
before drafting, rather than letting intake carry a decision nobody
made out loud. Both silences are failures of the same judgement:

- quietly opening a goal for a typo, because the lifecycle is the one
  path — ceremony standing in for judgement;
- quietly hand-editing something that deserved a grill and a review
  round, because it looked small — speed standing in for judgement.

Why an ask and not a line count: every fixed rule ("under N lines") is
wrong at its own boundary, and the agent is the party least able to
tell whether a small change is consequential — a two-line deletion can
be the one that matters. Asking costs one turn and puts the decision
where the context is.

**Binding scope** (grilled decision, EVA-92 session-001): interactive
sessions only — the orchestrator, and any session paired with a user.
Executors never raise it: an executor's adjacent-fix judgement stays
goal-scope discipline, and an interactive gate there would park an
unattended lane. The ask is likewise already answered when the user
directed the shape themselves ("open a goal for this") — an explicit
human instruction IS the decision, and re-asking it is the nag failure
mode. It answers only the axis it names, though: this seam decides
size AND, on the inline side, the record shape, so a bare "just fix it
inline" still leaves the record question to ask. Ask once per piece of
work, not once per edit: follow-on tweaks inside a scope the user
already approved ride that approval.

Record shapes and when each earns its keep, the resolution order that
names a candidate related issue, and what the briefing must carry:
`references/inline-work.md`.

## The `/goals` door (EVA-13)

`/goals` is ONE stateful door, not a verb family: what it does is picked
by the detected lifecycle state of wherever it was invoked. Probe state
FIRST, before choosing any behavior:

```bash
bun node_modules/@evie-kit/cli/src/evie-kit.ts goals context
```

**Toolchain guard (EVA-81)**: if that path does not exist — any
`bun node_modules/@evie-kit/cli/...` invocation dying with
module-not-found — the machine's bootstrap has not run. The repo is not
broken and this skill's instructions are not wrong; the toolchain is
simply absent (it is a machine-local link git never carries, and
`bun install` does not create it). Say so, and run the bootstrap once BY
PATH from an evie-kit checkout — `bun
/path/to/evie-kit/packages/cli/src/evie-kit.ts onboard` — because
the linked command does not exist yet. `EVIE-KIT.md` at the project
root carries the full bootstrap. Under Claude Code a committed
SessionStart hook announces this at session start; this line is for the
runtimes that have no such hook. (Inside the evie-kit checkout ITSELF
the same symptom means something simpler — `bun install` has not run;
that repo resolves the packages from its own workspace, never a link.)

(`detectGoalContext` — pure, resolved from cwd + branch against the goal
surface). An ambiguous probe — cwd and branch disagreeing, an unreadable
GOAL.md — **degrades to the save-select screen: ask, never guess a
verb.** The same package commands back every door behavior (`evie-kit
goals list | completed | context | draft` is the shell mouth; this skill
is the in-session mouth — same verbs, one throat).

**Bare `/goals`** — the save-select screen. Render `evie-kit goals
list`: OPEN goals only — active drafts (title, open-question count,
last-touched) and promoted/executing goals (lifecycle state) — ordered
by promotion timestamp newest first (drafts, having none, by created
timestamp, in the same ordering), then the PENDING PLANNING REQUESTS
band (EVA-218: orchestrator-side planning work waiting for the planner,
by request id, from any worktree — `evie-kit goals requests` is the
same read; a planner opens one with `goals requests open <id>`, and
reading never changes a request). Then ask ONE fixed-shape
AskUserQuestion regardless of goal count — _Start a new goal / Refine an
existing one (name it next) / Just checking_ — and STOP. Selecting an
existing goal happens BY NAME in the next turn; never enumerate goals as
AskUserQuestion options (options cap at 4 — the list itself is the
picker).

**`/goals draft [description]`** — the ONE canonical intake verb (no
`new`/`create` alias anywhere; the whole system speaks "draft").
Bare `/goals draft`: ask for the description next turn. With a
description, run intake:

1. **Classify** (`classifyIntake` — hybrid creation timing): a clean
   work item creates immediately; a question-shaped, exploratory, or
   too-thin description gets ONE confirmation turn — echo a one-line
   understanding and ask it as a PICKER (_Create the draft / Just
   thoughts, don't create / Let me rephrase_), never a typed "yes".
   When in doubt, confirm: a lost turn is cheaper than branch litter
   from a misread question. The same call PROPOSES a goal TYPE
   (EVA-145: `feat | bug | docs | research | chore`, from lexical
   evidence in the description — `proposedType` + `typeSignals`).
   Offer it, never assume it, and pass the confirmed type to the
   capture. Through the CLI the pre-mutation moment is the read-only
   `evie-kit goals classify --description-file …` (same JSON, nothing
   created) — `goals draft` reports the proposal only after the
   scaffold exists, so classify first, ask, then draft with the
   answer.
2. **Capture first** (`captureIntake`, or `evie-kit goals draft
--slug … --title … --type … --description-file …`): `startDraft`
   scaffolds branch + mirror worktree, and the description lands
   BYTE-FOR-BYTE as `references/intake.md` before any interpretation.
   Pick the slug and the Title Case title yourself from the
   description. The title's grammar follows the type: verb-first for
   feat/docs/research/chore, the stated SYMPTOM for a bug (`Log In
Times Out When Idle`, never `Fix …`). The naming lint dispatches on
   the type, and its refusal prints the expected pattern plus a
   rewrite when the title misses it. An untyped draft is a `feat` and
   writes no `type:` key.
3. **Distill provenance-honestly** into GOAL.md (inside the draft's
   worktree): never silently invent specifics. Keep derived content
   distinguishable from agent-inferred content, and park everything
   vague in an "Open questions (for grilling)" section. A vague dump
   that yields an EMPTY open-questions section is a failure signal, not
   a success.
4. **Flow DIRECTLY into the grill** (`grill-me`) — a freshly drafted
   goal gets its first grill question immediately, with no "want to
   start the grill?" offer in between (EVA-19, superseding EVA-13's
   end-by-offering: the offer turn was a wasted turn — escape is native
   at any question). The intake path remains structurally incapable of
   promotion — it imports no Linear/promote code (contract-tested) — so
   promotion stays an explicit, separate, user-triggered act.

Wayfinder is an **escalation, not the default**: intake produces a plain
draft; suggest wayfinder mode only when the description is genuinely
oversized (the existing judgment call, made during refinement — see
Wayfinder mode below).

**`/goals completed`** — the locked-goals view: newest-completed first,
**paged at 10** (`evie-kit goals completed [--offset N]`) with a
"show older" affordance in the next turn — never the unbounded list.

**`/goals condition <task | @path>`** (EVA-227) — an ad-hoc `/goal`
condition for work that runs in THIS hand-started session rather than
a goal: the proportionality rule's inline path, given an evaluator.
Bare `/goals condition`: ask for the task next turn. With one: resolve
what it references (inspect named files enough to cite concrete paths
and measured baselines), then draft the condition under the project's
goal-conditions convention (`.evie-kit/conventions/goal-conditions.md`
— predicates with their proof named inline, the project's standing
gates, the ask's constraints as predicates, non-goals, a stop clause),
write it to the session scratchpad, and present it as ONE plain-text
block the user pastes after `/goal` — no headings, no fences. Never
run `/goal` yourself. No draft, branch, or record is created; a task
that turns out to need one goes through `/goals draft` instead.

**Other intents** (`promote`, `execute`, `status`, a goal name) are
validated against the detected state: legal intents fast-path into the
lifecycle steps below; illegal ones explain what would make them legal
(e.g. `promote` on a locked goal → "locked goals never reopen; draft a
new goal referencing it"). Unknown intents (`/goals new`) get a
did-you-mean naming the canonical verb — the teaching-moment pattern,
same as the CLI's.

**Discoverability note**: Claude Code has no subcommand autocomplete
(verified 2026-07-13 — `/` filters command names; arguments are free
text; `argument-hint` is displayed, never completed). The door's own
behaviors ARE the discoverability: bare `/goals` is the menu, the
`argument-hint` documents the verbs, did-you-mean catches typos.
Revisit hyphenated per-verb commands only if the verb family outgrows
~4.

## Lifecycle seams are pickers (EVA-19)

**Principle: pickers for legal transitions, freetext for design,
autonomy for operations.** Wherever the next action is a CLOSED SET of
legal transitions, end the turn with an `AskUserQuestion` picker
enumerating them, recommended option first — never prose like "say the
word" or "say execute when you want it launched", which forces the user
to type a magic phrase the options could have carried. (Discord-backed
runtimes render the same seams as buttons, reply-first — the picker set
is the invariant; the widget is per-runtime delivery.) Every picker
also obeys grill-me's explain-first discipline (`grill-me/SKILL.md`,
"Explain before you ask — the pre-picker briefing"): the
did/deciding/impact pre-picker briefing
binds at every seam — what happened since the user's last touchpoint,
what is being decided, what impact each direction has, as prose BEFORE
the picker (seams are where the user has most been out of the loop; an
executor may have run unattended for an hour) — and the picker
captures only the decision. Seam pickers are the same surface as grill
questions, so grill-me's clarification rule ("Clarification replies
are a stop signal") binds here too: a question-shaped or
confusion-shaped reply to any seam picker is a STOP signal, never an
answer — explain in plain prose first, calibrated to a reader who was
out of the loop, then re-present the picker reshaped by that
explanation; never re-send an unchanged picker after a confusion
signal. On a SECOND consecutive confusion signal the turn goes
prose-only (grill-me's step 3 — diagnose what didn't land; see the
NON-pickers list below); a picker returns once the explanation lands.
The canonical seam option sets below keep their substantive
membership exactly as documented — grill-me's standing "Go Deeper"
option never displaces a canonical option and never enters a seam's
drop-order rules. It rides ADDITIVELY, per grill-me's seam rule: a
rendered seam set that leaves a slot free carries `Go Deeper` in the
last slot; a full rendered set uses grill-me's announced fallback —
the briefing must state that a reply asking for more depth is always
honored, with the picker's built-in free-text channel ("Other")
carrying it.

The seams, with their canonical option sets. Each has an OWNER
(EVA-218): the matrix in `references/seam-ownership.md` says which role
raises it, which decides it, what the owning session may do, and where
the answer goes when it is planning work (a planning request, never
planning done in the orchestrator). The planner owns intake, grilling,
promotion, goal reviews and wayfinder; the orchestrator owns launch
sizing, waves, lock reports, the merge moment, verification failures
and watcher dead-ends; the inline-vs-goal ask and the post-promotion
seam are shared and say so per option.

- **Inline-vs-goal ask** (EVA-92 — an interactive session forms a view
  about a piece of work's size, in either direction; it precedes
  intake, so it is the first seam a piece of work meets) — _Inline,
  comment on
  `<KEY>` / Inline, new issue / Inline, no record / Open a goal
  instead_. The comment option is conditional: it renders when this
  work touches the FILES OR THE BEHAVIOR of an already-tracked change
  that MERGED — a goal that is also LOCKED, or a tracker-only issue an
  earlier inline record left behind — and it NAMES that issue key
  rather than asking the user to recall it (resolution order —
  behavior and files are separate searches — and the record-shape
  guidance: `references/inline-work.md`); with no candidate the
  rendered set is three and carries `Go Deeper` in the free slot.
  Which option is marked recommended is per instance — the agent puts
  its own read of the work first — and _Open a goal instead_ is never
  dropped, the ONE exception being a user directive that already ruled
  the goal path out (`references/inline-work.md`, Boundaries). The
  briefing states the concrete scope (which files, what edit) and
  sizes BOTH paths against each other on the relative-effort scale
  plus the inline path's turn horizon ("inline XS, done in this turn;
  as a goal, S"); never a wall-clock estimate (EVA-21). The seam
  decides TWO axes — size, then record shape — so a user directive
  answers only the axis it names: "just fix it inline" skips the size
  comparison and leaves the record question to ask.
- **Hybrid-intake confirmation** — _Create the draft / Just thoughts,
  don't create / Let me rephrase_ (see intake step 1; never a typed
  "yes").
- **Post-intake** — MOSTLY the exception: no next-step picker; a
  freshly drafted goal flows directly into the first grill question
  (intake step 4); escape is native at any question. The ONE carve-out
  (EVA-32): when an engine is staged for goal reviews, the intake
  output ends with the goal-review offer — _Straight to grilling
  (Recommended) / Run a goal review on the raw draft first_ — since
  post-intake output is one of the three offer seams
  (`references/goal-reviews.md`); declining flows into grilling as
  before.
- **Grill ending** — _Promote now / Keep grilling (name the sub-topic)
  / Run an ADHD pass / Run a goal review / Park the draft_ (owned by
  `grill-me`'s ending contract; conditional options gate themselves —
  goal review only when an engine is staged for it). The rendered set
  caps at four; when all five apply, DROP in this order: _Park the
  draft_ first (always reachable via the picker's built-in Other),
  then _Run an ADHD pass_ (the narrower conditional) — _Promote now_,
  _Keep grilling_, and an applicable _Run a goal review_ are never
  dropped.
- **Promotion seam (goal-review offer)** — when the user moves to
  promote, goal-stage engines are configured, and no goal-review round
  has consumed the latest spec: _Run a goal-review round first
  (Recommended) / Promote directly_ (`references/goal-reviews.md`; the
  offer seams are post-intake output, grill ending, and here — never
  automatic on every draft).
- **Goal-review consensus** (every participating engine's latest
  verdict is `ready_to_promote`, per `goals goal-review status`) —
  _Promote now / Another goal-review round / Keep refining_. Consensus
  informs; it never auto-promotes.
- **Map shape** (EVA-236 — fires INSIDE `goals promote` when the draft
  carries `wayfinder/MAP.md` and the project declares
  `tools.tracker.linear.hierarchy`; absent block, no seam) — _Create a
  new epic for the map / Attach the map to an existing epic / One
  issue for the map, related issues for its waypoints / One issue for
  the map, sub-issues for its waypoints_. The verb STOPS before any
  mutation, with exit 2 (the branch-naming `ask` shape). Its stdout
  carries a JSON briefing: the map's title, destination and tickets,
  the four shapes with their resume commands, and the settings
  default preselected. It also lists the team's epics WITH THEIR
  DESCRIPTIONS, and the initiative an epic would be linked under. The
  pre-picker briefing is DESCRIPTION-AWARE by decision. Name EVERY
  candidate epic with its description, because the user chooses among
  them. The names go INSIDE the picker's question text as well as the
  prose, since the question must stand alone (the matrix's cold-reader
  facts for this seam). Then recommend the best-matching epic for this map and say
  why, and put that shape first. It is a recommendation, never an
  automatic filing. Answering re-runs `goals promote --map-shape
<shape>`. There, `--epic <name>` names the epic to attach or create.
  `--initiative <name>` links it to an initiative other than the
  settings' `initiative`. Leave the flag off unless the user chose a
  different one: the settings' initiative applies without it. The
  initiative must already exist; the kit never creates one. Under `hierarchy.mode:
"always"` the seam does not render, and the default applies
  silently. Settings refuse `attach-epic` as that default. A map whose
  `## Tracker` section already records a shape is PLACED. A step goal
  inherits its recorded epic by id, so a rename is harmless, and it
  raises no picker. A recorded waypoint shape mints nothing again.
- **Post-promotion** — _Execute now / Review on the issue first /
  Hold_.
- **The re-grill seam** (EVA-138 — an adoption lands, or an unblock
  event wakes the holder; offered, never forced, and THE HOLDER
  answers) — _Re-grill it (name what changed) / Execute as specced /
  Park_. A goal drafted against assumptions its dependencies may have
  changed gets a refinement touchpoint; the original author's issue
  comments are record, not a live dependency. The briefing names what
  changed since the spec was written (the merged blocker, the handoff);
  the machinery never auto-executes an unblocked or adopted goal.
- **Launch right-sizing** (EVA-90, between promotion and launch —
  `references/right-sizing.md`) — _Launch with this plan (Recommended) /
  Adjust the plan / Launch with the defaults_. The pre-picker briefing
  is the `goals plan` summary: what the recommendation READ (size,
  code-vs-docs, risk surfaces, each with its excerpt), what it proposes
  (executor model, wave or no wave, finding-round budgets, engines,
  reviewer models), and — in words, never only in a key — what accepting
  gives up: a SKIPPED WAVE means no blind reviewer sees the diff, and a
  degraded pairing means the reviewer shares or undershoots the
  executor's capability. Accepting runs `goals plan <KEY> --accept`,
  which records exactly those keys with a `plan_accepted` stamp; then
  `goals execute`. A goal launched without the seam simply carries no
  plan — never a plan nobody confirmed.
- **Post-wave** (after INDEX.md reconciliation, when the wave is the
  user's to act on) — _Fix the merged findings / Run another wave /
  Accept and proceed to completion_.
- **Wayfinder escalation** (drafting reveals an oversized idea) —
  _Chart a wayfinder map / Keep it one goal anyway / Split it manually_.
- **Unisolated-launch refusal** (`startGoalExecution` refuses: the
  project makes no worktree-isolation assertion while another goal is
  executing) — _Wait for the running goal / Override accepting the risk
  / Implement the environment hook_.
- **Lock-report arrival** (EVA-217 — the typed lock report lands in
  the orchestrator's pane as a user turn, so it arrives wherever the
  conversation happens to be, often mid-thread on something
  unrelated). It is a NOTICE, not a task: nothing post-lock runs before
  the merge-moment picker below is answered — no merge, no release, no
  tracker move, no cleanup, no reap. The orchestrator acknowledges the
  lock in ONE line, hands the record read (`results/RESULT.md`, the
  review `INDEX.md`, the pull request's state) to a BACKGROUND subagent
  on a cheaper model that returns the merge briefing, and keeps the
  user's thread. The picker comes at the next natural pause, briefed
  from that return. After _Merge now_, the deterministic sequence
  (`goals merge --push`, `cleanup`, `reap`, the Sonar scan) runs as ONE
  background command and the orchestrator relays a one-line result;
  the tracker comment goes to the same subagent with the house
  template. A subagent cannot raise the picker and its output is not
  shown to the user, so the decision and the relay stay with the
  orchestrator; the foreground cost of a lock is two short turns. The
  incident: an orchestrator merged, released, cleaned up, and reaped
  a locked goal inline, with no picker, while the user's next question
  waited five minutes behind it. Since EVA-218 the report can only
  land in the RECORDED orchestrator's pane: the watch resolves its
  target through the orchestrator record (`goals spawn orchestrator`
  or `goals bind orchestrator` writes it) with the herdr client bound
  to the record's session, refuses a
  pane with no record (naming the recovery — run the launch verb, then
  `goals resume <KEY> --rearm-only`; a running watch picks the record
  up on its next tick), refuses a stale or wrong `--report-to` while an
  orchestrator is live (naming the live pane), and types NOTHING into a
  pane that is not command-ready — the same no-dialog-input rule the
  planner notice line follows; the lock then rides the outbox's human
  lane. A planner that still receives one leaves it unanswered and
  says so.
- **The merge moment** (post-completion, after PR verification) —
  _Merge now / Review the PR first / Hold_. The question text itself
  must name every branch by its full `<KEY>-<slug>` branch name and
  carry a one-line summary per branch — what it ships, which packages
  it touches, and its `stacked_on` relation if any — INSIDE the
  `AskUserQuestion` question text. Prose before the picker does not
  satisfy this, and bare issue keys are never acceptable: at the
  merge moment the user cannot be assumed to remember what any
  `KEY-NN` refers to. The same principle binds EVERYWHERE an issue
  is mentioned in text a human will read — prose, briefings,
  pickers, tracker comments, handoffs: pair the key with its title
  (or a tight paraphrase) on first mention per message; only
  immediate re-mentions in the same message may go bare. A bare key
  forces the reader to recall what the number means, and at any
  distance from the work they can't (user rule, 2026-08-11; the
  merge-moment requirement above is its strictest instance).
- **Post-lock verification failure** (a locked goal's claim doesn't
  hold up) — _Send back to the executor (new goal) / Accept with a
  recorded caveat / Investigate together_.
- **Watcher dead-ends** (an executor unresponsive after a SECOND failed
  nudge) — _Kill and relaunch / Keep waiting / Inspect the session
  together_.

Explicit NON-pickers — where a picker would be wrong:

- **Diagnosing a repeated confusion signal** — after a SECOND
  consecutive confusion-shaped reply to a seam picker, the turn is
  prose-only (grill-me's clarification rule, step 3); a picker returns
  once the user signals the explanation landed.
- **Wave failures and INDEX.md reconciliation** are the executor's
  judgment: merged findings are decided and RECORDED, never put to the
  user as a vote.
- **Open design discussion** — freetext is correct; don't flatten a
  genuinely open question into four options (grill-me's own escape
  hatch exists for exactly this).
- **The-list-is-the-picker** — never enumerate goals as
  `AskUserQuestion` options (options cap at 4); render the list, ask
  the fixed-shape question, selection happens by name.
- **Autonomous executors don't ask at all**: an executing session that
  reaches its gates doesn't ask "should I lock?" — the completion
  sequence (GATES.md + RESULT.md → frontmatter → commit → push → stop)
  IS the answer; the merge-moment picker belongs to the
  orchestrator/user conversation afterward. The inline-vs-goal ask
  binds interactive sessions only for the same reason (EVA-92): a
  small fix an executor makes inside its own goal's scope is scope
  discipline, never a picker. The one carve-out is a
  **declared human-approval gate** (EVA-93): when the goal's own spec
  reserves a decision for the user, the executor cannot answer it and
  records a legal pause instead — still not a picker (nobody is
  watching the pane), a marker plus a stated ask. See Legal pauses
  below.

### Per-runtime delivery (EVA-212, ported EVA-222)

The seam set above is the invariant; the widget is the runtime's. The
committed matrix `references/codex-seams.md` (generated from
`packages/goals/src/seamInventory.ts`; regenerate with `bun run --filter
@evie-kit/goals build`) renders every seam for both widgets and names
the fixture that proves each row. Its goals rows carry the seam ids of
the ownership matrix (`references/seam-ownership.md`, EVA-218), so the
two references share one seam vocabulary.

- **Claude Code** (`AskUserQuestion`): up to four options, an optional
  preview, the built-in "Other". An over-cap set shrinks by the seam's
  documented drop order (the grill ending drops _Park the draft_ first,
  then _Run an ADHD pass_); a free slot carries `Go Deeper`.
- **Codex** (`request_user_input`): a Codex orchestrator runs Default
  mode with the `default_mode_request_user_input` feature enabled
  (checkpoint 0 — Plan mode also renders the picker but forbids the
  mutating lifecycle verbs). Each question carries 2–3 options with a
  12-character header and no preview; a call carries up to three
  questions. An over-cap seam is never trimmed: it SPLITS into a primary
  question (recommended first) plus a secondary "More options" question
  carrying the rest, so every transition stays reachable. The last free
  slot carries `Go Deeper`. Anything a preview would have shown (the
  merge moment's branch summaries, the plan summary) goes into the
  question text itself. Reading the answer: exactly one substantive
  label is the action. The client-appended "None of the above" with a
  `user_note` is FREE TEXT and never an action, even when the note
  spells a label (read it back, re-present). A question-shaped note is
  a clarification stop; one label on each of the split questions is
  ambiguous (stop, re-present). Default mode auto-submits EMPTY answers
  after a 60-second countdown, and silence never advances a transition.
  The Codex door is `$evie-goal` (shipped by the plugin goal; until it
  lands, load this skill by name). At the start of a session the user
  designates as the orchestrator, on either runtime, run
  `evie-kit goals bind orchestrator`. It records the session's pane in
  the orchestrator record so lock reports phone home to it; a spawned
  orchestrator is recorded by its launch already, and a planner never
  binds. A Codex session should not skip it: herdr may never observe
  its session id, and the bind is what finds the pane by agent name.
- **Discord-backed runtimes**: the same option set as buttons,
  reply-first (a plain reply is the reliable path).

## Estimate in relative effort, never calendar time (EVA-21)

Anywhere a goal (or its workstreams) gets sized — drafting, grilling,
scope discussions, sequencing notes — the estimate is **relative
effort**, expressed as t-shirt sizes on a Fibonacci scale:

**XS=1, S=2, M=3, L=5, XL=8, XXL=13.**

Never human/calendar time: "8–12 weeks" is meaningless when a goal
executes in ~30 minutes of agent time, and it silently smuggles in
human-team assumptions (meetings, handoffs, review latency). Relative
size and risk are what an estimate must carry; wall-clock is not.

The scale is FIXED — documented here, not settings-configurable — a
shared vocabulary across goals, research reports, and wayfinder maps
is the point. The same rule binds research report sizing (the research
skill) and wayfinder ticket/map sizing (`references/wayfinder.md`).

## Prose written to external surfaces is unwrapped (EVA-66)

Repo markdown is hard-wrapped at ~72 columns; Linear and Notion
render those intra-paragraph newlines as visible breaks. Compose
prose sent directly through MCP calls unwrapped (one line per
paragraph, never pasted hard-wrapped file content) and push
structured Notion writes through `evie-kit notion upsert` /
`patch` (EVA-71) rather than hand-composed block JSON. Full rules,
the `unwrapProse` helper, and the runtime coverage:
`references/external-prose.md`.

## Directory conventions

```
{PROJECT_ROOT}/
  goals/
    drafts/
      YYYYMMDD-HHmmSS-{goal-slug}/
        GOAL.md                # frontmatter + spec; this file's shape
        references/            # goal-specific context, progressive disclosure
          INDEX.md
        grilling/
          session-NNN-YYYYMMDD-HHmmSS.md
        adhd/                  # ONLY ever runs during goal refinement —
                                # see adhd/SKILL.md pre-flight Step 0.
                                # MACHINE-LOCAL since EVA-59 (gitignored)
          session-NNN-YYYYMMDD-HHmmSS/
            manifest.json
            {frame-name}/
              prompt.md         # includes references to this goal's own
                                 # GOAL.md / references/ — never a bare
                                 # free-text problem statement
              output.json
        results/
          RESULT.md             # written once the goal is actually executed
          GATES.md              # gate-evidence receipts (EVA-79): per green
                                 # gate the exact command, exit code, headline
                                 # counts, timestamp, commit hash — committed
                                 # BEFORE the review wave; reviewers audit it
                                 # with calibrated trust
        reviews/
          {goal|results}-NNN/    # one review ROUND, kind-prefixed (EVA-30):
                                 # `results-NNN/` = blind execution-gate
                                 # wave, `goal-NNN/` = pre-promotion goal
                                 # review (EVA-32 — see
                                 # references/goal-reviews.md).
                                 # NNN is ONE per-goal sequence across both
                                 # kinds; legacy `wave-NNN/` (EVA-21..29) and
                                 # datestamped review-YYYYMMDD-HHmmSS/
                                 # folders read as results-kind history
            INDEX.md             # merged summary across tools
            BRIEF.md             # goal rounds only: the main agent's
                                 # recorded round brief to the critics
            claude-code/
            codex/
            sonarqube/           # results rounds only (headless tools
            coderabbit/          # never join goal rounds).
                                 # In RESULTS rounds these per-tool dirs
                                 # are MACHINE-LOCAL since EVA-59
                                 # (gitignored raw dumps); goal rounds'
                                 # per-engine CRITIQUE.md stays part of
                                 # the tracked record — never gitignored
                                 # (committed per the draft-commit
                                 # policy, EVA-62)
                                 # (no handoffs/ — session handoffs are
                                 # runtime-managed and live in the
                                 # checkout's gitignored
                                 # .evie-kit/handoffs/, EVA-41; the
                                 # folder in older locked goals is legacy)
        wayfinder/               # only when this goal is a step on a map:
          MAP.md                 # the CURRENT map — destination, decisions
          references/            # so far, fog, ticket definitions —
                                 # recrafted forward into the next goal;
                                 # see Wayfinder mode
    ABC-NNN-{goal-title-slug}/   # promoted goal — same shape, moved+committed
  docs/research/{category}/      # project-level research, shared across goals (NOT under goals/)
```

Creating a draft creates a branch named after the draft folder (e.g.
`draft/YYYYMMDD-HHmmSS-{goal-slug}`) born directly into its own
worktree — the primary checkout never leaves main. Drafting is LOCAL
by default (`goals.drafts.commit: false`, EVA-62): nothing commits or
pushes until promotion captures the whole folder as one commit,
behind the intake review gate. `goals draft --push` and `evie-kit
goals share` are the per-draft escapes — both still behind that same
gate (`--intake-reviewed` after the scan); `goals.drafts.commit:
true` restores ungated commit-as-you-go. The full mode descriptions:
`references/goal-records.md`.

At promotion the _entire folder_ moves to `goals/ABC-NNN-{slug}/` (using the
real issue key) via `git mv`, the branch is renamed to match the issue
key (`git branch -m`; if already pushed, push the new name and delete
the old), **and the worktree moves with it** (`git worktree move`).
Nothing is copied. That same branch — and that same worktree, which the
execution handoff adopts — then carries execution (step 5), so a goal's
record lands on main when its execution branch merges — always via a
real merge commit, never a squash, so the commit hashes baked into
Linear permalinks stay reachable from main.

### Committed vs machine-local (EVA-59)

Git stays the system of record, split into a committed skeleton
(`GOAL.md`, `references/`, `grilling/`, goal-round per-engine
`CRITIQUE.md` files, review `INDEX.md` + `BRIEF.md`,
`results/RESULT.md`, `results/GATES.md`, `wayfinder/`) and
machine-local ephemera
(`adhd/` sessions and results-wave per-tool output dirs,
gitignored). Reconcile a wave into its `INDEX.md` BEFORE the goal
locks — the raw per-tool output dies with the worktree. Full split
and the `.gitattributes` collapse: `references/goal-records.md`.

### Worktree layout (path-mirror invariant)

Every goal lives in exactly one worktree across its whole life, at
`.worktrees/` + the goal folder's path relative to `goals/`;
`ls .worktrees/drafts/` is the draft backlog surface. Removal rules
(merged goals only, never-remove-unmerged) and the local-only-draft
warning (deleting an unpushed draft's worktree and branch loses the
draft ENTIRELY): `references/goal-records.md`.

## Frontmatter lifecycle (on `GOAL.md`)

```yaml
status: draft | promoted | blocked | started | completed | retired
type: feat # optional (EVA-145) — ABSENT means feat. The project's effective vocabulary (the built-in feat | bug | docs | research | chore, as reshaped by settings conventions.goalTypes — a project may add, redefine, or remove types) controls the accepted values; an off-vocabulary value refuses where it is typed. Set at draft (`goals draft --type`), the SOURCE OF TRUTH the tracker's `Type` group label mirrors at promotion (Title Case labels over lowercase ids, EVA-148; when the tracked labels.md arms the stamp); picks the title grammar the naming lint applies (the type's declared grammar — built-in: bug = symptom-descriptive, the rest verb-first). Scalar — one primary type per goal.
# The BOUNDED enum (EVA-138 status model). `blocked` is MATERIALIZED BY
# MACHINERY from unmet blocked_by edges — derived truth written for
# readability and tracker sync, NEVER hand-set (the loader refuses a
# hand-set one). `retired` is the promoted-tier terminal status
# (cancelled/won't-do — the record survives; `goals retire` sets it,
# with its `retired:` stamp). `completed` remains the only LOCKING value.
created: <ISO 8601>
promoted: <ISO 8601> # set at promotion
issue_url: <url> # set at promotion (tracker issue link)
tracker_state: In Progress # optional (EVA-83) — the tracker state THIS TOOL last set; written by the promoted/started transitions, never by hand. See Tracker lifecycle sync
started: <ISO 8601> # set when a coding-agent session is launched against this goal
completed: <ISO 8601> # set ONLY by the executing agent (together with status: completed), once the goal's green gates pass
retired: <ISO 8601> # set by `goals retire` together with status: retired — the pair exists together or not at all
released: <ISO 8601> # optional (EVA-138) — the owner's recorded release for adoption (`goals release`; status walks back to promoted)
adopted: <ISO 8601> # optional (EVA-138) — stamped by `goals adopt` when another developer takes the goal
stacked_on: ABC-7-parent-slug # optional — the unmerged parent branch this goal stacks on (see Stacked goals)
blocked_by: [ABC-1, ABC-2] # optional (EVA-138) — dependency edges, the promoted-tier sibling of stacked_on; flow array of same-tracker keys only (v1). Readiness DERIVES from it: a blocker is met exactly when its record is on the integration branch. See Multi-developer collaboration
import_issue: ABC-123 # optional (EVA-138) — set by `goals adopt --issue`: the imported issue this draft refines; promote reuses it as its default --issue (import_issue_url beside it)
# optional (EVA-45) — per-goal round-budget/engines override; mirrors the
# settings review.rounds/review.engines shape exactly, unknown keys error
# loudly. Nested maps + [a, b] flow ARRAYS only — flow maps like
# `goal: { soft: 3 }` are not part of the accepted grammar:
review:
  rounds:
    goal:
      soft: 3
      hard: 6
  engines:
    goal: [codex]
  # optional (EVA-90) — the right-sizing plan's own keys, same mirror:
  wave: false # does this goal's gate include the blind wave at all?
  models: # the confirmed reviewer pairing, per interactive engine
    codex: gpt-5-6-sol
execution: # optional (EVA-90) — mirrors the settings `execution.*` shape
  model: claude-sonnet-5 # the executor model, and the reviewer floor
plan_accepted: <ISO 8601> # optional (EVA-90) — set by `goals plan --accept`: the HITL receipt for the keys above
compaction_soft: 300000 # optional — goal-aware compaction soft threshold in TOKENS, bare positive integer; PINS this goal's soft threshold over the per-model row (EVA-47/EVA-85; see Executor compaction)
compaction_hard: 500000 # optional — hard threshold, same unit/format; a malformed value REFUSES `goals execute` loudly (retry after fixing; the compact verb itself only reports policy errors)
compaction_strategy: reset # optional (EVA-89) — `compact` (default) or `reset`; which mechanic the outside hand uses to reclaim this goal's context. This is the per-goal knob the strategy A/B alternates; a malformed value pins `compact` and reports why, never throws
# optional (EVA-86) — WHICH SERVICES this goal's worktree provisions,
# named from the project's own `worktree.flags` vocabulary. An
# undeclared flag takes its settings default; an unknown NAME refuses
# loudly. Values are `true`, `false`, one of the flag's declared
# values, or a nested config map:
flags:
  supabase: true
  compose: false
  database: postgres
```

`review:`, `execution:` and `flags:` are the nested frontmatter keys
(the flat-scalar machinery preserves each block verbatim). `review:`
and `execution:`' children are single snake_case words; `flags:`'
children are FLAG NAMES drawn from the project's own `worktree.flags`
vocabulary, so their grammar is that vocabulary's — letter-led, then
letters, digits, `_` or `-` (a hyphenated flag name is legal in all
three places it appears: settings key, frontmatter key, `wtx.flags`
property). `review:` and `execution:` MIRROR the settings shape exactly
and sit between the settings and the verbs' CLI flags in the precedence
chain, per leaf. `review:` came first (EVA-45: round budgets and engine
rosters — `references/goal-reviews.md`, "Round budget"); EVA-90 added
`review.wave` / `review.models` and the `execution:` block, which
together are the recorded right-sizing plan
(`references/right-sizing.md`). Compaction thresholds keep their FLAT
`compaction_soft` / `compaction_hard` spelling — moving them would break
every locked goal that carries them. `flags:` (EVA-86) is the one nested
key that mirrors no settings SUBTREE: settings declare the vocabulary
(`worktree.flags`), the goal declares its values.

**`flags:` — per-worktree service flags (EVA-86).** Three or four
concurrent goals used to mean three or four full service stacks: the
worktree config provisioned everything for every goal, docs-only ones
included. The project now declares a flag VOCABULARY in its settings
(`worktree.flags`: each flag's own default, optional closed value set,
and a description), a goal declares only what it needs here, and
`worktrees(wtx)` branches on `wtx.flags` to decide what to spin up.
Consequences worth knowing while drafting:

- **"Does this goal need a database?" is a grilling-grade question** —
  settle it at draft/grill time, the same way `stages` and the round
  budget get settled, so the launch provisions right the first time.
- **Flags settle at LAUNCH, mechanically.** There is no in-place
  re-provision: a goal that discovers mid-execution that it needs a
  service edits this block and RELAUNCHES. Editing it mid-flight
  changes nothing until something re-provisions — the map the launch
  resolved is persisted and every later env verb reads it, so a
  teardown can never act on a service the edit merely hid. A service
  behind an off flag refuses by NAME (`wtx.requireFlag`), never as a
  mystery connection failure.
- **Reviewer worktrees resolve all-off**, structurally — an ephemeral
  reviewer checkout carries no goal record, and a worktree that
  declares nothing provisions nothing. That is EVA-79's
  reviewers-never-launch-services policy stated by the environment
  rather than by prompt discipline.
- A project that declares no vocabulary is unaffected: every goal
  resolves an empty flag map and nothing branches.
- **A flag may have NO default and be ASKED instead (EVA-117).** For a
  resource STRATEGY — how a goal gets its database, whether it forks an
  expensive artifact — every possible default is wrong for somebody, so
  the project declares that flag `ask: true` and a goal that never
  declared it is asked AT LAUNCH, with the answer recorded into this
  block. An agent-driven (non-interactive) launch with no
  `--flag <name>=<value>` answer REFUSES rather than guessing, which is
  the seam where an interactive session puts the question to the user as
  a picker and re-runs with the answer.
- **The same flags reach the PROMOTION and MERGE moments (EVA-117).**
  `wtx.moment` tells the project's `worktrees()` config which moment it
  is serving (`provision` | `promote` | `merge`), so one
  conditional-logic home covers all three: `onPromote` prepares what a
  freshly-real goal declared, and `onMerge` runs inside `goals merge`'s
  landing lock, where the shared environment's catch-up belongs. Which
  strategies exist and what they mean stay the PROJECT's business —
  evie-kit sees moments and flag values, never a specific stack.

Frontmatter keys are always **snake_case** (`issue_url`), never camelCase.
A legacy `resources:` key (EVA-11's declared-resource ledger, superseded
by EVA-24's environment hook — see Concurrent goals) is tolerated and
ignored wherever it still appears in locked goals: never author it, never
error on it.

`completed` is the single source of ground truth for "is this goal done."
Everything else (herdr `done`/`idle` state, `.done` files from
non-interactive reviewers, a detached process noticing a pane went quiet) is
a _signal that something should go check_, never itself proof of completion.
A goal whose frontmatter has `completed` set is **locked** — hard rule, no
reopening, no resuming: the locked folder is the immutable record that
commit-pinned Linear permalinks, later goals' references, and rolled-forward
wayfinder maps are all built against, so editing it would silently rewrite
history other artifacts already cite (`GoalLockedError` enforces this in
every package write path). A bug found after completion produces a new goal
that references the old one; it does not reopen the old one.

## Lifecycle

The eight steps, in overview. The full operational detail for every
step — exact command flows, gate mechanics, refusal conditions, edge
cases — moved verbatim to `references/lifecycle.md`: read the
relevant step there BEFORE driving it.

1. **Draft.** `startDraft` (or `/goals draft` intake) creates
   `draft/<ts>-<slug>` from main directly into its own worktree and
   scaffolds the goal folder inside it (GOAL.md body:
   `references/templates.md`; commit policy:
   `references/goal-records.md`). All refinement happens inside the
   draft's worktree. **Never hand-scaffold a draft folder** — a folder
   with no draft branch and no worktree is one `promote` refuses ("runs
   from the draft's worktree on its `draft/<name>` branch"), and
   hand-rolling promotion around that refusal bypasses every invariant
   promotion enforces. If a loose folder already exists, whatever made
   it, `evie-kit goals adopt-draft <path>` retrofits the missing
   structure (EVA-102; recipe in `references/invoking.md`).
2. **Ideation / refinement.** Any mix of `grill-me`, goal reviews
   (`references/goal-reviews.md` — read it before running one),
   `adhd` passes, the `research` skill, wayfinder mode, or direct
   GOAL.md edits; interview transcripts always land in `grilling/`.
3. **Promotion.** Explicitly user-triggered, never a heuristic:
   rebase onto the base, run the intake review gate (EVA-62 — user
   sign-off on the verbatim intake, attested `--intake-reviewed`),
   then `evie-kit goals promote` — a tracker issue with
   commit-pinned permalinks (`tools.tracker.*`), folder moved to
   `goals/ABC-NNN-{slug}/` via `git mv`, branch and worktree renamed
   to match, frontmatter `status: promoted`, goal critics dismissed.
   Promotion also ASSIGNS the issue and places it in the `promoted`
   state, proves every configured state name against the tracker
   first, and posts the draft's grill sessions as issue comments
   (EVA-113 — the first moment the Q&A has an issue to land on) — see
   Tracker lifecycle sync.
4. **Review-on-the-issue.** The primary review surface shifts to the
   tracker issue — shareable, durable, team-visible.
5. **Execution handoff.** First, size the lifecycle (EVA-90):
   `evie-kit goals plan ABC-NNN` recommends the shape — executor
   model, wave or no wave, finding-round budgets, engine rosters,
   reviewer models (a capability floor gates diversity) — the user
   confirms it at the launch seam, and `--accept` records exactly
   those keys in GOAL.md frontmatter, mirroring the settings shape.
   Skipping the seam is legal; it just leaves the goal with no plan.
   Read `references/right-sizing.md` before planning or before
   deciding a goal earns no wave. Then `evie-kit goals execute
ABC-NNN` adopts the goal's own worktree, runs the environment build (the committed
   `settings.ts` `buildWorktree` factory), refuses unisolated
   launches beside a running goal, and launches the executor behind
   the **git mistake guard** (EVA-33): a launch-scoped pre-push fence
   refusing any push that would update main or a stacked parent's ref
   on the goal repo's remote. The guard is a mistake guard,
   not a capability boundary — `--no-verify`, guard-config removal,
   git plumbing, forge-API merges, and re-spelled remote URLs bypass
   it openly (documented exclusions — ADR 0011). The delivered goal
   is a generated handoff instruction carrying the GOAL.md path, the
   guard notice, and the stop-at-lock contract. The launch SELF-ARMS
   the lock-watch companion (`evie-kit goals watch <KEY>`, EVA-68;
   spawned detached by `goals execute` since EVA-130 — `--no-watch`
   opts out), and the orchestrator steers the pane only through
   submitting channels (`evie-kit herdr send`, EVA-56 — raw
   `herdr agent send` types but never submits).
6. **Plan + execute.** The executing session builds its own plan and
   executes it, writing detailed narrative output to
   `results/RESULT.md` (format: `references/templates.md`).
7. **Green-gate review.** Green gates are authored in GOAL.md during
   drafting. The default gate for coding goals is a blind, concurrent
   multi-tool review wave the executor itself spawns
   (`evie-kit goals review`): reviewers see the change and the goal
   spec but never RESULT.md or each other, and land in
   `reviews/results-NNN/` with an `INDEX.md` whose merged findings and
   gate-evidence roll-up the executor fills by judgment. Before
   spawning the wave, the executor COMMITS its gate receipts to
   `results/GATES.md` (EVA-79; format: `references/templates.md`) —
   per gate the command with secret values redacted, exit code,
   headline counts, timestamp, and the tested commit — which reviewers
   audit with calibrated trust: coherence checks always (tested
   commits by ancestry, never equality — committing the receipts moves
   the head past them), spot-reruns of cheap gates only, never
   launching services, with a missing receipt itself a finding.
   Read `references/review-waves.md` BEFORE running a wave;
   content-heavy goals may declare a deterministic humanizer gate
   (`references/lifecycle.md`, step 7). Two right-sizing rules bind
   here (EVA-90): a goal whose confirmed plan is WAVELESS gates on its
   own green gates plus the same committed receipts — do not spawn a
   wave "to be safe"; and a round that verifies a fix batch declares
   itself (`goals review --purpose verification`), which exempts it
   from the finding-round budget instead of quietly consuming it.
8. **Completion.** Once the gates pass, the executor runs the
   authorship check (`evie-kit goals authorship <KEY>`, EVA-130 —
   every commit since launch must be executor- or override-covered;
   an unverified verdict is a foreign write to investigate before
   locking; mainline history the branch absorbed classifies as
   `inherited`, never foreign — EVA-157), then the lint gate's LOCK
   ELIGIBILITY check (`evie-kit lint eligibility`, EVA-209: the head
   descends from the tested commit with nothing exercised changed,
   and the deep tier is satisfied by valid Sonar evidence, a validated
   not-applicable, or a recorded user waiver — otherwise
   `--pause-if-blocked` records the EVA-93 waive-or-wait pause), finalizes
   `results/RESULT.md` and the gate receipts in `results/GATES.md`
   (adding the review wave's own row), sets `status: completed` and
   the `completed`
   timestamp, commits, pushes the goal branch, and stops —
   the sequence ENDS there (ADR 0011): no merging to main, no
   protected-ref pushes (the git mistake guard refuses them), no
   self-cleanup. A merge of the executor's OWN branch is refused by the
   merge guard too (EVA-213) — the forge and API spellings included,
   which the push fence never saw because a server-side merge moves no
   local ref. That refusal is not final: it tells the executor to raise
   the question through its runtime's question tool, and a user's
   recorded answer authorizes exactly one merge, on a receipt keyed to
   the goal, the repository, the target and the source sha. Consent to a
   LOCAL merge never licenses publishing it. The consumed authorization
   shows up in `evie-kit goals authorship <KEY>` as an authorization
   consumed — never as proof the merge succeeded. Post-lock, `evie-kit goals cleanup <KEY>` is the
   orchestrator's follow-up, and the merge — with its five companion
   steps — belongs to the user (`references/lifecycle.md`, step 8).
   The **post-merge reconcile step** (EVA-87) is the FIRST of those
   companion steps, and it is mandatory: a project's `worktrees()`
   `reconcile` detectors are matched against the merge's own diff, and
   unacknowledged drift — main's database behind the migrations that
   just landed — holds the merge-complete declaration with the exact
   commands named, clearing in one step via `evie-kit goals reconcile
<KEY> --acknowledge ran | deferred`. It goes first because cleanup
   ordinarily runs at LOCK time, before the merge, where reconcile has
   nothing to answer yet. It never touches the shared environment and
   never gates the merge commit itself.
   The **estate reap** (EVA-103) is the LAST: `evie-kit goals reap
<KEY>` destroys what execution built and completion left standing —
   worktree, local branch (`-d`, never `-D`), the descriptor's service
   stack WITH its named volumes, and the herdr workspace — behind five
   gates that touch nothing when they refuse (locked, provably merged,
   the EVA-87 shared-environment hold clear,
   latest REVIEW ROUND reconciled, and no content beyond gitignored residue,
   which refuses listing every file and offers `--rescue-to <dir>`).
   It is deliberately a SEPARATE verb from cleanup: cleanup is
   bookkeeping — plus the EVA-157 seal, which chmods the locked goal
   folder read-only in its worktree (write bits only; reap/merge
   removal unseals first) — while reap destroys. Orphaned containers and volumes — estate
   whose worktree is already gone — are REPORTED with sizes and removal
   commands by `reap --all-merged --dry-run`, and deleted only via an
   explicit per-target flag; cleanup and the `/goals` door carry the
   unreaped-estate COUNT so accumulation is visible before a disk fills.

## Right-sizing the lifecycle (EVA-90)

Not every goal earns the same lifecycle. `evie-kit goals plan
<ABC-NNN>` recommends the shape from the goal's own spec — its size,
whether it touches code, and which risk surfaces it names — and the
user confirms it at the launch seam; `--accept` records the plan in
GOAL.md frontmatter in the SAME shape the settings use, so the round
verbs read it with no translation. Four rules, each grounded in this
goal's research report and the repo's own recorded conventions:

- **A capability floor gates diversity.** A reviewer must be at least
  as capable as the executor; among the models that clear the floor,
  prefer a different family. Diversity is a TIEBREAKER, never a reason
  to drop below the floor — a weaker reviewer measurably rewrites
  working code into failing code. Every degrade (same-family,
  self-review, below-floor, unknown model) is RECORDED and shown at the
  confirmation.
- **HITL always.** The recommendation is never binding and never
  self-applies; `plan_accepted` is the receipt that a human agreed.
- **Waveless is legal for the low tier** (docs/skill-text goals default
  to it), and accepting the plan IS accepting the skip — but a named
  risk surface is never waveless, and a waveless goal still commits its
  EVA-79 gate receipts.
- **Kind-aware caps, split before extra rounds.** The budget governs
  defect-FINDING rounds; a round declaring `--purpose verification` is
  exempt (that is how "findings plateau at ~2" and "results waves earn
  through 3–4" are both true). Past the diff-size thresholds the advice
  is to split the review UNIT — per-package or per-commit-range legs —
  rather than add a round over the same oversized diff.

Read `references/right-sizing.md` in full before running the verb,
changing the capability table, or deciding a goal earns no wave.

## Legal pauses (blocked on a human, EVA-93)

An executing session has TWO legal end-states, not one. Locking is the
first. The second: the goal's own spec reserves a decision for a human
(an approval gate, an ask the executor cannot answer), no in-scope work
is left, and the session records what it is blocked on and stops.

This exists because the reader that judges "is the goal met" is Claude
Code's NATIVE `/goal` evaluator, which reads the launch instruction —
so an instruction saying "continue until locked" told it to re-drive a
correctly-paused session. It did, nine times, until CC's stop-hook
block cap force-ended the loop (the CED-20 incident, 2026-08-05). The
fix is that the generated instruction now names the pause, and a
marker makes it verifiable instead of merely claimed:

- **The receipt**: `.evie-kit/handoffs/paused.json` — runtime state
  beside `compact-ready.json` (gitignored, dies with the worktree,
  never touches the frontmatter lock ladder). Required fields, all
  strings: `goal` (issue key), `gate` (the GOAL.md gate/ask it is
  blocked on), `ask` (the question the human must answer, in full),
  `written` (ISO 8601).
- **Cite the gate**: `gate` and `ask` are REQUIRED, and
  `evie-kit goals watch <KEY>` reports them verbatim
  (`executor-paused`) to the very person the pause claims to be waiting
  on — a hollow citation is refutable by the one reader who can refute
  it. A marker that skips them is reported LOUDLY as
  `pause-marker-invalid`, never accepted as a legal pause. Pausing to
  dodge work the goal expects the executor to do itself is the one
  abuse, and this is its guard.
- **The resume**: the pane is the substrate — the human answers, the
  EXECUTOR deletes its own marker and continues. `evie-kit goals
resume <KEY> "<answer>"` is the wrapper for answering remotely; it
  never clears the marker (that would fake a resume the session never
  observed), and it also RE-ARMS the session's `/goal` from the
  launch's recorded instruction — a legal pause satisfies CC's
  evaluator, so the contract clears with it, and an answered executor
  would otherwise run with nothing driving it to the lock. The ORDER is
  answer first: deliver, wait for the executor to delete its own
  marker, and only then re-arm. Re-arming first would install a
  contract that the standing pause already satisfies, which is the
  same stall wearing a fresh coat. If a session was answered but never
  re-armed, `--rearm-only` re-issues the contract alone (it refuses
  while a cited pause still stands). Answering in the pane cannot
  re-arm; the watch reports the clearing as `executor-resumed`.
- **Independent of compaction**: a paused executor is still compacted
  when it signals readiness (pausing is about work, not context) and
  its pause travels through the compaction — `goals compact` and
  `goals self-compact` both add a stay-paused clause when a cited
  marker is on disk (and a cite-it-or-delete-it clause for a hollow
  one), so the continuation does not march the compacted session past
  the gate.

Full mechanics, the watch events, and consumer-rollout guidance for
executors still running a pre-EVA-93 instruction:
`references/lifecycle.md`, step 6.

## Executor compaction (goal-aware, EVA-47)

Goal-aware compaction makes an executor's compaction timing a policy
decision instead of an uncontrolled auto-compact: at a milestone over
the soft threshold, the executor writes a mined handoff (the
`handoff` skill) and signals readiness via
`.evie-kit/handoffs/compact-ready.json`; the OUTSIDE HAND —
`evie-kit goals compact <KEY>`; a session can never self-invoke
`/compact` — types the compaction in, citing that handoff. The
`execution.compaction` soft/hard token thresholds are PER MODEL since
EVA-85: a built-in table sized from the token-horizon research supplies
whatever no layer pinned, resolved from the model the session actually
runs (settings pin < goal frontmatter < CLI flags over the row), so one
config compacts a 200k-window Haiku executor at 120k and a 1M-class one
at 500k. Which MECHANIC the outside hand uses is a policy decision too since
EVA-89: `execution.compaction.strategy` — `compact` (the default) or
`reset`, per goal via the `compaction_strategy` frontmatter key.
`reset` writes the marker-gated mined handoff, `/clear`s, and re-points
the fresh session at that handoff through a regenerated resume file
whose contract half is NORMATIVE and whose handoff half is POSITIONAL
(the gate wins any conflict, and the discrepancy is recorded). It ships
AVAILABLE-NOT-DEFAULT — the A/B on real goals decides any default flip
— and its failures fall back to compact loudly before the `/clear`,
alert with by-hand commands after it. Since EVA-105 the cycle does not end at the record: AUTO-CONTINUE puts
the session back to work. `goals watch` delivers for watched executors
and a hook-spawned one-shot (`evie-kit goals auto-continue`) covers
everything else, both through ONE guard core; a SessionStart hook covers
the cold/reset case, since a CC hook can detect a session starting but
only herdr can start its turn. An executor's nudge is a resume pointer
PLUS the driver reinstall — `/goal [<file>]`, whose file carries the
launch's own recorded instruction verbatim — because EVA-99's 2.5-day
stall was the missing `/goal`, not a missing "continue"; the
orchestrator's is pointer-only, and since EVA-218 the recorded
orchestrator's pointer carries its role-instruction path so the
continuation reloads the role — identity and generation unchanged,
never a `/goal`. Since EVA-112 EVERY `/goal` delivery
takes that bracket form and is VERIFIED: Claude Code stopped parsing
typed input past ~800 characters as a command, so the long inline
contract silently armed nothing for eight goals. An armed marker plus
the pane's own binding echo are the two oracles, they must AGREE, a
disagreement resolves away from armed, an unarmed launch fails loudly at
execute time, and a refused re-arm is retried by the watch at the next
idle window instead of ending the goal loop.
Five guards fail closed: a CITED pause stands it down (a hollow marker
rides the cite-it-or-delete-it clause), a locked goal is never nudged
past its lock, a guard whose own input is unreadable stands down rather
than reading "cannot tell" as consent, a shared per-session claim ledger
makes delivery single-shot, and `execution.autoContinue` / the flat
`auto_continue` frontmatter key are the opt-out — the one key in that
block whose ABSENCE means ON. A pane already running a turn is never
prompted, and a pane that never goes command-ready is withheld from
rather than fired into. A failed nudge warns, emits the watch's
`nudge-failed` event, and leaves a breadcrumb; it never blocks. That table, the context watchdog
(EVA-68), `evie-kit goals watch <KEY>` firing the verb for watched
executors, the self-arranged `goals self-compact` (EVA-73), the
reset sequence with the live `/clear` facts it rests on, and the
auto-continue guards in full:
`references/executor-compaction.md`.

## Tracker lifecycle sync (EVA-83)

The tracker used to be written once, at promotion, and never again — so
the board drifted from reality the moment execution started (the
evidence: six issues created unassigned in one day, a locked goal
sitting in Backlog for nineteen hours while it was secretly an unmerged
dangler, eight issues open against merged goals a day after a manual
21-issue sweep). Four lifecycle transitions are certain, and all four
now propagate:

| Event       | Fires at                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `promoted`  | `goals promote` — state + assignee at CREATION                                                                                            |
| `blocked`   | EVA-138: a block/unblock flip materializes (`goals block`, `promote --blocked-by`, the merge-time re-derivation) — default target Backlog |
| `started`   | `goals execute` (the `started` transition)                                                                                                |
| `completed` | `goals cleanup <KEY>` (durable lock proven)                                                                                               |
| `merged`    | `removeMergedGoalWorktree` (the merge companion)                                                                                          |
| `retired`   | EVA-138: `goals retire` — default target Canceled (Linear) / closed (GitHub)                                                              |

The two EVA-138 events are the ONLY ones with settings DEFAULTS.
They fire solely for goals using the collaboration features (declared
edges, an explicit retire), which is itself the opt-in. An explicit
name or `null` in `states` always wins, and promotion proves only
explicitly-configured names. The four original events keep the
configure-nothing-gets-nothing contract below unchanged, with one
scoped exception. The mechanical unblock walk-backs (merge flip,
sweep materialize, launch re-derivation, `goals unblock`, takeover)
fire `promoted` with a fire-site `Todo` fallback on Linear. The
default Backlog walk is therefore a round trip.

**Configuration is per project and per event** — `states` maps a
lifecycle event to a tracker state NAME, resolved to an id at runtime
(a committed UUID is unreadable in a diff and breaks silently when a
workflow is edited). `null` is the deliberate never-auto-transition
opt-out, and an absent key is the same no-op: **a project that
configures nothing gets no transitions**, exactly as before.

```ts
tools: {
  tracker: {
    linear: {
      team: "EVA",
      project: "Evie Agent",
      assignee: "me",          // default; a name/email/id, or null for unassigned
      states: {
        promoted: "Todo",
        started: "In Progress",
        completed: "In Review", // a human gate — deliberately NOT Done
        merged: null,           // never auto-transition
      },
    },
  },
}
```

The GitHub tracker takes the same two keys, with its own vocabulary:
`assignee` is a login or `@me`, and `states` values may only be `open`
or `closed` (validated at settings-load time, since that IS the whole
GitHub state space).

### Epics and initiatives (EVA-236, opt-in)

Some projects use Linear PROJECTS as epics under Linear INITIATIVES.
That is declared by the PRESENCE of one more block under the Linear
tracker. It is the presence-is-the-selection rule every `tools.*`
axis follows, so projects without the pattern change nothing:

```ts
tools: {
  tracker: {
    linear: {
      team: "EVA",
      project: "Evie Kit",
      hierarchy: {
        mode: "prompt",          // default: ask at every map promotion
        default: "attach-epic",  // preselected; under "always" it is required and may not be attach-epic
        initiative: "Roadmap 2026", // the initiative created/attached epics link under
      },
    },
  },
}
```

What the block changes, and nothing else:

- **Map promotion raises the map-shape seam** (Lifecycle seams above).
  A draft carrying `wayfinder/MAP.md` stops at `goals promote` with the
  four shapes and the team's epics WITH descriptions. The answer
  re-runs the verb with `--map-shape`. The record lands in MAP.md's
  `## Tracker` section, and a placed map is never re-shaped: a later
  step goal files into its recorded epic with no picker.
- **Writes after the map's issue exists never strand it.** A waypoint
  the tracker refuses is recorded on the map as `unminted`, and a
  failed initiative link warns. The promotion stands either way.
- **Initiatives are RECORD-ONLY.** Humans create initiatives in
  Linear. The kit links an epic under the one it is told about
  (`hierarchy.initiative`, or `--initiative`), and an unknown name
  refuses before any mutation. Membership is a fact about the EPIC,
  recorded on the map and never stamped per goal.
- **Imported and pre-created issues keep their placement.** `goals
adopt --issue` and `promote --issue` record the project the humans
  filed the issue in as `linear_project`, and never move it. An issue
  Linear reports in no project clears a stale placement.
- **The save-select groups by epic.** Bare `/goals` renders the open
  band one group per `linear_project`, unplaced goals last. A draft
  sits there too, unless `adopt --issue` imported it from an issue
  that already has a project.
- **GitHub refuses the block** with a teaching message: the GitHub
  tracker has no projects-as-epics or initiatives surface in the kit.

The rules that govern every transition:

- **Never blocking.** An unreachable tracker, an unresolvable state
  name at merge time, a goal with no issue: each warns visibly and the
  lifecycle continues. In `goals cleanup`'s outcome JSON the tracker row
  is `synced` / `diverged` / `warned` / `absent` — never `failed`, so it
  cannot drive the verb's nonzero exit.
- **Never move an issue a human moved.** Each transition records the
  state it set as the goal's `tracker_state` frontmatter stamp; the next
  transition moves the issue only when the current state IS that stamp,
  or when the tracker's own history says this credential made the last
  state change (or that nobody ever moved it). Anything else is left
  alone and REPORTED as a divergence. A locked goal is never edited, so
  post-lock events (`completed`, `merged`) cannot stamp — history is
  what carries the proof there, and an unreadable history means leave
  it alone.
- **Unresolvable names fail at PROMOTION**, where a human is present:
  `goals promote` proves every configured state name against the team's
  real workflow before it touches git. On the `--issue` escape hatch,
  where there may be no credential at all, a check that CANNOT RUN is
  advisory — but a tracker that answered (no such team, no such state
  name) has given a definite verdict on the configuration, and that stays
  loud on both paths.
- **Assignment happens at promotion** — `--assignee` beats the settings
  `assignee` key beats the credential's own owner (`me` / `@me`). Linear
  resolves the assignee to a user id and the issue is born owned; GitHub
  assigns in a second call right after creation, because
  `gh issue create --assignee` is fatal when the login is not an
  assignable collaborator and an unowned issue must never cost a
  promotion (a failure there warns and names
  `tools.tracker.github.assignee: null`).
- **Agent-passed issue facts are verified** where a credential exists
  (the promote-time split brain, ask 4): `--issue` naming an issue the
  tracker does not have, an `--issue-url` whose URL is not the tracker's
  own canonical URL for that issue, or a Linear key from a team other
  than the configured one, is refused; a tracker that cannot be reached
  records the facts UNVERIFIED, loudly, rather than blocking the
  promotion.
- **A failed launch takes its transition back.** `goals execute` moves
  the issue to `started` before the started commit, and a launch that
  then fails rewinds that commit — so the rollback also walks the
  tracker back to the `promoted` state, through the same
  never-move-a-human-moved-issue policy. A board saying "Started" for a
  goal with no executor running is the drift this exists to end.

### The back-fill sweep: `goals tracker sync` (EVA-113)

Transitions stop the drift going FORWARD. What accumulated before they
existed — while a project left `states` unconfigured, and wherever a
transition warned and continued — is repaired by one batch verb:

```bash
evie-kit goals tracker sync                 # the plan; writes nothing
evie-kit goals tracker sync --apply         # perform it
evie-kit goals tracker sync EVA-83 EVA-90   # scoped to named goals
```

- **Dry-run by default** (grill Q1, the `reap` precedent): a first run on
  a drifted board is always sighted. `--apply` performs the plan.
- **Every goal the repo records**, across both record surfaces: the
  integration branch's tree (merged, locked goals — read through `git
show`, never edited) and `.worktrees/` (every live record).
- **The resting state** is the latest lifecycle event the goal has
  REACHED that has a configured target. That is what makes `merged: null`
  mean what it says: a merged goal then rests where `completed` left it,
  instead of being read as "nothing to reconcile".
- **Board-only for locked goals** (grill Q2); unlocked goals also get
  their `tracker_state` stamp back, so the next forward transition
  regains its proof without a history query (grill Q5).
- **Assignee back-fill is empty-only** — a human's assignment is never
  overwritten, and this is the axis that catches the born-unassigned
  class (a dry run on this repo's own board found 91 of them).
- The same two rules bind as at every transition: never move an issue a
  human moved, and never block. Rows read `synced` / `diverged` /
  `warned` / `absent` — the cleanup verb's vocabulary, never `failed`.
- `goals cleanup` runs the sweep for the goal it just cleaned, in
  PLAN-ONLY form, and prints what still disagrees (grill Q5's cadence
  decision) — the train close-out companion.

Note the spelling: the top-level `goals sync` did and still does teach
`resync` (worktree re-provisioning, EVA-39). The board sweep is
`tracker sync`.

### Lifecycle comments on the issue (EVA-113)

A goal's issue used to be written twice — created at promotion, moved by
the transitions — and read by a human with no way to see what happened in
between. Four moments now comment on it (grill Q4, the user-shaped set):

| Event          | Fires at                                 | Carries                               |
| -------------- | ---------------------------------------- | ------------------------------------- |
| `launch`       | `goals execute`, after the handoff lands | the accepted plan's facts             |
| `review-round` | after a round's INDEX.md is RECONCILED   | the consolidated findings             |
| `compaction`   | `goals compact` (either mechanic)        | the mined handoff pointer             |
| `grill`        | `goals promote`, per session file        | the Q&A, unless the issue body has it |

Three of the four post themselves. `grill` fires at PROMOTION rather than
at the end of a session for a structural reason: grilling happens while
the goal is a draft, and a draft has no issue — promotion is the first
moment the Q&A has anywhere to go, so it posts every session the draft
accumulated, one comment each.

The one that cannot fire automatically is the review round: its
consolidated findings are the executor's own merge judgment, written
after the wave verb returns. Post it — and a post-promotion grill —
with the mouth, from the goal's worktree:

```bash
evie-kit goals tracker comment --event review-round   # latest round; --round results-002 to pin
evie-kit goals tracker comment --event grill          # latest session; skipped if already in the description
```

**Reconciling a review round ends with posting it.** The wave verb prints
the exact command; the round is not closed out until the findings are on
the issue.

Comments are **opt-OUT**, unlike states — a project that configures
nothing gets them, because a comment only ever adds to an issue's
history, where a state move can fight a human over a column:

```ts
// .evie-kit/settings.ts — the same nesting the tracker block already uses
tools: {
  tracker: {
    linear: {
      team: "EVA",
      comments: false,            // every event off
      // comments: { grill: false, "review-round": false },  // per event
    },
  },
},
```

Every comment carries a marker footer (`_evie-kit:review-round:results-002_`),
so a re-run reports `duplicate` instead of posting twice; `--force`
overrides. Bodies are unwrapped for the external surface (EVA-66) and
oversized files are clipped with the truncation stated.

## Concurrent goals (parallel execution)

Multiple goals may execute at once on one machine (EVA-11): per-goal
worktrees, goal-scoped agent names and waves, and per-branch Sonar
projects make it structurally safe, and the committed `settings.ts`
`buildWorktree` factory's `isolated: true` assertion is what unlocks
overlapping launches — without it, `startGoalExecution` refuses to
launch while another goal is executing. Launches and merges stay
orchestrator-serialized. Full mechanism (the environment descriptor's
five lifecycle members, the launch refusal, merge re-verification):
`references/concurrent-goals.md`.

## Checkout profiles (what a goal worktree actually holds, EVA-96)

A goal worktree used to materialize everything its branch tracks: every
historical goal folder, and every heavy tracked artifact the goal will
never touch. Since EVA-96 each newly provisioned worktree gets a
**checkout profile** — per-worktree non-cone git sparse checkout,
composed from two unequal rules:

- **Settings-level excludes**, overridable — `worktrees().checkout.exclude`
  in gitignore syntax, refined by a repo-level `.checkoutignore` and
  then by a per-worktree `.checkoutignore.worktree` that a human or
  agent edits mid-goal (a re-encrypt goal's file is one line:
  `!data/accdb/*.duckdb.gpg`). They compose like nested `.gitignore`
  files — concatenated, last match wins.
- **Active-goal scoping of `goals/`**, INVARIANT — the active goal and
  its `stacked_on` ancestors are materialized; every other goal folder
  is not. Never widened, by design.

What this changes for an executor working inside such a worktree:

- **`goals/` holds your goal and its ancestors, and that is not a bug.**
  A generated `goals/EXCLUDED.md` lists what is hidden, with `git show`
  commands pinned to a real commit.
- **To read a prior goal, use `evie-kit goals read <KEY>`** — it
  stages that folder read-only into `.goal-imports/<KEY>/` from the
  shared object store and appends a `LEDGER.jsonl` line. It resolves a
  stacked-but-unmerged ancestor via its branch tip, so an unmerged
  parent is readable too. If something you find there is load-bearing,
  COPY it into your goal's `references/` with its lineage (path +
  commit hash): goal records should be self-contained, and a ledger
  entry with neither a reference copy nor a citation is what the
  lock-time lint flags.
- **If a file you expected is missing, `evie-kit goals unsparse` ends
  it** — idempotent, restores a COMPLETE checkout, and it is named in
  every sparse-related error this feature can produce. The narrower
  alternative is a `!`-negated line in `.checkoutignore.worktree`,
  which the next goals verb picks up.
- **Errors always degrade toward MORE files.** An unparseable
  frontmatter, a broken `stacked_on`, a bad pattern: each provisions a
  complete checkout with one warning, never a partial profile. A degrade
  is RECORDED (EVA-97): the worktree keeps a stamp saying "managed, and
  currently complete", so the next goals verb re-computes and the
  worktree converges again the moment the input is fixed. Only
  `goals unsparse` clears that stamp — the panic verb's answer is meant
  to stick.
- **Existing worktrees are untouched.** Profiles apply to newly
  provisioned worktrees only; generations never mix, and nothing is
  retrofitted under a running executor. PROMOTION is the one lifecycle
  step that re-provisions (EVA-97): it renames the goal's folder out of
  `goals/drafts/`, which no draft profile can name, so the profile comes
  off for the move and goes back on under the promoted name.
- **Reviewer worktrees carry the goal UNDER REVIEW and no other goal
  record** — the reviewer prompt points at that goal's GOAL.md, so its
  folder must be readable — and the wave's preflight FAILS on any other
  goal's materialized record or a non-empty `.goal-imports/`:
  blindness as a checked invariant rather than a prompt rule. Two
  limits, stated rather than glossed: prior rounds OF THE REVIEWED GOAL
  live inside its own folder and are still materialized (the prompt's
  read rules carry that part), and it is not a sandbox — `git log` and
  `git show` reach everything the profile hid.
- **Turning `scopeGoals` off turns PHYSICAL blindness off with it**
  (EVA-97). The switch is legitimate — a goal whose subject IS the goals
  corpus needs the corpus — and a wave still runs under it; what changes
  is that reviewer trees then carry every goal record and blindness is
  back to being a prompt rule. The wave says so out loud rather than
  failing every interactive reviewer's setup.

The per-path behavior table covering BOTH worktree surfaces (this one
and `baseFiles`) is `references/worktree-paths.md` — read it before
declaring either.

## Stacked goals (building on an unmerged parent)

A goal that depends on another goal's still-unmerged branch drafts
STACKED on the parent (`stackedOn` at draft time, recorded as
`stacked_on` frontmatter) instead of stalling. True merge commits
make stacking cheap: zero restacking when the parent merges;
promotion rebases onto the parent, review waves diff
`<parent>...HEAD`, and stacks land parent-first — the child PR then
simply retargets to main, no rebase. Full mechanics and caveats:
`references/stacked-goals.md`.

## Wayfinder mode (oversized ideas)

If, during drafting, breadth-first grilling reveals real fog — open
questions that keep spawning further open questions, not resolvable in
one execution session (a judgment call made during `grill-me`, not a
mechanical threshold) — don't force the idea into one oversized goal:
chart it as a **wayfinder map** and resolve tickets one at a time until
the way to the destination is clear. The map lives as `MAP.md` in the
active goal's own `wayfinder/` subfolder and is recrafted forward
goal-by-goal as each goal locks. Read `references/wayfinder.md` (in
full) before charting, working through, or recrafting any map — it
holds the when-to-chart test, the canonical `MAP.md` body, ticket types,
the fog-of-war discipline, the one-execution-loop-at-a-time hard rule,
and both invocation sub-modes.

## Multi-developer collaboration (EVA-138)

Two developers plan a roadmap of interdependent goals into one board
and hand specific goals to whichever developer takes them. The
adoptee references just the issue key or draft name and takes the
work to completion. Three pieces, summarized here; the full
operational reference is `references/collaboration.md` — read it
before declaring dependency edges, adopting a goal, or importing an
issue:

- **Dependency-derived backlog.** A promoted goal declares
  `blocked_by: [KEYS]`. Readiness DERIVES — a blocker is met exactly
  when its record is on the integration branch — and the `blocked`
  status is a machinery-materialized cache of that derivation.
  `goals list` renders the backlog band from the live derivation.
  The last blocker's `goals merge` flips the dependent mechanically,
  behind a publication gate. The flip is a recorded commit, a tracker
  walk out of Backlog, and a `goal-unblocked` event through the
  EVA-136 bus to wake the holder. That seam is the re-grill picker
  above, never an auto-execute. A dependent held on another machine
  converges at its holder's `goals tracker sync` or next
  `goals execute`; both fetch the integration branch and re-derive.
  `goals block/unblock` cover edges discovered
  later; `promote --blocked-by` wires them from a wayfinder map's
  edges at promotion.
- **Cross-developer adoption.** `goals adopt <KEY|draft/<name>>`
  fetches the branch, mints the mirror worktree, and provisions the
  estate (this machine's settings.local/.envrc.local via the copy
  stage, plus `bun install`). The adoption records as a forward
  commit whose PUSH is the claim — a lost push stops loudly before
  the issue is reassigned. Etiquette (grilled): parked/backlog goals
  adopt freely; a STARTED goal needs the owner's recorded
  `goals release` or the adoptee's explicit `--takeover`, both
  posted to the issue. The takeover fails closed when its handshake
  cannot post. Distinct from `adopt-draft` (EVA-102 — a
  LOOSE LOCAL folder).
- **Issue-import-as-intake.** `goals adopt --issue KEY` for an issue
  with no goal behind it. The issue's description and comments land
  byte-for-byte as the draft's `references/intake.md`, and the normal
  refinement lifecycle follows. Promotion reuses the SAME issue — the
  draft's `import_issue` frontmatter is promote's default `--issue`.

Tracker identity is settings-driven, keyed by whose API key acts
(grilled decision 2). The documented pattern is a dedicated agent
tracker user on `apiKey`, with the optional dual-key split
(`claimApiKey`/`claimToken`) routing assignment/claiming to a second
identity — `references/collaboration.md` carries the setup. The
status enum maps to tracker states through `tools.tracker.*.states`,
with settings defaults for the two new events only (`blocked` →
Backlog, `retired` → Canceled/closed). Explicit names or `null` win;
the pre-EVA-138 events keep their configure-nothing-gets-nothing
contract, the unblock walk-back's fallback Todo being the one scoped
exception above.

## Invoking `@evie-kit/goals`

The lifecycle verbs are library functions riding the unified CLI —
`evie-kit goals draft | adopt-draft | adopt | share | list | completed |
context | rebase
| promote | plan | execute | restart | liveness | block | unblock |
retire | release |
review | goal-review | compact |
self-compact | auto-continue | session-start | watch | resume | rebind |
orchestrate | requests |
env | reconcile | tracker | cleanup | reap | read | unsparse` — per the
one-bin rule (the only bin any
`@evie-kit/*` package registers is `evie-kit`); the `bun`
one-liners remain the escape hatch and the orchestrator's
programmatic surface. The verified per-verb invocation recipes and
the package's full export surface live in `references/invoking.md`;
read the relevant recipe before driving a step.

## Non-goals and follow-ups

Scopes this skill explicitly defers (Notion as a review surface,
non-Claude-Code executors, tracker-canonical wayfinder maps,
memory-layer integration, and more) plus tracked follow-ups live in
`references/non-goals.md` — check it before proposing work adjacent
to the lifecycle, so deferred scope stays deferred.
