# Executor compaction (goal-aware, EVA-47)

> Moved from `SKILL.md` (EVA-78 progressive-disclosure restructure),
> verbatim except the `goals compact` matcher bullet, corrected to the
> EVA-48 `executorAgentMatchNames` contract. Mentions of other sections
> may point at `SKILL.md`'s summaries or at sibling files in
> `references/`.

An executor session runs for hours and its context fills; without
intervention it hits an UNCONTROLLED auto-compact at whatever moment the
model limit dictates — plausibly mid-acquisition, exactly when maximum
headroom matters. Goal-aware compaction makes the timing a policy
decision instead:

- **The cycle**: write the mined handoff (the `handoff` skill), then the
  OUTSIDE HAND — `evie-kit goals compact <KEY>` — types a literal
  `/compact <instructions referencing the handoff path>` into the
  executor's pane via herdr (the same channel `/rc` rides). Native CC
  compaction then reads the handoff and preserves what the goal needs.
  Verified empirically (EVA-47 gate 1): the `/goal` binding SURVIVES a
  typed `/compact` — the evaluator still judges and clears the goal
  afterwards — because `/compact` summarizes and CONTINUES the same
  session (unlike `/clear`, which wipes it). Twice-verified: the goal's
  own probe saw the `✔ Goal achieved` banner post-compact, and an
  independent orchestrator probe additionally caught herdr's
  `agent_status: done` — `done` is transient-but-real, so poll for it
  but treat the banner as the durable screen evidence.
- **A session cannot self-invoke `/compact`** (EVA-41 stated limit:
  slash commands are user-typed, no tool equivalent). The verb is the
  outside hand; threshold AUTOMATION is a watcher or the orchestrator
  invoking it — the executor's own role at a soft-threshold milestone is
  to write the mined handoff and SIGNAL readiness, never to compact
  itself. What a session CAN do since EVA-73 is ARRANGE the outside
  hand for its own pane — see "The self-arranged outside hand" below.
- **Handoffs carry the identity frontmatter (EVA-73)** — snake_case
  `session_id`, `session_name` (when named), `written`, `context_used`;
  `evie-kit handoff identity` prints the block, and the PostCompact
  record-closer (`packages/handoff/src/postcompact-handoff.ts`, wired
  beside the PreCompact safety net) stamps `compacted_at` into the
  session's handoffs when a compaction completes and writes the
  `.evie-kit/handoffs/compact-done.json` completion marker. Every
  /compact advice surface cites the SPECIFIC handoff path — never "the
  newest handoff", which races the directory's concurrent cc/codex
  writers.
- **Thresholds** (`execution.compaction`, in tokens, always BELOW the
  running model's own window): **soft** = opportunistic — over it AND
  at a clean stopping point (a milestone, a committed seam), take the
  moment; **hard** = aggressive — over it, compact promptly without
  waiting for a seam. ABSENT block = feature off, no behavior change.
  Three-layer precedence, per field: settings default < goal frontmatter
  (`compaction_soft` / `compaction_hard` — flat snake_case, because
  GOAL.md frontmatter is flat scalars) < CLI flags (`goals execute
--compaction-soft/--compaction-hard`; `goals compact --soft/--hard`).
  When thresholds resolve, the generated execution-handoff instruction
  carries the soft-threshold contract to the executor.
- **UPGRADE NOTE (EVA-85):** a PRESENT `execution.compaction` block now
  turns the feature ON even when it is EMPTY — before EVA-85 an empty
  block resolved no thresholds and read as off. Projects carrying
  `execution.compaction: {}` acquire an enforcing watchdog on the next
  pull; REMOVE the block to opt out. Pinned pairs are unaffected.
- **The thresholds are PER MODEL (EVA-85).** One flat pair was wrong in
  both directions: Claude Haiku 4.5's whole window is 200k, so a 300k
  soft threshold could never fire on a Haiku executor, while a 1M-class
  Fable/Opus session compacted three times more often than the research
  supports. Those three layers are now PINS over a built-in table
  (`packages/goals/src/compactionModels.ts`) mined from
  `docs/research/models/frontier-model-token-horizons.md` and
  `docs/research/models/model-token-horizons-for-compaction.md`, with each
  row carrying its report and confidence in a comment so a future
  third-party eval revises it deliberately. Whatever no layer pinned
  comes from the row for the model the SESSION IS ACTUALLY RUNNING —
  so `execution.compaction: {}` (present, nothing pinned) is the
  normal opt-in, and one config serves every executor correctly.
  Matching tolerates the spellings that actually occur: dated ids
  (`claude-haiku-4-5-20251001`), Claude Code's generation aliases
  (`opus`, `sonnet[1m]`), Bedrock/Vertex ids, and dotted vendor ids;
  an unmatched model takes the conservative 300k/500k fallback, except
  that an unmatched id naming a known Claude tier takes the SAFER of
  that tier's row and the fallback (which is what keeps the Haiku bug
  class closed for ids nobody has tabled yet). Settings may revise or
  add rows (`execution.compaction.models`) and replace the fallback
  (`execution.compaction.fallback`).
