# The humanizer lint companion

`evie-kit humanizer lint <files...>` — implemented in
`packages/humanizer` (TypeScript, no API calls, nothing reaching a
network; since EVA-137 the instrument tier adds two exact-pinned
local dependencies — the wink-nlp POS model and the WordNet 3.1 data
via `@evie-kit/wordnet` — loaded lazily and only when a tagged rule
is enabled). This file is the operating reference: contract, rule
inventory, calibration, config, and the green-gate recipe. Since
EVA-146 every rule is ONE canonical record
(`packages/humanizer/src/records*.ts`). The per-rule reference —
gloss, intent, example pairs, when-not-to-fix, acceptable use,
provenance, governance — is the GENERATED `rules.md` beside this
file; `evie-kit humanizer explain <id>` renders the same record
in-terminal.

## Contract

- `evie-kit humanizer lint <files...> [--json] [--fail-on
error|warn|info] [--config <path>]`
- Exit **0** when no finding reaches the `--fail-on` severity
  (default `warn`); exit **1** otherwise. Errors in invocation or
  config exit 1 with a message on stderr. Human output ends each
  file's block with ONE `see: evie-kit humanizer explain <ids>` tail
  naming the distinct rule ids found (EVA-146) — the terse pointer,
  never per-finding coaching.
- `evie-kit humanizer explain <rule-id> [<rule-id> ...] [--all]
[--json]` renders canonical records (variadic; an unknown id is a
  teaching error with a did-you-mean; a deprecated alias resolves
  with a `[humanizer_alias]` warning). `evie-kit humanizer reference
[--out <path>] [--check <path>]` prints, writes, or freshness-checks
  the generated `rules.md` (exit 1 on stale). When an installed
  reference is stale against the live inventory, `lint` and `explain`
  print a `[humanizer_reference]` notice naming the regenerate
  command.
- `--json` emits `{ config, profile, failOn, failingCount,
localLoosened, files: { <path>: { findings: [{ file, line, column,
ruleId, severity, message, excerpt }], metrics } } }` (EVA-74:
  `profile` is the effective profile name; `localLoosened` is the
  machine-local loosening report — an array of `{ ruleId, kind:
"disabled" | "severity" | "threshold", committed, local }` deltas,
  empty when nothing is looser than the committed settings). Rule IDs
  are STABLE — gates may cite them; renames are breaking changes.
- Markdown masking: YAML frontmatter, fenced code (up to three
  leading spaces of indent), inline code, URLs, and link targets
  (titles included) are invisible to prose rules. Artifact rules
  (`chatbot-artifact`, `placeholder-text`) keep URLs visible — leaked
  `utm_source=chatgpt.com` rides real links — while backticked tokens
  stay masked (mention vs use); an inline-code span must sit on ONE
  line to mask, and link destinations with nested unescaped
  parentheses mask only up to the first `)`. `unicode-invisible`
  scans everything, code included; ZWJ/ZWNJ count as obfuscation only
  when splitting an ASCII word (emoji sequences and orthographic
  joiners, e.g. Persian ZWNJ, pass).
- Metrics ride every JSON result regardless of findings: word count,
  em-dash count and density, AI-vocabulary density, hedge rate, copula
  rate, function-word rate, triad density, sentence-length CV, trigram
  repetition. Sentences terminate at `.`/`!`/`?` OR newline/EOF, so
  unpunctuated bullets and headings still count.

## Rule inventory

`evie-kit humanizer rules` prints the rule list under the built-in
house calibration (or a named `--profile`). It does NOT read the
repo's `tools.humanizer`, and says so in its header; `lint --json`
reports the profile and loosening actually in force. The full
inventory with every record's gloss, intent, examples, guards, and
provenance is the GENERATED `rules.md` beside this file (one heading
per rule id, `rules.md#<rule-id>`). The hand-maintained table this
section used to carry was retired in EVA-146: two tables drift.
Severity tiers:

| tier  | meaning                                              |
| ----- | ---------------------------------------------------- |
| error | artifact residue, wrong in any register, fail-closed |
| warn  | slop signals worth a human look                      |
| info  | statistical leads and house-style-adjacent shapes    |

A rule may additionally be **provisional** (EVA-146 governance). It
has not yet earned its tier through a corpus sweep, it ships at info
(a provisional rule never goes above warn), and its record names the
promotion pre-condition. `rules` and `explain` mark them.

