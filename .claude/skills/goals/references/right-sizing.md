# Right-sizing a goal's lifecycle (EVA-90)

Every goal used to get the same lifecycle shape whatever its size: a
separate executor session, the full blind multi-tool wave, and whatever
model the launch happened to default to. Right-sizing makes that shape a
**recommendation the agent proposes and the user confirms**, recorded on
the goal so reviewers and lock verification can see what was agreed.

Read this before running `evie-kit goals plan`, before changing the
capability table, and before deciding whether a goal earns a wave.

## The verb

```bash
evie-kit goals plan <ABC-NNN | ABC-NNN-slug> \
  [--json] [--accept] [--docs-only | --code] \
  [--size XS|S|M|L|XL|XXL] [--model <executor model>]
```

It reads the goal's own spec, prints the recommendation **together with
the signals and excerpts it rests on**, and records nothing. `--accept`
writes exactly the printed keys into GOAL.md frontmatter with a
`plan_accepted` stamp.

The verb runs on a PROMOTED goal, between promotion and launch. It finds
the goal in `goals/<name>/` when run from the goal's own worktree (or
after the goal merged), else at the mirror path
`.worktrees/<name>/goals/<name>/`.

## The four decisions it encodes

The grill (`goals/EVA-90-lifecycle-right-sizing/grilling/`) settled four
things; everything below is one of them.

### 1. A capability floor gates diversity

**A reviewer must be at least as capable as the executor it reviews;
among the models that clear that floor, prefer a different family.
Diversity is a TIEBREAKER, never a reason to drop below the floor.**

This inverts the intuitive framing (cross-model review is good, so cross
first). The evidence — `docs/research/models/model-review-depth-selection.md`
— is that the crossing is second-order and the capability ordering is
first-order. In the one controlled experiment, Opus reviewing Codex
drafts lifted pass rate 71.6% → 89.7% while the REVERSE pairing DROPPED
it 91.4% → 82.8% with more regressions. The same crossing, opposite
capability ordering, opposite result. A weaker reviewer does not merely
fail to help; it rewrites working code into failing code.

The ordering the picker applies, over the candidates that clear the
floor: different family → not the executor's own model (self-review
measured as a no-op, and self-preference rises with self-recognition) →
the CHEAPEST clearing tier → the caller's own order.

Every shortfall is a RECORDED degrade, never a silent one:
`same-family`, `self-review`, `below-floor`, `unknown-executor`,
`unknown-reviewer`. They print in the plan summary under "What this
gives up", and the launch confirmation shows them.

The tiers live in `packages/goals/src/modelTiers.ts` and are
settings-visible precisely because a static table over model strings is
an approximation of the per-task comparison the rule really wants:

```ts
review: {
  capability: {
    models: { "claude-haiku-4-5": { tier: 5, family: "anthropic" } },
    fallback: { tier: 0, family: "unknown" },
  },
}
```

A project that measures its own pairings corrects the ordering there
instead of forking the code. An unlisted model resolves to the UNKNOWN
floor (tier 0) — deliberately never a guess, since guessing is how a
weaker reviewer clears a floor it has not earned.

### 2. One shape, two layers — plus HITL

The plan is recorded in **the same keys the settings use** (the user's
own requirement: "the shape of the frontmatter should match the shape of
the configuration of defaults in settings.ts"). Nothing translates
between them, and the round verbs already resolve that chain.

```yaml
plan_accepted: 2026-08-05T07:12:44-05:00
review:
  wave: false
  rounds:
    goal:
      soft: 1
      hard: 2
    results:
      soft: 1
      hard: 3
  engines:
    goal: [codex]
    results: [codex, sonarqube]
  models:
    codex: gpt-5-6-terra
execution:
  model: claude-sonnet-5
```

The reviewer here is `gpt-5-6-terra`, not the frontier `gpt-5-6-sol`,
and that is the floor rule working: a `claude-sonnet-5` executor sits at
tier 4, `terra` is the CHEAPEST OpenAI row that clears tier 4, and once
the floor is cleared a stronger reviewer buys nothing the floor did not
already guarantee.

Precedence, per leaf: **settings < worktree-derived settings < GOAL.md
frontmatter < CLI flag**. `execution:` is the second nested frontmatter
block (`review:` was the first, EVA-45); compaction thresholds keep
their flat `compaction_soft` / `compaction_hard` spelling, because
moving them would break every locked goal that carries them.

`plan_accepted` is the HITL receipt. Keys without it were hand-written —
legal, but not a confirmed recommendation.

An empty engines list is never RECORDED: in frontmatter `engines.<kind>:
[]` means "narrow this kind to zero", which refuses every round of that
kind. "Nothing was staged" is written by omitting the key.

### 3. Waveless is legal for the low tier — and is the docs default

The recommender may propose skipping the blind wave for a genuinely
low-tier goal (small, no risk surface), and docs/skill-text goals
default to waveless. **The skip is always surfaced at the confirmation:
accepting the plan IS accepting the skip.**

What never changes: a waveless goal still commits its `results/GATES.md`
receipts (EVA-79). The wave is what is skipped, never the evidence.

Two overrides the recommender applies on top:

- A named risk surface is never waveless, however small the goal.
- A project whose settings stage no results-round engine plans waveless
  **by configuration** — recommending a gate that cannot run is worse
  than recommending none — and says so in the rationale.
- A project that pins `review.wave: false` in its settings gates
  without the wave by POLICY; the recommendation never proposes one
  over that pin.

A recorded waveless plan does not REFUSE a later wave; running one is
always legal. `goals review` announces the mismatch so the record says
why the plan was exceeded.

### 4. Kind-aware caps, and split before you add rounds

Rounds declare a **purpose**: `finding` (the default) or `verification`.
The round budget governs FINDING rounds; a verification round checking a
fix batch is exempt.

That is what lets both recorded conventions be true at once: finding
counts plateau at about two rounds (a flat series is a size signal), while
results waves keep earning through rounds 3–4 because a big fix batch
introduces its own defects (EVA-40; EVA-80's round 2 found three defects
that round 1's fixes created).

```bash
evie-kit goals review --purpose verification --verifying "the round-2 fix batch"
```

`--verifying` is REQUIRED for a verification round: the exemption is a
claim, and an unqualified one is what a later reader cannot audit. The
exemption is also bounded — verification rounds carry the same `hard`
ceiling among themselves, so a self-declared label cannot remove the
mechanical refusal entirely.

The purpose lands in the round's `ROUND.json` (machine-readable, what
the next cap check reads) and in the round's INDEX prose (what a human
reads when asking why a round did not count). A round that declares
nothing counts as a finding round — every round that ran before purposes
existed keeps its old meaning.