- **Which model, resolved where.** Every consumer resolves the SAME
  table by the model it can actually observe: `goals execute` uses its
  `--model` flag and announces the derivation model alongside the pair
  (`EVIE_KIT_COMPACTION_MODEL`, `unknown` when the launch could not
  tell); the in-session watchdog reads `message.model` off the
  session's own transcript — the ground truth — and RE-RESOLVES
  locally whenever the announcement was sized for a different model
  (a pinned, model-independent announcement always stands); `goals
compact` reads the executor pane's CC session id
  (`agent_session.value`) and takes the model from that session's
  transcript. `goals self-compact` is the delivery arm of a decision
  the watchdog already made, so it ENFORCES nothing — but it resolves
  the same map by the same session-model chain and REPORTS what it saw
  (`policy`, `model`, `policyError`), which is what makes the three
  consumers' agreement checkable rather than assumed. Unreadable model
  = "unknown" = the conservative fallback row; telemetry never blocks
  a compaction.
- **The readiness signal**: the executor writes
  `.evie-kit/handoffs/compact-ready.json` — valid JSON, string
  fields:
  `{"goal":"<KEY>","handoff":"<worktree-relative path>","written":"<ISO-8601>"}`
  — after its mined handoff. A marker file, because herdr's five-state
  agent vocabulary has no custom-signal channel and a `/goal`-gated
  executor cannot reliably park itself idle (the Stop-hook evaluator
  keeps re-driving it). The verb uses the marker's handoff path without
  re-prompting and consumes the marker only after a RESPONSIVE
  compaction (a failed send preserves it for retry); a marker naming a
  different goal, or with malformed fields, is ignored — never a crash.
  The HARD-threshold path never depends on it: the verb compacts with
  or without a signal, so a watcher can compel a silent executor.