Density rules carry a direction: most fire ABOVE their threshold;
the floor rules (`sentence-uniformity`, `copula-density`,
`function-word-rate`) fire BELOW it — scarcity is their tell. Floor
rules stay silent under 50 words (and uniformity under 10 sentences):
no lead, not a pass-by-zero.

The CC-dialect family (EVA-75) is warn-CEILINGED by design — it never
ships at error, because every term in it has a legitimate domain
sense somewhere. `cc-dialect` carries the high-precision metaphors
(`footgun`, `belt-and-suspenders`, `cargo cult`, `haunted`,
`smoking gun`, `chamfer`, `quiet part out loud`, `grooves`, `spine`);
`cc-dialect-ambiguous` carries the collision-prone terms (`seam`,
`load-bearing`, `blast radius`, `spike`, `sidecar`, `wrinkle`,
`vein`, `substrate`) at info. `surface` is deliberately in NEITHER
list: API surface, surface area, and the verb are so common in
technical prose that counting it is noise — the recorded over-ban
guard. (Term mentions here are backticked for the same reason your
docs' should be: inline code is masked, so a mention never counts as
a use.) Provenance: the r/ClaudeCode thread + ClaudeFire's catalog
(no license — terms as facts only; see `attribution.md`).

The abstract-metaphor family (EVA-137, unslop pattern 26 — MIT, see
`attribution.md`) mirrors the CC-dialect contract exactly:
`abstract-metaphor` carries the calibrated zero-hit half
(`north star`, `flywheel`, `bedrock` lowercase-only — capitalized
"Bedrock" is the AWS service, `gold-plating`, `locus`, `nexus`,
`endgame`, `evacuate`) at warn, warn-ceilinged;
`abstract-metaphor-ambiguous` carries the collision-prone half
(`vector`, `primitive`, `harness`, `scaffolding`, `modality`,
`paradigm`, `ratchet`, `wedge`, `vantage`) at info. `surface` and
`substrate` are deliberately in NEITHER list (`surface` per EVA-75's
over-ban guard; `substrate` already counts under
`cc-dialect-ambiguous`).

### The instrument tier (EVA-137: POS + WordNet)

