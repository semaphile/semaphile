---
name: grill-me
description: >-
  Relentless one-question-at-a-time interview (via AskUserQuestion) to
  sharpen a plan or design before building it. Use whenever the user says
  "grill me", asks to stress-test, pressure-test, or poke holes in a plan,
  wants assumptions challenged or a design interrogated before
  implementation, or is refining a goal draft pre-promotion — even if they
  never name the skill. Folds in domain-modeling, surfacing glossary/ADR
  opportunities as they come up without turning every session into a
  documentation exercise.
argument-hint: "[topic or plan to grill]"
---

# Grill Me

Interview relentlessly about every aspect of a plan or design until we reach
shared understanding. Walk down each branch of the design tree, resolving
dependencies between decisions one-by-one. For each question, give a
recommended answer.

Provenance: `references/attribution.md`.

## Ask one question at a time, via AskUserQuestion

**Use the `AskUserQuestion` tool for every question.** Do not
print a numbered list of questions in plain text and wait for a
multi-part reply; that defeats the one-at-a-time discipline this skill
depends on.

Structure each `AskUserQuestion` call:

- **Question:** one clear sentence.
- **Options:** your recommended answer first, then sensible
  alternatives up to the runtime's option cap. Never force a choice
  among only pre-baked options if the real answer might not be one of
  them — where `AskUserQuestion` runs, its built-in "Other" already
  covers "something else", so author an explicit "something else"
  option only on a runtime with no free-text channel. When a slot
  remains free after the substantive options, the LAST slot goes to
  the standing "Go Deeper" option (per-runtime slot budgets, the
  precedence order, and the fallback rule live in its own section
  below).
- **Rationale:** 1–2 sentences on _why_ the recommended option is
  recommended, shown alongside the question so the user isn't picking blind.

Never ask multiple questions in one `AskUserQuestion` call. Never ask the
next question before the current one is answered. (One sanctioned
exception to picker-always delivery: the prose-only diagnosis turn
after a SECOND consecutive confusion signal — the clarification rule's
step 3, below.)

## Explain before you ask — the pre-picker briefing

BEFORE every `AskUserQuestion` call, the turn carries a thorough prose
briefing, written as normal message text ahead of the tool call — the
picker never opens cold. The briefing has three parts, in order:

1. **What was DONE** — what the agent did since the user's last
   touchpoint: work performed, decisions already made autonomously, and
   anything the user is about to be asked to build on. The user was not
   watching; this part closes that gap. It SCALES WITH THE GAP: for an
   ordinary back-to-back grill question where nothing happened in
   between, it is one sentence or omitted — never filler. It is never
   omitted after autonomous work, at a lifecycle seam, or after any
   pause longer than a turn.
2. **What is being DECIDED** — the question now on the table, and why
   it needs the user rather than the agent.
3. **What IMPACT each direction has** — a concrete scenario walked
   through each option ("if you pick A, then when X happens, …") so the
   user watches each choice play out before choosing. Abstract
   trade-off phrases alone ("more flexible", "simpler to maintain")
   fail this rule even when every term is defined.

A term or mechanism not yet established in this conversation gets its
introduction inside that briefing — with a concrete example (e.g. a
sample JSON doc) when it helps — and THEN a slim picker captures only
the decision. Option descriptions never carry first-time concept
introduction: by the time the picker renders, every term it uses has
already been defined above it.

