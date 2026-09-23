# Goal reviews — the pre-promotion critique loop (EVA-32)

The GOAL kind on the review-round axis (ADR 0004): secondary coding
agents ("critics") read a draft goal and poke holes BEFORE promotion,
then stay in the loop as refinement progresses. Read this in full
before running, nudging, or dismissing a goal-review round.

## Contract (vs. results waves — the kinds are opposites)

| Axis      | `goal` round (this doc)                                   | `results` wave (`review-waves.md`)       |
| --------- | --------------------------------------------------------- | ---------------------------------------- |
| When      | Refinement, strictly pre-execution                        | After execution, the green gate          |
| Object    | The SPEC: `GOAL.md` + references (+ code for feasibility) | The committed diff vs. base              |
| Blindness | NON-blind: critics read prior rounds/briefs               | Blind: never RESULT.md, never each other |
| Session   | PERSISTENT tab, nudged across rounds                      | Fresh session per wave (sweep)           |
| Tree      | The LIVE draft worktree, read-only                        | Ephemeral per-reviewer worktrees         |
| Output    | `CRITIQUE.md` + promote-readiness verdict                 | `FINDINGS.md` + severity table           |
| Marker    | `CRITIQUE COMPLETE`                                       | `REVIEW COMPLETE`                        |

Never let one kind inherit the other's contract (ADR 0004's standing
warning) — the kind prefix on the round folder is what distinguishes
them on disk.

## Invariant core (runtime-independent)

The loop, whatever runtime delivers it:

1. **Offer, never automatic.** The step is OFFERED at refinement seams
   — post-intake output, grill ending, the promotion seam — and only
   when at least one engine is staged for goal reviews. No draft gets a
   critique round it didn't opt into.
2. **Round = brief out, critiques in, both in the round record.** The
   main agent writes its round brief (`BRIEF.md`: what changed, what to
   critique); each staged engine writes a typed critique artifact.
   Everything is file-mediated, and the WHOLE round folder is part of
   the durable record: under `goals.drafts.commit: true` it is
   committed at reconciliation, while under the DEFAULT local policy
   (EVA-62) it stays a plain on-disk record like the rest of the draft
   and enters history ONLY when the promotion capture completes — a
   local-policy draft abandoned (or lost with its worktree) before
   promotion takes its rounds with it, per the abandonment warning.
   (Losing the worktree mid-round costs only that round under commit
   mode — prior rounds are already history. The machinery itself reads
   disk, never git, so both modes behave identically while the
   worktree lives.)
3. **Persistent critics.** A critic session stays open after its pass.
   When grill answers or spec edits land, the next round NUDGES the
   same live session (pointer to the new brief + a short summary). A
   dead/stale tab respawns from the on-disk record alone — GOAL.md plus
   the prior rounds' critiques and briefs (committed under commit mode,
   plain files under the EVA-62 local default) — durability never
   depends on a live tab.