- **Verb behavior**: `goals compact <KEY>` refuses when no executor pane
  matches `executorAgentMatchNames(goalName)` — the current
  `<KEY>-<slug>-cc` name first, the legacy `<KEY>-cc` shape during the
  deploy window (EVA-48); by default it prompts the
  executor to run the handoff skill (the prompt teaches the marker path
  and JSON shape) and waits for the READINESS MARKER — a fresh handoff
  file alone is not readiness, the skill's gap pass and self-validation
  run after the first write. On timeout (`--handoff-timeout <seconds>`,
  default 10m) it DEGRADES rather than refusing (`handoffTimedOut`):
  the newest mined handoff that appeared since the prompt is cited when
  one exists, else the safety net. `--skip-handoff` relies on the
  PreCompact safety net directly and beats even a readiness marker (a
  manual `/compact` fires the PreCompact hook; a pre-existing mined
  handoff is never cited — it describes an earlier point in the
  session); `--handoff <path>` pins an explicit file. Marker
  consumption re-reads at verdict time, so a marker written at any
  point before a responsive compaction is spent — never leaked to the
  next run.
  `responsive` in the report requires COMPACTION-SPECIFIC evidence — a
  Compacted banner that was not in the pre-send baseline, or observed
  compacting text that settles; generic working↔idle cycles never count
  (a `/goal`-gated executor's Stop hook re-drives ambient work) — and
  the report says which evidence won (`evidence`), whether the send had
  to go into a non-ready pane (`sentWhileBusy`; a `blocked` dialog is
  dismissed with one Escape first), and exits 1 when nothing was
  observed, because a quiet pane is exactly what a swallowed slash
  command looks like (concurrent pane writers can interleave; retry at
  a quieter moment). Threshold flags (`--soft`/`--hard`) and resolution
  problems are REPORTED (`policy`/`policyError`) and never block the
  compaction itself.
- **The context watchdog (EVA-68) — thresholds are self-triggering.**
  Sessions notice their own context pressure: a hook wired on Stop
  (primary) and PostToolUse (throttled fallback for hours-long turns,
  at most one evaluation per debounce window) reads REAL usage from
  the session transcript — the last assistant entry's `message.usage`
  (input + cache_read + cache_creation), tail-read only — and judges it
  against the same `execution.compaction` thresholds. Over SOFT, the
  hook asks for the mined handoff and the readiness marker at
  this/the next stopping point (EVA-47's milestone protocol, no human
  needed to prompt it) — and DELIVERY is honest about the channel: a
  Stop hook's only in-session injection is a block, so on a Stop fire
  the soft nudge is itself a `decision: "block"`, ONCE per crossing
  (the latch below), while mid-turn PostToolUse fires carry it as a
  passive note; soft vs hard is latch and urgency, not mechanism.
  Over HARD, a Stop fire BLOCKS and forces the handoff skill
  immediately, clean stopping point or not, re-firing each notice
  window until someone compacts. One implementation, both roles:
  executor and
  orchestrator are both CC sessions with repo-wired hooks. For an
  ORCHESTRATOR session (no watcher covers its pane) the nudges teach
  the SELF-ARRANGED outside hand (`goals self-compact`, below), the
  hard path additionally emits a desktop notification, and the
  paste-ready `/compact` — the SPECIFIC handoff path substituted, the
  USER typing it — remains the fallback for a session herdr does not
  host. What hooks cannot
  do stays external, deliberately: the watchdog never types `/compact`
  (a hook invoking `goals compact` against its own pane risks
  deadlock), and a dead session fires no hooks. Suppression is keyed
  by delivery channel: a mid-turn note never spends the Stop block's
  budget; hard blocks re-fire each 30m window until someone compacts,
  soft blocks latch once per crossing (re-armed when usage drops back
  below soft), and a fresh readiness marker — one meeting the SAME
  strict contract the auto-fire predicate demands — quiets both tiers:
  the next move is the outside hand's. An executor's thresholds are
  the LAUNCH-resolved policy riding its environment
  (`EVIE_KIT_COMPACTION_SOFT`/`_HARD`, injected by `goals execute`),
  so CLI-flag and worktree-derived layers bind the watchdog too. When
  (EVA-85) the announcement was derived for a DIFFERENT model than the
  transcript says this session runs, the watchdog re-resolves the
  per-model row locally rather than judging a 200k window on a 1M
  model's numbers — and a one-sided CLI pin survives that correction,
  because the launch also announces WHICH side it pinned
  (`EVIE_KIT_COMPACTION_PINNED`) and the re-resolution re-applies it.
  Only the model-derived side moves.
  Subordinate sessions are exempt: a detached-HEAD checkout (how
  blind-reviewer worktrees are minted) resolves feature-off, a LOCKED
  goal's checkout likewise, and every secondary CC session the
  lifecycle itself spawns (goal-review critics, wave reviewers in
  either isolation mode) is launched with the explicit kill switch —
  `EVIE_KIT_WATCHDOG=off` — in its environment.
- **The self-arranged outside hand (EVA-73, reshaped EVA-124)** —
  `evie-kit goals self-compact --handoff <path> [--goal <KEY>]
[--continuation <text>]` — closes the AFK gap for sessions no
  `goals watch` covers (the orchestrator above all). The session spawns
  it AT readiness, passing the mined handoff's SPECIFIC path directly;
  the verb detaches a one-shot worker (its own setsid session — it
  survives harness background-task reaping and the compaction itself).
  The pane comes from the AMBIENT env first (EVA-124): herdr stamps
  `HERDR_PANE_ID`/`HERDR_SESSION` into every pane, so a self-targeting
  helper knows exactly where it lives without a listing — the
  `agent_session` search (`herdr agent list`) is the fallback and the
  `--session-id`-another-session path. The worker waits for the pane to
  accept a command, types `/compact <the specific handoff path>`, then
  IMMEDIATELY queues the continuation — Claude Code queues typed input
  through the compaction lifecycle and delivers it after (the EVA-47
  double-fire record is the live evidence), so no completion marker is
  waited on; a queued-copy check keeps a retried worker from
  double-typing either line. The continuation's FORM is role-detected,
  minimally: a goal executor (`--goal` plus the launch's recorded
  execution instruction) gets the EVA-112 bracket-form `/goal` re-arm
  through the same armed oracle every `/goal` delivery uses (the worker
  keeps a bounded, report-only watch for the binding — an unproven arm
  exits nonzero, never retypes); every other session gets the plain
  resume-pointer line, after which the worker holds the per-session
  lease through a bounded, report-only completion observation
  (`--compact-timeout`, default 10m; evidence releases early; nothing
  further is typed) so `goals auto-continue`'s outside-hand stand-down
  keeps seeing a live holder.
  Genuinely outside herdr (no ambient env, no `agent_session` match) →
  loud refusal, and the caller falls back to the paste-ready command.
  Division of labor is unchanged: a WATCHED executor still signals
  `compact-ready.json` and lets `goals watch` fire the EVA-47 verb;
  self-arranging is for panes nothing watches — never both at once.
- **What the typed pair says (EVA-125, role-keyed guidance).** Both
  compaction paths compose from one template family with split
  semantics. The `/compact` argument speaks to the SUMMARIZER: the
  handoff path plus a preservation digest mined from the handoff's own
  sections (Where We're Going first, then Key Decisions, Where We Are,
  then Risks & Blockers / Open Questions — every mined specific a
  verbatim substring of the handoff, never paraphrased; a capped
  shortlist, with the cited handoff carrying the full record), inlined
  because `/compact` takes literal text only, and budgeted to 760
  characters total because CC stops dispatching typed commands near
  800 (EVA-112's measured bound; an oversized line would land as a
  plain prompt — and a line whose FIXED clauses alone overflow refuses
  before any pane I/O rather than being typed). The goal-contract and
  pause clauses are safety copy and are never crowded out. The
  CONTINUATION speaks to the resumed assistant and is STATE-AGNOSTIC:
  queued before the event, it cannot know the compaction ran (a live
  collision with human typing falsified the earlier "Compaction is
  behind you" opener), so it instructs the resume without asserting
  the event — only post-evidence deliverers (auto-continue's
  edge-triggered ladder) claim it. Paths with NO guaranteed
  continuation behind them — the paste-ready manual fallback, and the
  watched `goals compact` line (its auto-continue delivery has
  recorded withhold branches) — type the STANDALONE form instead: one
  line carrying the budgeted summarizer half AND the resume duties.
  Each cycle also records its exact
  pair as audit files in `.evie-kit/handoffs/`
  (`compaction-summary-instructions-<ts>.md`, with what the budget
  elided, and `goal-continue-instructions-<ts>.md`, citing the re-arm
  file for the executor form) — best-effort, human-auditable, and a
  telemetry corpus. A REVIEWER arm is recorded out of scope: reviewer
  sessions are structurally exempt from every compaction path
  (detached-HEAD worktrees resolve the watchdog off, spawned
  secondaries carry the kill switch).
- **How the continuation actually arrives (EVA-125's layered
  delivery, superseding the two-step).** Post-compaction resumption is
  three layers, first-to-land wins. PRIMARY: the PostCompact hook's
  spawned hand (`goals auto-continue --trigger post-compaction`) —
  it fires deterministically at completion, and for an EXECUTOR its
  first act is the `/goal [goal-rearm-<ts>.md]` itself (the rearm file
  is generated post-event, so its body may truthfully say the
  compaction ran, and it carries the position record — no pointer line
  precedes it); an ORCHESTRATOR gets the plain resume-pointer text
  through the same path. BELT: the self-compact worker's
  queued-through continuation (EVA-124), already typed before the
  compaction and duplicate-guarded. SUSPENDERS: the plain-text nudge,
  which now fires ONLY when neither landed — the withhold reads the
  armed marker (confirmed arms only; the PostCompact record-closer
  clears it each cycle, and its `observedAt` stamp bounds the
  hook-less watch path against the compaction stamp) and scans the
  pane for a queued-but-unexecuted `/goal` copy. An unproven primary
  arm degrades: the pointer is typed as the fallback and the retry
  episode is enrolled for `goals watch`.
- **The STRATEGY: compact or reset (EVA-89).**
  `execution.compaction.strategy` — mirrored per goal by the flat
  `compaction_strategy` frontmatter key and overridable with
  `goals compact --strategy` — picks WHICH mechanic the outside hand
  uses. `compact` is the default and what absence means. `reset` writes
  the marker-gated mined handoff, types `/clear`, and re-points the
  fresh session at that handoff. Reset ships AVAILABLE-NOT-DEFAULT: no
  default flips until an A/B on real goals compares resume quality, and
  a follow-up goal owns that decision — the per-goal frontmatter key is
  what the A/B alternates.

  The trade, as assessed: compact keeps a SAFETY NET (the summary is
  generated from the whole transcript, so details a first mining pass
  under-captured can survive in it) and SESSION IDENTITY (the `/goal`
  binding, the transcript the watchdog reads its model and usage from,
  per-session leases, herdr's `agent_session`). Reset buys a single
  AUDITED source of truth — the handoff went through mining, a gap
  pass, and self-validation; a summary went through nothing —
  deterministic instant mechanics (nothing queues, no evidence polling,
  no lease), zero summary drift, and zero summarization cost.

  **The sequence**, each step shaped by a live verification rather than
  an assumption (EVA-89's `results/verifications.md`): gate on a fresh
  mined handoff → regenerate the resume file → `/clear` → re-arm `/rc`
  only on a positive absence → `/goal [<resume file>]` as a SECOND
  send. `/clear` silently DISCARDS trailing text, so the pointer can
  never ride along with it; the `/goal` binding dies with the
  conversation, so nothing needs clearing first; the session id rotates
  at `/clear` and herdr re-registers it, which is the verb's structured
  `cleared` evidence; and `/rc` SURVIVES `/clear`, so a blind re-send
  would park the composer on the Remote Control dialog and swallow the
  re-bind.

  **The resume file is where the hierarchy is enforced.** `/goal
[<path>]` re-delivers a whole contract from disk — a reset STRENGTH,
  since the fresh session re-reads the ACTUAL contract instead of
  trusting a summary's memory of it — but the launch-day instruction
  says "execute this goal", which mid-goal races the handoff pointer
  against a start-over contract. So the reset regenerates it in a
  resume flavor: the ORIGINAL contract verbatim (NORMATIVE — the launch
  records what it delivered, and a reset re-issues that rather than
  re-deriving one), the handoff framed as POSITION ONLY ("where you
  are, never what done means"), and the conflict rule stated —
  **the gate wins, and the discrepancy is recorded, never silently
  resolved.** A handoff is a plan snapshot from a context-pressured
  session and nothing makes one gate-complete; EVA-79's receipts
  enforce this from the review side. It also carries the
  predecessor-transcript pointer under a strict contract (consult only
  when the handoff provably misses something, surgical reads only,
  never a full read — the safety net without the drift) and
  acknowledges the INHERITED task list, which survives `/clear` because
  it is keyed to the process, not the conversation.

  **Failure direction splits at the `/clear`.** Before it nothing has
  been typed, so every failure — no readiness marker, no recorded
  launch instruction, an unreadable pane — degrades to `/compact`
  LOUDLY: refusing near the hard threshold would just hand the session
  to an uncontrolled auto-compact. After it no fallback can exist, so
  failures become ALERTS carrying the exact by-hand command. Compact
  never degrades INTO reset — arriving at the path with no safety net
  by accident is the one outcome worth engineering against — and
  `--skip-handoff` is refused under reset rather than silently
  reinterpreted, since it names a safety net `/clear` does not fire.

  **All three consumers read it.** `goals compact` is the one door: it
  resolves the chain and dispatches, so `goals watch` inherits reset
  without knowing the mechanic exists. `goals self-compact --strategy
reset` is the self-arranged arm (and the handoff skill's Step 8
  "clear and re-point" option) — that verb serves a SESSION, not a goal,
  so it resolves no policy of its own and the strategy must be passed
  explicitly. The watchdog therefore EMITS `--strategy reset` in every
  self-arranged command it generates, not just in prose: a flagless
  command runs the compact arm, so announcing a reset and handing over
  the compact command would be exactly the silent gap the
  all-three-consumers constraint forbids — and would make the A/B
  record compact-path results under a reset label. Its stakes sentence
  is EXECUTOR-only for the same reason the arm is: a settings-level
  `strategy: reset` reaches orchestrators too, and promising one a
  `/clear` its preflight refuses would contradict "the orchestrator
  keeps compact" in the same breath as the advice. RECORDED LIMIT: the
  self-arranged arm serves sessions whose root carries a recorded
  launch instruction — goal executors. An orchestrator or hand-started
  session has no contract to re-issue, so a `/clear` there would leave
  the pane with no standing orders at all; those refuse loudly and are
  told the by-hand sequence.

- **The lock-watch companion** — `evie-kit goals watch <KEY>` (spawned
  by `goals execute` itself since EVA-130; `--no-watch` opts out) —
  keeps exactly the jobs hooks cannot do: LIVENESS (reports a
  vanished/crashed executor — the watcher dead-end seam), firing
  `goals compact <KEY>` when `compact-ready.json` appears, exactly
  once per marker appearance (an unresponsive compaction preserves the
  marker for human retry; the executor's next self-nudge writes a
  fresh `written` stamp, which is a new appearance and re-fires), and —
  since EVA-130 — the deterministic API-error retry (transient 5xx/
  overloaded states read from the idle executor's pane text, fibonacci
  backoff capped at 15 minutes, never auth/credit/permission states)
  plus surfacing the typing guard's delivery-audit records. It
  runs until the goal locks (exit 0), the executor dies (exit 1), or
  observation itself fails repeatedly (exit 2 — herdr/fs errors are
  absorbed per tick and only end the watch after 5 consecutive
  failures), emitting one JSON event per line. Spent marker
  identities persist in the goal worktree
  (`.evie-kit/handoffs/compact-fired.json`), so a restarted watcher
  keeps the exactly-once contract. The ORCHESTRATOR arms it right
  after `goals execute` — that arming is what closes the
  intake's "nothing watches for the signal" gap. Since EVA-93 the
  watcher carries a third, non-terminal report: the legal-pause marker
  (`paused.json` — `SKILL.md`'s "Legal pauses"), surfaced as
  `executor-paused` / `pause-marker-invalid` / `executor-resumed`.
  Pause and compaction stay INDEPENDENT: a paused executor's readiness
  marker is still fired on (pausing is about work, not context), and a
  cited pause only changes the compaction's instructions, which gain a
  stay-paused clause so the continuation does not walk the compacted
  session through the gate it stopped at. Since EVA-150 the watcher
  also MECHANIZES the delete-on-answer contract. `goals resume`
  records its delivery (`pause-answered.json`); an executor still
  sitting on that ANSWERED pause past a grace window is nudged to
  honor EVA-93 — twice, on widening delays (`pause-stale-nudge`).
  After both reminders it is escalated once to the human
  (`pause-stale-escalated`), because the standing marker is what
  blocks the `/goal` re-arm. No fallback read: the contract is
  enforced, never routed around.

## Auto-continue after a compaction or a reset (EVA-105)

Everything above gets a session through a compaction with its record
intact. What it never did was put the session back to WORK: the
PreCompact/PostCompact hooks write and stamp the handoff and stop there,
and no SessionStart-side hook existed at all. EVA-99's executor came out
of an auto-compaction holding a complete handoff and sat idle for ~2.5
days until a human ran `goals resume --rearm-only`; the orchestrator
session needed the same rescue by hand twice. Auto-continue closes that
last step.

**Two deliverers, one guard core.** `goals watch` delivers for watched
executors — it is already running, already owns compact firing and pause
reporting — and a hook-spawned detached one-shot
(`evie-kit goals auto-continue`) covers every session no watch is on,
the orchestrator above all. Both call the SAME guard core in
`@evie-kit/goals`, so the two can never form different opinions about
when a nudge is legal. No standing daemon.

**Two triggers.** Post-compaction: the watch observes `compact-done.json`
as an EDGE, so an AUTO-compaction fires it exactly like a verb-driven one
(the EVA-99 case is the auto one), and the PostCompact hook additionally
spawns the one-shot for unwatched sessions. Session-start: a thin
SessionStart hook (`startup` / `resume` / `clear`) orients a session
coming up on top of interrupted work. A Claude Code hook can inject
context but can never START a turn, and herdr is the only thing that can
— so the hook detects, the guards decide, and delivery goes out through
the submitting channel (`evie-kit herdr send`, EVA-56). herdr is
transport and observation, never the logic's home.

**What the nudge carries.** For a goal executor: a resume POINTER at the
record, then the driver reinstall — `/goal [<instruction file>]`, whose
file carries the launch's own recorded instruction verbatim from
`.evie-kit/handoffs/goal-instruction.txt`, never reconstructed. That
second line is the load-bearing half: EVA-99's stall was the missing
`/goal`, not a missing "continue". For the orchestrator (and any session
whose launch recorded no contract) the nudge is pointer-only — there is
no `/goal` contract to reinstall, and inventing a partial one is worse
than none (the EVA-33 lesson).

**Five fail-closed guards**, in order:

1. A CITED legal pause stands the nudge down entirely (EVA-93) — marching
   a session through the gate it correctly stopped at is the CED-20
   failure in a fresh coat. A HOLLOW marker is not a legal pause and does
   not stand it down; it rides the same cite-it-or-delete-it clause the
   compaction paths use.
2. A LOCKED goal is never nudged past its lock (the EVA-33 fence family).
   Checked BEFORE the opt-out: a locked goal is not a config question.
3. A guard whose own INPUT cannot be read stands the nudge down
   (`guard-unreadable`). "We cannot tell whether you opted out" is not
   permission, and neither is "we cannot tell whether this is locked" —
   an unreadable GOAL.md and an unloadable settings layer both stop it.
4. Single-shot delivery, through a shared CLAIM LEDGER
   (`.evie-kit/handoffs/auto-continue/`, one exclusive `wx` claim file
   per continuation identity). Two deliverers may race; exactly one
   types. A settled claim is never retaken, a torn one reads as HELD, and
   a settle by a process that does not hold the claim is a no-op.
   Identities are per SESSION and per opportunity —
   `post-compaction|<session>|<stamp>` and
   `session-start|<session>|<record>` — so a co-tenant's compaction is a
   different opportunity, not a collision on one claim.
5. The settings opt-out and its per-goal override.

**Never double-prompt a pane that is already working.** The deliverer
BASELINES the pane before it does anything: already running a turn means
the session needs no nudge (a human answered it, its own evaluator
re-drove it) and typing would queue a second prompt while crediting that
ambient work to our send. A pane that never becomes command-ready is
WITHHELD from rather than fired into — `goals compact`'s send-anyway
exists to compel a wedged executor for a watching operator, and this is
a detached rescue with nobody watching. After the send, a status read
that FAILS is `unobservable`, never "nothing happened", so a herdr blip
cannot drive the retry. The retry itself runs at most once, only against
a pane that was ready, was typed into, and provably stayed quiet.

**The `/goal` re-arm honors its own readiness wait — and RETRIES
(EVA-112).** The pointer starts a turn — reading the handoff, resuming
the goal — that can outlive the window; typed mid-turn the re-arm lands
as queued prose rather than a slash command, which is a silently missing
driver. So it is withheld. The refusal is correct; being ONE-SHOT was
the defect, and the healthier the executor's handoff discipline the
faster it resumes and the likelier the race, so it hit exactly the
best-behaved lanes. The watch now retries at each idle-without-lock
window until the session arms, the goal locks, or a guard stands it
down, and `nudge-failed.json` is a retry LEDGER (attempts, outcomes,
both oracle readings) rather than a terminal verdict. A busy pane is a
`withheld` attempt and never spends the escalation budget; the watcher
dead-end seam fires once, at the second GENUINE failure — a contract
typed into a ready pane that twice did not bind. `goals resume <KEY>
--rearm-only` remains the by-hand remedy.

**Every `/goal` delivery is VERIFIED, and none of them types the
contract inline (EVA-112).** Claude Code stops dispatching typed input to
its slash-command parser past ~800 characters — measured live; full
evidence in EVA-112's `results/root-cause-goal-parse.md` — so the
4000-character inline contract had been landing as an ordinary prompt
since 2.1.224, and eight goals (EVA-99 → EVA-106) ran with the native
`/goal` evaluator never bound. Every delivery — launch, re-arm, reset —
now writes a stamped instruction file and types `/goal [<path>]`, then
watches the pane for the binding:

- the MARKER oracle is `.evie-kit/handoffs/goal-armed.json`, written
  only once an arm is OBSERVED, and cleared by the PostCompact and
  SessionStart hooks as a hard contract (a compaction can clear the
  binding, and a marker that outlives it is the stale-true failure);
- the PARSE oracle is the pane itself — `Goal set:` / `◎ /goal active`
  PLUS the stamped instruction basename, which a pre-delivery screen
  cannot already carry, so a stale indicator cannot confirm a fresh arm;
- `armed` requires BOTH, and any disagreement is logged and resolved
  AWAY from armed. A false "armed" ends the retry loop and hands back a
  disarmed session behind a healthy-looking pane; a false "not armed"
  costs one duplicate line.

A LAUNCH that does not arm is loud at execute time — `goals execute`
prints a `LAUNCH NOT ARMED` block naming the remedy and exits nonzero,
without rolling back a session that is up and working. The regression's
real cost was never that it happened; it was that nothing looked.

**Records are bound to the session that will read them.** The
post-compaction ladder checks `compact-done.json`'s `session_id` and the
handoff's own frontmatter owner — the marker is one latest-wins file per
checkout, so a co-tenant compaction could otherwise point session A at
session B's handoff. The session-start path cannot make that check (its
record was written by the PREDECESSOR session, by construction), so
FRESHNESS bounds it instead: a record older than a day no longer
supports the claim "this session started fresh on top of an interrupted
one".

**Configuration** — `execution.autoContinue`, the one key in that block
whose ABSENCE means ON (unattended continuation is what the executor lane
exists to buy, and the guards above are the safety). A consumer that
wants compaction to be a human checkpoint sets it to `false`; one goal
opts out through the flat `auto_continue` frontmatter key, following the
`compaction_*` flattening precedent. A frontmatter value that is neither
`true` nor `false` is treated as an opt-out and reported — someone
plainly tried to say something, and "they meant yes" is the one reading
that can move a session nobody asked to move. `EVIE_KIT_AUTO_CONTINUE=off`
is the per-lane kill switch both hooks read.

**Failure is loud and never blocking.** A nudge that does not take warns
where it ran, the watch reports it as `nudge-failed` (the
`executor-paused` family), and the record lands at
`.evie-kit/handoffs/nudge-failed.json` — a retry LEDGER since EVA-112,
which the watch's own retry loop then works through (`rearm-retried`,
`rearm-armed`, `rearm-dead-end`). The POINTER's swallowed-send retry is
a different, narrower thing and still runs at most ONCE: only against a
pane that was command-ready when the first line was typed and then
started no turn — a pane that DID continue is never prompted twice
(never-double-spawn, EVA-73).

**Wiring — one implementation, two wirings.** This repo points the hooks
at their sources (`packages/goals/src/session-start.ts`,
`packages/handoff/src/postcompact-handoff.ts`) so they fire in
never-installed worktrees; `evie-kit setup` wires consumers through the
linked bin (`evie-kit goals session-start`), matcher-scoped to
`startup` / `resume` / `clear`. That entry sits BESIDE the EVA-81
toolchain preflight, which stays matcherless and pure shell: the
preflight exists to diagnose a missing toolchain, and auto-continue runs
through the very toolchain it diagnoses, so neither can substitute for
the other. The post-compaction arm needs no new wiring at all — the
PostCompact hook consumers already have spawns the launcher, falling
back to the `evie-kit` bin outside this checkout.