- **Calibrate to a reader who was out of the loop.** Session-local
  codenames, derived values, and agent-invented shorthand ("the
  walkthrough", "P1/P2/P3", "the carve-in") mean nothing to someone who
  wasn't watching them get coined. Re-ground them on EVERY use in a new
  question — each picker is written for a reader returning after hours
  away, never one presumed to have followed each intermediate decision.
  Unpack ALL terminology the user may not know, assuming less
  familiarity rather than more.
- **Compression is the failure mode, not a tool limit.** The hard caps
  in `AskUserQuestion` are the 12-character header chip and the short
  option LABEL (1–5 words — detail rides the option's description
  field); question text and option descriptions are unbounded. Never
  shrink an explanation to fit an imagined limit.
- **Shape/code/layout comparisons ride `preview`** where the runtime
  supports it (Claude Code's `AskUserQuestion` does, for single-select
  questions only) — never code crammed into option descriptions. On a runtime without a preview
  surface, the comparison goes in the preceding prose or that runtime's
  equivalent rich surface: the invariant is the side-by-side
  comparison, not the widget.
- **Depth-on-request is the failure, not the fix.** If the user has to
  ask "explain the options in more depth", the question was
  under-explained — that round-trip is the failure signal this rule
  exists to prevent, never the intended path to depth. The standing
  "Go Deeper" slot (below) is the sanctioned escape when it happens
  anyway — its selection is still a signal the briefing under-delivered.

(Questions routed from a critique round get the fuller treatment — the
critic's reasoning travels into the prose, per the goals skill's
`references/goal-reviews.md`.)

## Clarification replies are a stop signal

The explain-first rule governs question AUTHORING; this rule governs
ANSWER HANDLING. A reply to any picker — including free-text through
the built-in "Other" — that is question-shaped or confusion-shaped is
NOT an answer. Any one of these signals is enough:

- a question mark, or a "what X?" construction;
- "I don't understand" / "I'm not following";
- "I didn't see…" — the user says something they were expected to have
  seen never reached them;
- any reference to a thing the user cannot see (a "walkthrough" that
  was never actually rendered to them, a doc only the agent read, a
  decision made off-screen).

**A reply can carry both.** When the reply contains a discernible
decision alongside the question ("B, but what's a carve-in?", or an
option selected in the widget with a question attached in free-text
notes), do NOT discard the decision — but do not lock it either: the
user may have chosen the very thing they don't yet understand. Hold
the choice as TENTATIVE, answer the question in plain prose, then
re-present the SAME question reshaped by the explanation, with the
tentative choice acknowledged as the leading option ("you leaned B —
still B?"). The tree advances only on a clarification-free
confirmation — one click when the explanation changed nothing, a
different answer when it changed everything. A both-carry reply is
still a confusion signal and counts toward step 3's
consecutive-signal escalation. The full stop-and-re-ask below is for
a reply with no discernible decision in it.

On a clarification signal, STOP — the decision tree does not advance:

1. **Answer first, in plain prose**, calibrated to someone who was out
   of the loop while the work happened: do not assume they followed
   intermediate decisions or session-local shorthand; re-establish
   context from their last touchpoint, not from the agent's.
2. **Re-present the picker only AFTER the explanation** — and NEVER
   re-send an unchanged picker after a confusion signal. The re-ask
   must incorporate what was just explained: a reworded question,
   re-grounded option descriptions, a fresh briefing. An unchanged
   picker tells the user their confusion was processed as an answer.
3. **A SECOND consecutive confusion signal means the explanation
   missed, not just the phrasing.** Stop guessing at what was unclear:
   drop the picker for a turn and ask, in prose, what specifically
   didn't land — or restate from zero shared context, ELI5-first (the
   Go Deeper turn's second layer, promoted to the front). This is the
   ONE sanctioned exception to "every question via `AskUserQuestion`":
   diagnosing confusion is not a decision, and flattening it into
   pre-baked options would guess at the very thing that's unknown.
   Re-present a picker only once the user signals the explanation
   landed.

Selecting the standing "Go Deeper" option (next section) triggers this
same stop behavior, deliberately.

## The standing "Go Deeper" option

The invariant, on every runtime: every question carries a depth-escape,
and taking it triggers the clarification-stop behavior above. Its
strong form is a selectable option — the user goes deeper WITHOUT
composing their own request. Where no slot fits, the fallback form is
legal only with its condition attached: the pre-picker briefing states
that asking for more depth is always honored, and the picker's
free-text channel carries it. An unannounced escape fails the
invariant — the escape must exist on every question, slot or no slot.

Per-runtime delivery:

- **Claude Code** (`AskUserQuestion`): with ≤3 substantive options,
  reserve the fourth slot for a **"Go Deeper"** option (label
  `Go Deeper`; the option's DESCRIPTION carries "explain this more
  before I decide" — labels stay within the tool's 1–5-word contract).
  When a question genuinely needs 4 substantive options, use the
  announced fallback (the built-in "Other" remains the free-text
  channel).
- **Codex** (`request_user_input`, the equivalent picker there —
  EVA-212): the picker exists in Default mode only with the
  `default_mode_request_user_input` feature enabled (the orchestrator's
  configuration; Plan mode renders it too but refuses mutation). Each
  question carries 2–3 options — labels of 1–5 words, one-sentence
  descriptions, a header of 12 characters or fewer — and no preview. A
  question that genuinely needs four substantive options splits into a
  primary question plus a secondary "More options" question in the same
  call. The goals skill's `references/codex-seams.md` shows every seam's
  split. Reserve the final slot of the last question for Go Deeper
  whenever one is free. Otherwise the announced fallback — the
  client-appended "None of the above" is the free-text channel it rides
  on, and its `user_note` is read as free text, never as a selection. A
  question in the note is a clarification signal exactly as above.
  Default mode auto-submits EMPTY answers after a 60-second countdown:
  an empty answer is silence, not consent — re-present, never advance.
- **Button/reply runtimes** (e.g. Discord-backed): a standing
  "Go Deeper" button when there's room; otherwise the announced
  fallback as a briefing sentence (a plain reply is that runtime's
  free-text channel).

**Precedence when standing options collide.** Substantive answers are
never dropped to make room. "Research this first" (the grounding
ladder's rung 3) is a STANDING option too — it never counts toward the
substantive tally that frees the last slot — and, being answer-shaped,
it outranks Go Deeper when both contend for one free slot; the
displaced Go Deeper falls back to the announced form, and the
announcement then becomes MANDATORY, not optional.

**Lifecycle-seam pickers follow the same rule, additively.** A seam's
canonical option set (the `goals` skill's seam list, this skill's own
ending picker below, and any picker another skill declares a lifecycle
seam — e.g. handoff's ending picker, research's approval gate) keeps
its substantive membership exactly as documented: Go Deeper never
displaces a canonical option and never enters a seam's drop-order
rules. It APPENDS — when the rendered set leaves a slot free, the last
slot carries Go Deeper; when the rendered set is full (e.g. research's
four-option approval gate), the announced fallback applies.

A Go Deeper turn is explicitly LONG-FORM — multi-paragraph briefings
are encouraged, not merely tolerated. It delivers, in order:

1. **The deeper briefing** — the did/deciding/impact structure again,
   expanded: more context on what happened while the user was away,
   fuller scenario walk-throughs per option, the trade-offs behind the
   recommendation.
2. **An ELI5 layer, after the normal deeper briefing** — the same
   decision restated from zero shared context, plain analogies allowed
   — in case the fuller explanation still didn't land. This layer is
   part of every Go Deeper turn, not an on-request extra.
3. **The re-presented picker**, reshaped per the clarification rule —
   never the previous picker unchanged. If this is the SECOND
   consecutive depth signal, the clarification rule's escalation wins:
   skip the re-presented picker and take the prose-only diagnosis turn
   instead.

## Worked example — a clarification mishandled, then handled

Modeled on a real consumer-project session (a jargon-dense ratification
grill); skills teach best by contrast.

**Bad turn.** The picker asks the user to ratify "the win-rate
parameterization from the walkthrough" with options like "Keep central
values / Adopt the carve-in / Rework P2". The user replies via
free-text: _"what walkthrough? i didn't see an actual response from you
explaining anything"_. The agent processes that as an answer, keeps
walking the decision tree, and re-presents essentially the same picker
— same jargon, same missing context. The user repeats the same
free-text reply, verbatim. Two turns burned; the user still cannot see
the thing they're being asked to ratify.

**Corrected turn.** The same reply trips three of the four signals at
once — a "what X?" construction, the literal "I didn't see…", and a
reference to something the user cannot see (no walkthrough was ever
rendered to them). The agent stops advancing and answers in plain
prose first: what it did while the user was away ("since your last
reply I compared three ways of weighting win rates and drafted a
recommendation — that draft never reached you; here it is in brief"),
what each named term means ("a carve-in is …"), what is actually being
decided, and what each direction would cause ("keep the central values
and the model reuses one shared weighting for every cohort — simplest,
but the two outlier cohorts stay mis-weighted; adopt the carve-in and
those two cohorts get their own weights — more accurate for them, one
more parameter set to maintain; rework P2 and we re-open the
phase-two delivery itself — the largest change, only worth it if the
weighting question invalidates it"). Only then does it re-present the
picker — reworded to stand on the explanation just given, with
re-grounded option descriptions and a "Go Deeper" option in the spare
slot (its description: "explain this more before I decide"). The user
answers on the next turn.

## Look before you ask — the grounding ladder

Don't burn a question on something already on record. Before forming each
question, run ONE quick pass down the grounding ladder — read-only, cheap
recall that may run silently; it is not research (which produces artifacts,
costs real money, and stays consent-gated). The goal: arrive at each
question already holding grounded context, so the recommended answer
reflects reality rather than assumption.

The rungs, cheapest first:

1. **Repo evidence** — grep, read a file, `git log`/`blame`, a package's
   `CONTEXT.md`. If a _fact_ lives in the repo, look it up.
2. **Configured grounding sources** — the project's `tools.memory.*`
   settings block. Each entry carries a required `description`: read those
   to pick which rungs fit _this_ question (a billing question doesn't
   need the ADR tree; a "didn't we decide this?" question wants episodic
   memory). Per kind:
   - `files` entries: a small tree (~20 files or fewer) is read whole;
     larger trees fall back to search — grep for the question's terms and
     read the hits, honoring an `INDEX.md` as the guide when present.
   - `hindsight` views: recall mechanically via
     `evie-kit hindsight recall --query "…" [--tags …]` — never
     improvise API calls, never the MCP server. Federated fan-out over
     every enabled view is the intended pattern (one question, every
     configured bank, results keyed by view). `--source <view>`
     (repeatable) narrows to the views whose `description` fits the
     question; `evie-kit hindsight source list` prints them with
     their descriptions. A view's `tagGroups` is a relevance scope the
     helper applies; `--tags` only ever narrows. `reflect` (the
     reasoning verb, weight 2 under the limiter) is for a synthesized
     answer, `recall` for the raw facts.
   - `basicMemory` entries: recognized in settings but the search client
     is a follow-up goal — skip this rung for now.

   An unconfigured project simply has no rungs here — skip silently.

3. **Ask** — the _decisions_ are the user's; put each one to them. On a
   researchable domain question (the answer lives in the public web, not
   the repo or the user's head), include **"Research this first"** as an
   explicit `AskUserQuestion` option alongside the direct answers — the
   research skill's draft-first contract takes it from there.

**Announcement etiquette by cost** (ported from the field-tested OpenClaw
tiers): ~instant lookups run silently — just cite the source in the
question text (e.g. _"(from docs/adr/0007)"_); a 5–30 second read runs
proactively with a single inline note before the question (e.g. _"(Pulled
from hindsight: the 2026-06 review-wave decisions)"_); anything over the
**30-second bright line** — research runs, ADHD passes, unbounded work —
is never started without asking (that consent gate is exactly the
`research.autoExecute` escalation: offer Run it / Skip it, and if the
user declines, continue with partial context and acknowledge the gap in
the recommended answer).

**Time-box: one quick pass per question, then ask.** Grounding must not
break the one-question-at-a-time rhythm — when the pass comes up dry,
ask the question rather than descending the ladder again.

## Fold in domain-modeling as you go — don't force it

While grilling, watch for two domain-modeling triggers (see the
`domain-modeling` skill for the full discipline):

- **Terminology conflict or fuzziness.** If the user's answer uses a term
  that conflicts with an existing package `CONTEXT.md`, or is vague/overloaded
  ("the agent", "the goal", "done"), pause and sharpen it — either inline in
  the next question, or as a quick aside — then update the relevant
  `CONTEXT.md` on the spot once it's resolved.
- **A real, hard-to-reverse decision surfaces.** If a question's answer is
  hard to reverse, would surprise a future reader without context, and
  reflects a genuine trade-off (all three — see `domain-modeling`'s ADR
  criteria), offer to record it as an ADR right then, not batched to the end.

**Don't force this on every session.** A grill session about, say, "what
should this function be named" doesn't need a CONTEXT.md update or an ADR —
most questions resolve into the plan itself, not the domain model. Only reach
for domain-modeling when a trigger actually fires.

## ADHD trigger

When a question is genuinely open-ended — multiple viable, defensible answers
with no obvious right one — and the stakes justify a wider exploration,
**offer** (via `AskUserQuestion`, not automatically) to pause and run the
`adhd` skill on that specific node before continuing. If the user accepts:
run ADHD, present its converged output, then resume grilling from that point
with the chosen direction locked in as the answer to the paused question.
Don't offer this reflexively — reserve it for genuine forks, typically 0–2
per session.

## Do not enact the plan until shared understanding is reached

This skill's output is a **decision**, not an implementation. Do not start
building, editing files, or running commands to enact the plan until the
user confirms the tree is resolved — the grill produces the "what and why",
execution is a separate, later step (e.g. the goals-workflow's execution
phase, or a direct follow-up ask).

## Ending a session

When the decision tree is sufficiently resolved — no major open branches, or
all remaining branches explicitly deferred — produce the ending summary,
four parts:

1. **Decisions made** — crisp list, one line each, with the key rationale.
2. **Open items** — anything deferred or flagged as unknown.
3. **Domain artifacts touched** — any `CONTEXT.md` entries or ADRs written
   during the session, by path.
4. **Suggested next step** — e.g. promote to a goal, continue grilling a
   sub-topic, or hand off to the `goals` skill's **Wayfinder mode** if the
   resolved plan turned out to be bigger than one execution session can
   hold.

Then persist it per the transcript contract below — the summary is not
done until it's written where the repo expects it.

### The ending is a picker, not prose

After the ending summary, the session REQUIRES an `AskUserQuestion`
next-step picker — never a freetext-forcing "say the word when you want
to promote". The next action is a closed set of legal transitions, so
enumerate them, recommended option first:

- **Promote now** — the draft is promotion-ready (recommended when no
  open items block it).
- **Keep grilling** — name the specific sub-topic the next question
  would open.
- **Run an ADHD pass** — on a surviving fork worth diverging on (only
  offer when one actually survived).
- **Run a goal review** — dispatch the staged critique agents on the
  sharpened draft (only offer when an engine is staged for goal
  reviews — the goals skill's `references/goal-reviews.md`; recommended
  before promoting a non-trivial draft no round has critiqued).
- **Park the draft** — leave it in `goals/drafts/` for later.

Options cap at four — when more than four apply, offer the four most
relevant to this draft's state (the conditional ones already gate
themselves). The ending picker is a lifecycle seam and follows the
Go Deeper section's seam rule: its canonical options are never
displaced, and when the rendered set leaves a slot free, Go Deeper
rides in the last slot; a full rendered set uses the announced
fallback.

(This is the lifecycle-seam picker contract — the `goals` skill applies
the same rule at every transition. Discord-backed runtimes render the
same ending as buttons, reply-first; the picker set is the invariant.)

### Transcript

The session's durable record is a transcript file; the rest of the repo
already treats this shape as grill-me's output contract
(`@evie-kit/goals`' folder scaffolding provisions `grilling/`, the
`adhd`
skill names the same pattern, and every promoted goal on main contains
one), so a session that skips it strands its decisions in conversation
history.

- **Inside a goal context** — a draft under `goals/drafts/`, a promoted
  goal folder, or a wayfinder breadth-first pass (same interview
  mechanic, same destination): write the transcript to
  `<goal-folder>/grilling/session-NNN-YYYYMMDD-HHmmSS.md`. `NNN` is the
  next sequential session number in that folder (zero-padded; `ls` the
  folder — first session is `001`); the datestamp is the session's
  start, local wall-clock, the repo-wide `YYYYMMDD-HHmmSS` convention.
- **Outside any goal context**: present the same summary inline in the
  conversation instead — don't scatter transcript files outside goal
  folders. If the plan later becomes a goal draft, land the summary in
  the new folder as `grilling/session-001-….md`.

Transcript template — the per-question log plus the four ending-summary
parts. Two sessions must produce the same shape (the transcript is read
later by executors, reviewers, and wayfinder reformulation passes, not
just by whoever was in the room); it matches the real transcripts every
promoted goal on main carries under `grilling/`:

```markdown
# Grilling session {NNN} — {context, e.g. "pre-promotion"} ({YYYY-MM-DD})

{2–4 lines: who interviewed (which session/surface) and who answered;
the trigger; scope — e.g. which open questions were user decisions vs
deferred to executor investigation.}

## Q{N} — {the question, one line}

Options: {recommended option, flagged "(recommended)"} / {alternatives}.

**Answer: {chosen option}.** {The rationale that carried it, including
why alternatives were rejected when that will matter later. A question
resolved by an `adhd` run says so and links the adhd session folder.}

{…one `## Q{N}` section per question asked, in order.}

## Outcome

**Decisions made:** {one line each, with where they were folded —
usually GOAL.md}
**Open items:** {deferred or unknown branches; "none" if clear}
**Domain artifacts touched:** {CONTEXT.md entries / ADRs, by path;
"none" if none}
**Suggested next step:** {promote / keep grilling {topic} / wayfinder}
```