Two rules count what regex families cannot, implemented over an
adopted contextual tagger (wink-nlp + wink-eng-lite-web-model, MIT,
exact-pinned — the EVA-137 research pass's ranked pick) composed with
the in-house WordNet 3.1 reader (`@evie-kit/wordnet`, data via the
wordnet-db package — no network at lint time):

- **`document-as-actor`** (info; warn under the strict profile): an
  artifact noun performing a human agency/emotion verb — `the report
hopes`, `the document celebrates`. The rule composes BOTH
  instruments (the goal's recorded design). The tagger establishes
  the in-context role, with object/PP positions guarded (`people who
read the report hope` stays silent — the readers hope). WordNet
  vets the noun's senses two ways: a known lemma must carry a
  communication/artifact sense, and any person/organization sense
  makes it a legitimate actor the rule refuses to flag — the vetting
  dropped `doc` (the DOCTOR), silences `guide`/`figure` (people) and
  `paper` (newsroom metonymy). Lemmas WordNet lacks (readme,
  changelog) stand on the calibrated closed list. The evidence names
  the footing either way.
  Two further recorded noise guards. Nouns inside a prepositional
  phrase never fire ("the author OF the report hopes" — the author
  is the actor). And citation idiom is a reviewable EXCLUSION list,
  not an absence (`argue`, `describe`, `promise`, `refuse`, `want`,
  `know`, … — "the spec promises" and "a pending table refuses" are
  this repo's own contract/refusal idiom; the EVA-137 sweep's 20
  pre-tuning hits were all of that class, and post-tuning the rule
  measures ZERO hits corpus-wide).
- **`synonym-cycling`** (info, threshold 3): three or more distinct
  noun lemmas sharing one WordNet synset inside a paragraph or
  markdown block — unslop's elegant-variation pattern made countable.
  WordNet polysemy caps its precision (the final sweep measured 4
  gated-corpus hits, mostly different-sense coincidences; the EVA-137
  goal record's `results/CALIBRATION.md` is the authority for the
  numbers), so it is a lead by construction and no profile promotes
  it.

Every instrument finding carries its evidence in the message — the
token/tag pair plus the WordNet sense footing
(`report/NOUN hopes/VERB; artifact sense: WordNet communication`) or
the shared synset's member words and gloss — which is what makes the
tier honest against EVA-67's inspectability line: the instruments
supply reviewable evidence for a lead, never a verdict. Determinism note: counts are
reproducible because the model and data are exact-pinned; a version
bump is a recalibration event, not a routine dependency update.

### The hybrid tier (EVA-146: token sequences)

Rules the regex tier cannot express — a part-of-speech tag inside a
literal pattern — ride a token-sequence engine over the SAME tagging
the instrument tier uses (`packages/humanizer/src/tokens.ts`). Each
sequence combines literal phrases (tokenized through wink itself, so
`load-bearing` matches however wink splits it), `{pos}`, `{lemma}`,
`{regex}` and optional tokens. Two guards ride a rule's record as
ACCEPTABLE_USE in the same grammar. Exclusion patterns drop a hit
that overlaps one (`real estate`, `estate sale`, a PROPN-adjacent
`Hoffman Estates`). A ±N-token domain-noun neighborhood, scoped to
the sequences it was mined for, is the research report's cheap
approximation of `metaphor plus a domain noun is safe`. Cluster
escalation raises the tier when several distinct construction KEYS
co-occur inside a rolling word window. Every finding carries its
token/tag evidence. Two rules ship, both PROVISIONAL at info:

- **`negative-parallelism-bare`** — `not ADJ, but ADJ` / `not NOUN but
NOUN` / `not VERB but VERB`: the negative-parallelism frame without
  its lexical marker. Zero hits on the 2374-file calibration corpus.
- **`engineering-metaphor`** — the successor register's cluster on
  abstract subjects plus the bare Tier-3 terms no other family counts
  (`estate`, `plumbing`, `sharp edges`, `yak shaving`). The
  construction sequences, one per line so each mention stays a masked
  code span:
  - `load-bearing claim`
  - `the seam between intent and execution`
  - `spine of the argument`
  - `blast radius of a decision`
  - `guardrails around tone`

  Only the CONSTRUCTION sequences cluster (3+ distinct within 1000
  words → warn); the bare terms are leads that never escalate — the
  calibration sweep found them house-endemic in their domain senses.
  The EVA-146 goal record's `results/CALIBRATION.md` holds the
  numbers.

Why a matcher of our own over wink's custom-entity grammar. That
grammar has no regex token. It also learns patterns globally per
pipeline instance — every rule's patterns, even when the config
disables the rule — which breaks the lazy-load contract the tagger
was adopted under. wink still supplies tokens, tags, and lemmas. Recorded
tagger limit: a sentence-initial capitalized noun is tagged PROPN and
left un-lemmatized (`Guardrails/PROPN`). Lemma matchers therefore also
accept the lower-cased surface form and its naive singular; a
`pos: "NOUN"` constraint still excludes the PROPN reading, by design.

### Rule ids are stable; renames need an alias (EVA-146)

Ids serve triple duty — typed settings suppression keys, `explain`
lookup keys, and heading anchors in `rules.md` — and consumer settings
files key on them, so RENAMING one is a breaking change. A rename
ships only with a deprecation alias on the record (`aliases`), or not
at all. The alias resolves everywhere an id is looked up — settings,
`--config`, inline allows, `explain` — with a `[humanizer_alias]`
teaching line. Retire by deletion and add a new id. No rule has ever
been renamed; the mechanism exists so the first one is done right.

A third candidate was validated and REJECTED: `false-scalar-range`
("from X to Y" on no real scale) failed countability — all 47 house
uses of the construction are legitimate transitions, and no WordNet
property separates a false range from a real one without reading
meaning. It stays skill-prose guidance (SKILL.md pattern 12); the
full evidence is the EVA-137 goal record's `results/CALIBRATION.md`.

## Inline allows (per-doc, reason mandatory)

The recorded-rationale half of the EVA-75 semantic-override rule. One
directive per HTML comment, document-scoped:

```markdown
<!-- humanizer-allow: cc-dialect-ambiguous(spike, load-bearing) agile spikes + construction prose -->
<!-- humanizer-allow: em-dash-density quoting a dash-heavy source verbatim -->
```

- A bare rule id allows the whole rule for the file; a parenthesized
  term list narrows it to those matched terms (phrase rules plus
  `document-as-actor`, whose term is the artifact noun's lemma —
  density/structure findings and group-shaped `synonym-cycling`
  findings have no term, so only bare allows cover them). Term
  matching is case- and hyphen/space-insensitive but otherwise EXACT
  against the matched text — an allow for `spine` does not cover
  `spines`; name inflected forms separately.
- The reason is REQUIRED and unknown rule ids refuse loudly, same
  posture as a malformed config file. ERROR-tier rules
  (`chatbot-artifact`, `placeholder-text`, `unicode-invisible`) are
  never allowable — the directive itself refuses, since no recorded
  rationale makes artifact residue legitimate; remove the artifact,
  or disable the rule in config if the repo genuinely rejects the
  gate. One directive per HTML comment — a second directive in the
  same comment refuses rather than silently not taking effect.
- Allows are REPORTED, never silent: human output prints each allow
  with its suppression count, and `--json` carries an `allows` array
  per file — a gate runner always sees what was overridden and why.
- HTML comments are masked from prose rules (a directive naming a
  term can never fire the rule it allows); artifact-class rules still
  see comment contents, fail-closed.

## Calibration (2026-08-04, this repo's shipped corpus)

Thresholds were set against eight shipped docs (goal GOAL/RESULT
files, two Exa research reports, two big skills, CLAUDE.md) so that
the WHOLE house corpus exits 0 at `--fail-on warn` while a synthetic
slop sample fails with 15 warn+ findings. The numbers that matter:

| metric                              | house range       | Exa-report range | default threshold |
| ----------------------------------- | ----------------- | ---------------- | ----------------- |
| em dashes /1000 masked words        | 16–31 (by choice) | 0–1              | warn above 35     |
| AI-vocab hits /1000 words           | 0                 | 0–1.5            | warn above 4      |
| hedge words /100 words              | 0–0.3             | 0–0.1            | info above 3.5    |
| copulas /100 words                  | 1.0–4.2           | 2.4–2.9          | info below 0.75   |
| function words /100 words           | 24–38             | 26–28            | info below 20     |
| sentence-length CV (this extractor) | 0.26–0.93         | 0.56–0.93        | info below 0.22   |
| trigram repetition                  | 0.00–0.05         | 0.02–0.03        | info above 0.10   |

CC-dialect placement (EVA-75 sweep over tracked markdown outside
`goals/` and `evals/`, re-measured after the results-001 review):
`cc-dialect` terms measured one metaphorical hit in the whole house
corpus — `validation spine` in a shared-package ADR, reworded to
plain English during EVA-75 — so warn-per-occurrence adds no new
gate failures anywhere in that 95-file sweep (its three existing
`--fail-on warn` failures are pre-existing `em-dash-density` and
`copula-avoidance` hits in files this family does not touch; the
narrower "whole corpus exits 0" promise above is scoped to the
eight calibration docs, not this sweep). The Humanized output
style's own term MENTIONS are backticked, per the mention-vs-use
rule, and lint clean. `blast radius` started in the warn list and was MOVED
to `cc-dialect-ambiguous` on measurement: its only three corpus hits
were the legitimate security containment term in a shipped research
report. The ambiguous terms are house-endemic by choice (`seam`
alone has ~50 uses in the goals skill), which is why that half is
info — leads for the agent-judge pass, not gate failures. `spine`
stays warn-tier deliberately: it is the thread's flagship metaphor,
and its legitimate senses (`spine-leaf` networking, anatomy) are
per-document recurrences the term-scoped allow handles — the
`network-notes` eval fixture demonstrates exactly that flow.

Two calibration lessons worth keeping:

- **Thresholds are instrument-specific.** External tools reported CV
  0.48–0.97 for the same files this linter measures at 0.26–0.93 —
  sentence extraction differs, so never port a threshold between
  tools; recalibrate against the target corpus.
- **Density beats presence.** 93% of sloplint's out-of-the-box
  findings on this corpus were its em-dash rules firing on deliberate
  house style. Presence rules for house-style features are noise;
  density ceilings with calibrated headroom are signal.

## Per-repo config (`tools.humanizer`, EVA-74)

Config lives in the layered `.evie-kit` settings — user →
project → local, the same stack every other capability rides — as
`tools.humanizer`. Two knobs compose:

- **`profile`** — a curated baseline: `strict` (client-facing
  register: tighter density ceilings, several statistical leads
  promoted to warn), `house` (the default — this file's calibration
  verbatim; absent config changes nothing), or `lenient`
  (internal/scratch registers: stylistic warns demote to info,
  ceilings gain headroom). The error tier (`chatbot-artifact`,
  `placeholder-text`, `unicode-invisible`) is untouchable by every
  profile — that residue is wrong in any register.
- **`rules.<id>`** — per-rule overrides on top of the profile:
  `severity` maps onto the exit-code contract as
  `off | info | warn | error` (`off` disables the rule; the old
  `enabled` key errors with a migration hint), `threshold` replaces
  the rule's numeric ceiling/floor.

```ts
// .evie-kit/settings.ts (project layer)
export const settings = () => ({
  tools: {
    humanizer: {
      profile: "strict",
      rules: {
        "em-dash-density": { threshold: 20 },
        "bold-colon-bullet": { severity: "warn" },
        "rule-of-three-density": { severity: "off" },
      },
    },
  },
});
```

The whole shape validates loudly at EVERY settings load — unknown
rule IDs, unknown keys, and malformed values error naming the file,
rather than silently applying defaults — and since EVA-146 the
`rules` keys are TYPED on the canonical rule-id union, so a
misspelled id squiggles at edit time too. A suppression block can be
modularized into its own imported file:

```ts
// .evie-kit/humanizer-rules.ts
import type { HumanizerRulesOverrides } from "@evie-kit/goals";
export const humanizerRules = {
  "em-dash-density": { threshold: 20 },
  "engineering-metaphor": { severity: "off" },
} satisfies HumanizerRulesOverrides;
// .evie-kit/settings.ts:  tools: { humanizer: { rules: humanizerRules } }
```

The coupling cuts both ways:
a non-`--config` lint loads the layered settings, so an unrelated
settings-stack failure fails the lint too. The failure carries a
scoped preamble naming the settings load as the culprit, never a bare
stack error.

**The machine-local layers may loosen, never silently.**
`settings.local.*` AND the user layer (`~/.evie-kit`) override
anything — the operator is trusted — but every rule those
machine-local layers leave LOOSER than the committed baseline (a
demoted severity, a relaxed threshold, `severity: "off"`, or a looser
machine-local `profile`) prints one `[humanizer_local]` stderr line
per lint run naming the delta, and rides `--json` as `localLoosened`.
Tightening is silent. The committed baseline is the project layer's
subtree as this machine evaluated it, MINUS values the loader
attributes to `ctx.env` chains — an env-derived value is machine-local
even when the deriving code is committed, so it diffs against the
built-in/profile default instead. Recorded limit: a value laundered
through e.g. `Number(ctx.env(...))` (or colliding with an identical
literal elsewhere in the layer) loses attribution and escapes the
notice. Second recorded limit: a project layer in the deprecated
declarative formats (`.json`/`.yaml`) is diffed as it sits on disk —
those formats carry no committed-content gate, so an UNCOMMITTED edit
to one raises no notice (the executable `settings.ts` path refuses to
load when working content differs from HEAD).

Two escape hatches: `--config <path>` pins an explicit JSON file of
the same `{ profile?, rules? }` shape and beats settings entirely
(what the EVA-72 eval suite's pinned-defaults contract builds on —
config affects runtime lint verdicts only, never the eval suite), and
`humanizer rules --profile <name>` prints any profile's effective
tiers. A leftover `.evie-kit/humanizer.json` (the retired EVA-67
config file) fails the run loudly with the migration path — never a
silent fallback.

## Green gates for content-heavy goals

A goal whose deliverables are prose MAY declare a humanizer gate in
its GOAL.md green-gates section. The gate is goal-declared and
executor-run (not a review engine). Recipe:

1. Name the deliverable files and the severity floor in the gate.
2. The executor runs the lint before completion and records the
   result (exit code + failing count) in RESULT.md.
3. Gate outbound-facing docs (research reports, Notion/Linear bodies,
   published pages) at `--fail-on warn`; internal records (GOAL.md,
   RESULT.md, handoffs) lint on request — their register is the
   calibration corpus, gating them adds noise, not quality.

Worked example (gate text to paste into a GOAL.md):

```markdown
## Green gates

- `evie-kit humanizer lint docs/research/<category>/<slug>.md` exits 0
  (humanizer gate at the default --fail-on warn; rule IDs and
  thresholds per skills/humanizer/references/lint.md; an
  uncategorized report lives at `docs/research/<slug>.md` — no
  category folder).
```

An ADVISORY judge pass — the skill itself reading the deliverable for
register fit — may ride on top of the hard lint gate when the goal
asks for it; it never replaces the deterministic gate.

## What the linter is NOT

- Not an authorship detector: counts are leads (Wikipedia cleanup
  guide's caution — repeated here because it is the contract).
- Not a trained CLASSIFIER: tier-1 checks are closed-list counting
  only. The EVA-137 instrument tier is exactly the revisit EVA-67's
  rejection reserved room for ("revisit only with a design that
  keeps every check inspectable"): tagged-token evidence in every
  finding, an adopted exact-pinned tagger, leads never verdicts.
  POS-sequence/bigram classification emitting bare scores remains
  rejected.
- Not a style enforcer: prettier owns formatting; this owns register.