**The split rule.** Past `review.split.changedLines` /
`review.split.changedFiles` (built-in: 1200 / 20), `goals review` prints
an advisory to split the review UNIT — per-package legs when the diff
spans two or more packages, per-commit-range legs otherwise — rather
than add another round over the same oversized diff. Reviewer precision
falls with unit size (the research's benchmark F1 collapses 0.657 under
10 lines → 0.043 over 150; that curve does not transfer to a whole-branch
wave, but its direction does). It is ADVICE, never a refusal: a
mechanical 3000-line migration is legitimately one unit. Record which
case it was in the round's INDEX.

## Tiers and what they buy

| Tier     | When                                     | Wave | Finding rounds (results) | Executor          |
| -------- | ---------------------------------------- | ---- | ------------------------ | ----------------- |
| light    | XS/S with no risk surface                | no   | soft 1 / hard 3          | `claude-sonnet-5` |
| standard | M/L, or a small goal with a risk surface | yes  | soft 2 / hard 4          | `claude-opus-5`   |
| deep     | XL/XXL, or 3+ risk surfaces              | yes  | soft 3 / hard 6          | `claude-opus-5`   |

An UNSTATED size reads as L, not S: the recommendation errs toward more
lifecycle when the spec did not say, because under-reviewing costs
correctness while over-reviewing costs tokens.

The recommended engine roster always INTERSECTS what the project has
defined and staged — the recommendation can narrow a roster, never
conjure an engine the project has not configured.

## The signals, and correcting them

`goals plan` reads: the `## Sizing` section, whether the spec touches
code (a package path, a source file, an implementation verb, a dotted
settings key, a camelCase identifier, an `evie-kit <verb>` line),
which packages it names, and which risk surfaces it mentions
(credentials, git-history, protected-refs, destructive-fs, migrations,
concurrency, money, release). Every signal prints with its excerpt.

RISK surfaces are read from the DOING sections only (`## Problem`,
`## Scope`, `## Green gates`) — a goal that cites EVA-33's push guard
in its prior-art paragraph is not itself a protected-refs goal. The
patterns are calibrated against this repo's own promoted goals: the
first cut read 73 of 82 as risky (`auth\w*` matching "authored", a bare
`token` matching context-budget prose) and 9 real code goals as
docs-only, which would have made the waveless recommendation
unreachable in one direction and dropped the code scanners in the
other.

The heuristic errs toward CODE deliberately: a code goal misread as
docs-only would drop the scanners and default to waveless, the expensive
error. `--docs-only`, `--code` and `--size` correct a misreading before
it is accepted — which is the whole point of a confirmation seam.

## Where it plugs into the lifecycle

- **After promotion, before launch**: run `goals plan <KEY>`, brief the
  user with the summary (what it read → what it proposes → what it gives
  up), and offer the launch-seam picker. `--accept` on the confirmed
  option, then `goals execute`.
- **At launch**: `goals execute` takes the plan's executor model when no
  `--model` names one, and the generated handoff carries the plan
  sentence — a waveless plan tells the executor, in words, not to spawn
  a wave to be safe and to say so in RESULT.md if it believes the goal
  outgrew its plan.
- **At each round**: budgets, rosters, and reviewer models resolve
  through the recorded plan; verification rounds declare themselves.
- **At the wave**: the split advisory fires on oversized units.

A malformed `review:` / `execution:` block REFUSES the launch (loudly,
retryably) rather than degrading to "no plan": running a goal at
defaults nobody agreed to is the failure this record exists to prevent.