4. **Typed feedback, routed via the user.** Critique blocks are routed
   by the MAIN agent, deduplicated across engines: grill suggestions
   feed the user interview (the runtime's question seam), wayfinder
   signals feed the wayfinder-escalation picker, plan holes get
   recorded dispositions in the round INDEX. Feedback reaches GOAL.md
   through the user's answers — never silently auto-folded. **Routed
   findings get the fuller treatment**: whichever critic produced a
   finding, relaying it as a user question carries the critic's
   reasoning — what breaks, and why it matters — into normal prose
   BEFORE the picker; the picker captures only the decision (grill-me's
   explain-first rule, `grill-me/SKILL.md`). A dense critique
   over-compressed into picker fragments drops exactly the context
   that made the question answerable.
5. **Consensus informs; the user promotes.** The loop continues until
   every participating engine's latest verdict is `ready_to_promote`
   OR the user explicitly promotes. Consensus is surfaced to the user;
   it never auto-promotes — the human promotion gate stands. Consensus
   is AS-OF the latest round's spec: verdicts are not pinned to a
   GOAL.md version, so after further spec edits, run another round
   before presenting consensus — a ready verdict on a superseded spec
   is stale, not standing.
6. **Promotion dismisses the critics.** The persistent tabs close at
   promotion; the round artifacts are the durable record.
   Post-promotion spec edits wanting feedback start a fresh round
   (which respawns critics from the artifacts). Rounds are refused once
   the goal is `started` — from there the results wave is the gate.
7. **Read-only contract.** Critics work in the draft's live worktree
   under a prompt-level do-not-write rule; their one write is the
   critique artifact. The post-round check is "no writes outside the
   round's own artifacts": under commit mode, after the main agent
   commits the round, `git status` in the draft worktree is clean —
   a dirty tree then is a contract breach to investigate, not tidy
   away. Under the EVA-62 local default the whole draft folder is
   legitimately untracked, so a status check proves nothing about
   files INSIDE it — compare the draft folder's pre-round state
   (mtimes or content hashes of GOAL.md and `references/`, captured
   when the round is issued) against post-round, allowing only the
   round's own artifacts to differ, plus the usual nothing-changed
   check outside `goals/drafts/<name>/`.

## Round anatomy

`reviews/goal-NNN/` — `NNN` on the goal's ONE monotonic round sequence
(goal and results rounds interleave on the same index; see
`review-waves.md` / ADR 0004):

```
reviews/goal-NNN/
  BRIEF.md            # main agent's round brief (outbound, committed)
  INDEX.md            # engine outcomes + verdicts + ROUTED FEEDBACK
  codex/              # one dir per engine in the round
    PROMPT.md         # the full critic contract for this round
    CRITIQUE.md       # the critique artifact (see templates.md)
    screen.txt        # final-screen snapshot
```

The critique artifact carries snake_case provenance frontmatter
(`agent`, `model`, `reasoning_effort`, `round`, `timestamp`,
`verdict`, plus OPTIONAL `findings: N` — EVA-45, the critique's own
finding count feeding the flat-series heuristic; absent is tolerated
everywhere) and seven required sections — summary, plan holes/risks,
green-gate checkability (per gate), sizing sanity, open
questions/grill suggestions, wayfinder signal, promote-readiness
verdict — closed by the `CRITIQUE COMPLETE` marker. Exact shapes:
`references/templates.md`.

## Roster and naming

- An engine joins goal rounds ONLY via the explicit `stages` opt-in on
  its `tools.review.<tool>` block (`stages: [goal, results]`; omitted =
  results-only, EVA-30). Interactive engines only (claude-code, codex)
  — a headless tool staged `goal` fails the round loudly (unless
  `enabled: false` — off is off, not an error).
- **claude-code critic caveat** (results-002 codex finding): a CC
  critic session inherits the project/user Claude settings — including
  hooks that may WRITE (formatters, PreCompact artifacts) — so the
  prompt-level read-only contract can be breached without any model
  action. codex is the hardened dogfooded critic engine; stage
  claude-code for goal rounds only once its settings isolation is
  built (follow-up), and check `git status` after its rounds
  especially.
- Critic tabs are named `<goal-folder-name>-<code>-goal` (EVA-48:
  `EVA-32-my-slug-cd-goal`; drafts always worked this way —
  `20260720-112017-my-slug-cd-goal` — since the stamp alone is not
  unique across same-second drafts). The `-goal` suffix keeps critics
  disjoint from `-review` results reviewers: a wave's sweep can never
  close a live critic, and vice versa. After promotion renames the
  goal, `dismiss` still finds draft-era tabs (labels reconstructed
  from the `created` frontmatter) — and, transition tolerance
  (EVA-48), both nudge/respawn and `dismiss` also match the
  pre-EVA-48 bare-key labels (`EVA-32-cd-goal`,
  `legacyGoalCriticLabel`) so a critic spawned under the old naming is
  nudged and dismissed, never stranded or duplicated.
- Critic tabs live in a `<goal-folder-name>-goal-review` workspace (or
  the calling pane's own workspace / `--workspace`); a workspace
  surviving from the pre-EVA-48 `<key>-goal-review` labeling is
  re-found rather than duplicated.

## Round budget (EVA-45)

The loop does NOT converge — that is measured, not conjectured: across
four goals in two repos, spec-loop finding counts went FLAT (~±20% per
round; EVA-39 sat at 12,10,10,9,9,11,10,10 across eight rounds) and
every loop ended by user override, never consensus. A flat series is a
SIZE signal: splitting is what converges the loop (EVA-42 exists
because five flat rounds on its parent; the post-split round came back
"promotable without another split"). The cap is therefore a
CONFIGURABLE ROUND-BUDGET POLICY encoded in the tooling, covering both
round kinds with OPPOSITE defaults (results waves keep earning for 3–4
rounds, EVA-40):

```ts
// settings default shape — GOAL.md frontmatter and CLI flags mirror it
review: {
  rounds: {
    goal:    { soft: 2, hard: 4 },
    results: { soft: 4, hard: 8 },
  },
  engines: {
    goal:    ["codex"],
    results: ["claude-code", "codex", "sonarqube", "coderabbit"],
  },
}
```

- **Soft cap**: a round past `soft` prints the advisory (the cap, the
  flat-series-is-a-SIZE-signal rule, the override playbook below) and
  PROCEEDS. **Hard cap**: a round past `hard` REFUSES, naming its two
  escapes — raise `review.rounds.<kind>.hard` in GOAL.md frontmatter
  (a committed, visible act in the goal record) or pass `--hard-cap N`
  for one invocation.
- **Three-layer precedence, most specific wins, per LEAF**: settings
  default → GOAL.md frontmatter (`review:` subtree mirroring the
  settings shape exactly; unknown keys inside it error loudly) → CLI
  flags on both round verbs (`--soft-cap`, `--hard-cap`, `--engines`).
- **The budget counts FINDING rounds** (EVA-90): a round declares its
  purpose (`--purpose finding` — the default — or `--purpose
verification [--verifying "<what>"]`), and a verification round
  checking a fix batch is EXEMPT from the cap. That is what lets both
  measured shapes be true at once: finding counts plateau, while
  results waves keep earning through rounds 3–4 because a fix batch
  introduces its own defects (EVA-40; EVA-80's round 2 found three
  defects created by round 1's fixes). The purpose lands in the round's
  `ROUND.json` and in its INDEX prose; a round that declares nothing
  counts as a finding round, so every pre-EVA-90 round keeps its old
  meaning. Whenever verification rounds exist, the cap message names
  how many it excluded — the exemption is never silent. The exemption
  is BOUNDED: verification rounds carry the same `hard` ceiling among
  themselves, because a round that grants itself an exemption by
  declaring a label would otherwise remove the refusal entirely, and
  `--purpose verification` REQUIRES `--verifying "<what>"` so the claim
  is auditable. Full rules: `right-sizing.md`.
- **Engines narrow, never add** (the EVA-45 executor-resolved
  reconciliation with EVA-30's `stages`): the per-kind list selects
  among DEFINED tools staged for that kind. `stages` is the tool's own
  capability/participation declaration — selection cannot grant
  capability, so an explicit list naming an undefined or unstaged tool
  errors loudly instead of resurrecting it; the built-in default lists
  are a filter, not a claim, and are exempt from those errors. When
  frontmatter/CLI narrowing leaves fewer engines than the configured
  baseline, the round INDEX renders a **ROSTER NARROWED** banner naming
  the excluded engines and the excluding layer, and every excluded
  engine gets its own layer-accurate `excluded` INDEX row — never a
  silently shrunken round. Migration note: because the built-in
  `engines.goal` list is codex-only, a repo that staged ONLY
  `claude-code` for goal rounds (legal since EVA-30) now gets a loud
  refusal naming `review.engines.goal` — set
  `review.engines.goal: ["claude-code"]` explicitly to keep that
  roster.
- **Override playbook** (what to do INSTEAD of a round 3+): fix
  outright contradictions pre-promotion; convert the remaining open
  questions into a binding "Executor must resolve" checklist in
  GOAL.md, which the results wave then reviews; promote. More goal
  rounds buy findings, not consensus.
- **Flat-series enrichment**: critics MAY self-report `findings: N` in
  critique frontmatter (optional, backward compatible). When ≥2
  consecutive counted rounds sit within ±20%, `goals goal-review
status` and the soft-cap advisory name the flat series explicitly.

## Delivery: Claude Code (built this pass)

The main agent (the CC session the user drives during refinement) runs
the loop from inside the draft's worktree — or from the primary
checkout with `--worktree .worktrees/drafts/<ts>-<slug>`, the form that
always works:

```bash
# One round: write the brief body first (what changed / what to critique)
evie-kit goals goal-review round --brief-file /tmp/brief.md \
  --summary "two grill answers landed; scope cut to CC delivery"
# Current picture: latest verdict per engine + consensus
evie-kit goals goal-review status
# At promotion (companion step, right after `goals promote`):
evie-kit goals goal-review dismiss
```

Seam delivery (all `AskUserQuestion` pickers, per the lifecycle-seams
principle):

- **Offer** (post-intake output / grill ending / promotion seam):
  include a "Run a goal review (critique agents)" option when goal-stage
  engines are configured and no round has consumed the latest spec.
- **Routing**: deduplicated grill suggestions enter the normal
  `grill-me` interview flow (one question at a time — attribute the
  question's origin, e.g. "codex critique, round 2", and carry the
  critic's reasoning in prose before the picker, per invariant core
  rule 4); a wayfinder
  signal ≥ `consider-wayfinder` surfaces the wayfinder-escalation
  picker (_Chart a wayfinder map / Keep it one goal anyway / Split it
  manually_).
- **Consensus**: when `status` reports consensus, tell the user and ask
  — _Promote now / Another goal-review round / Keep refining_ —
  promotion fires only on their word.

After each round: reconcile the INDEX's "Routed feedback" section
(dedup, route, record dispositions), then — under commit mode — commit
the round folder before continuing refinement; under the EVA-62 local
default there is nothing to commit (the round enters history with the
promotion capture). Either way the on-disk round record is what a
respawned critic rebuilds from.

## Delivery: OpenClaw (structure-ready; follow-up goal)

The same invariant core with Discord-component seams (reply-first,
buttons, 3s ACK — the grill-me delivery pattern): the offer and
consensus seams render as button rows, grill suggestions enter the
oc grill flow, and the loop's CLI verbs run repo-side. NOT built in
this pass — only the seams are named so the oc delivery can land
without reshaping the protocol.

## Operational notes

- Rounds are serial per goal (concurrent rounds fail loudly on the
  round dir, same as waves). Default backstop 30 min per critic, poll
  10s, stall threshold 10 min (`review.stallTimeoutMinutes` /
  per-tool `stallTimeoutMinutes` override).
- Delivery is verified (state change / on-screen echo / critique
  output), with ONE resend before a loud setup failure — never blind
  re-typing.
- A critic that stops to ask a question is a FAILED critic
  (never-block); `done` without the marker fails loudly; a
  marker-complete critique without a recognizable `verdict:` is a
  failed artifact.
- The loop never runs on a locked goal, and `status`/rounds read only
  the on-disk round artifacts — "what do the critics think" never
  depends on a live session.
