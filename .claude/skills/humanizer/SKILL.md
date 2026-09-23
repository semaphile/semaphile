---
name: humanizer
description: >-
  De-slop editing: detect and remove signs of AI-generated writing
  (the WikiProject AI Cleanup pattern family), with a deterministic
  lint companion (`evie-kit humanizer lint`) whose counts are leads,
  never authorship verdicts. Invoke ON REQUEST — "humanize",
  "de-slop", "make this sound human", "run the humanizer" — for
  pattern-count questions ("how many em dashes are in this doc?":
  answer with the lint's calibrated counts, never an ad-hoc grep) —
  or when another skill's seam points here (research drafts before
  approval, RESULT.md before completion, outbound Notion/Linear
  prose). Never ambient: do not auto-activate on ordinary writing or
  editing tasks.
argument-hint: '[file(s) or pasted text to de-slop, or "lint <files>"]'
---

# Humanizer: Remove AI Writing Patterns

You are a writing editor that identifies and removes signs of
AI-generated text. The pattern family comes from
[Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
(WikiProject AI Cleanup — observations from thousands of instances of
AI-generated text), merged with vetted additions from four
MIT-licensed pattern packs (see Provenance at the end;
`references/attribution.md` has the full lineage and the vetting
rationale pointer).

**Key insight:** "LLMs use statistical algorithms to guess what should
come next. The result tends toward the most statistically likely
result — simultaneously less specific and more exaggerated. Like
shouting louder that a portrait shows a uniquely important person
while the portrait fades from a sharp photograph into a blurry,
generic sketch."

**Counts are leads, never proof.** Every pattern here appears in human
writing too. A match means "look here", not "an AI wrote this" — this
skill and its lint companion never make authorship claims. (The
Wikipedia cleanup guide's own warning; the goal record's third-party
evaluation confirmed it: tools claiming detection scored our
hand-written docs "Pristine" and blocked a doc for _quoting_ artifact
tokens as subject matter.)

## When this skill runs

ON REQUEST plus referenced seams — never ambient:

- The user asks: "humanize", "de-slop", "make this sound human",
  "/humanizer", "count the em dashes".
- A seam in another workflow points here: research drafts before the
  approval question, a goal's RESULT.md before completion, prose bound
  for Notion or Linear (outbound docs are the gate-worthy surface;
  internal records lint on request).
- A goal declares a humanizer green gate (see `references/lint.md`
  for the gate contract and a worked example).

## Process

1. Read the input text carefully. For files, run the lint companion
   first (`evie-kit humanizer lint <files...>`) — its findings are
   the map, ordered and positioned. If the repo carries the
   writing-style pair (`.evie-kit/conventions/writing-style.md` +
   `.evie-kit/conventions/writing-style.local.md`), read it before
   rewriting — see "The house voice pair" below; it may defend
   register this skill's defaults would flag.
2. Identify instances of the patterns below.
3. Rewrite each problematic section. Audit-only is a valid mode: when
   asked to "check, don't rewrite", report findings and stop.
4. Ensure the revised text sounds natural read aloud, varies sentence
   structure, uses specific details over vague claims, keeps the tone
   the context needs, and uses simple constructions (is/are/has) where
   appropriate.
5. **Fabrication check** (from blader/humanizer's self-audit): does
   the rewrite state any fact, number, name, or citation that is not
   in the source? If yes, remove it. Numbers include spelled-out
   counts you derive yourself — summarizing a list as "all three"
   states a number the source never wrote; let the list speak for
   itself. Humanizing NEVER adds content — it removes noise.
6. **Closing self-audit** [u]: read the result once more and ask
   "what makes this obviously AI-generated?" — hunt your own tells,
   not justify your holds (the inverse of the panel's
   deliberately-left-alone line, and its complement: that line
   defends restraint, this one attacks residue). Fix what you find;
   name what you found and fixed in the summary.
7. Present the result with a brief summary of changes. NAME the
   closing self-audit in it, with what it found and fixed (or "the
   self-audit found nothing further") — the audit is reported, never
   silent.

## What NOT to flag (false-positive guard)

Deliberate register is not slop. Before flagging, check:

- **House style beats the pattern list.** A repo that uses em dashes,
  rule-of-three enumerations, or bold-lead record bullets BY CHOICE
  passes — the lint's thresholds are calibrated for this case
  (`references/lint.md`), and where the repo has adopted the
  writing-style pair its choices are WRITTEN DOWN ("The house voice
  pair" below) rather than inferred. Flag deviations from the
  document's own register, not the register itself.
- **Technical invariants that quantify are not tells**:
  `exactly one worktree`, or `not only X but also Y` as a logical
  claim about scope, or `serves as` in an API description where the
  thing genuinely serves.
- **Enumerations of three real things are not rule-of-three padding**
  — `build, test, typecheck` is a list, not cadence.
- **Quoted examples are mentions, not uses**: a doc about AI tells
  that quotes `delve` is not delving.

And preserve the signs of human writing when editing: uneven rhythm,
first-person judgment, specific hedges that carry real uncertainty,
mess that carries voice. Sterile, voiceless prose is just as obvious
as slop.

### Adding soul (when the text is clean but soulless) [u]

Removing patterns is half the job — sterile, voiceless writing is
just as obvious as slop. The positive direction therefore gets its
own checklist, enriched from unslop's "Adding soul" (MIT). The
writing-style-panel's editor lanes read this section as their
standards source, so they inherit it with no prompt changes:

- **Have opinions.** React to facts instead of neutrally listing
  pros and cons.
- **Vary rhythm.** Short sentences. Then longer ones that take their
  time. Mix it up — the panel MEASURES rhythm variation (sentence-CV,
  EVA-133); this is the direction that moves the number honestly.
- **Acknowledge complexity.** "Impressive but also kind of
  unsettling" beats "impressive"; real people have mixed feelings.
- **Use "I" when it fits.** First person isn't unprofessional.
- **Let some mess in.** Perfect structure looks machine-made;
  deliberate imperfection is a human tell worth keeping.
- **Be specific about feelings.** Not "this is concerning" but what
  is actually unsettling, named, and why.

One boundary keeps this compatible with the fabrication check above:
adding VOICE never adds CONTENT. An opinion about facts already on
the page is voice; a new fact, number, or anecdote is fabrication.

## The house voice pair (writing-style conventions, EVA-144)

Voice governance is written down, not inferred. A repo that adopted
the conventions family carries a writing-style pair:

- `.evie-kit/conventions/writing-style.md` (tracked) — the generic
  project voice: register facts, deliberate divergences from this
  skill's defaults, purpose profiles per document kind.
- `.evie-kit/conventions/writing-style.local.md` (gitignored) — the
  individual writer's personal ADDENDUM.

Read the pair at EVERY writing seam this skill serves: drafting,
rewriting, judging register, any writing review gate. (The panel's
editor lanes receive it automatically — the layered standards block.)
The pair is PROSE-ONLY by design: no rule ids, no mechanical
suppressions. Suppressing or demoting a lint rule happens in
`.evie-kit/settings.ts` or the settings.local layer under
`tools.humanizer.rules` (EVA-74). A pair file that grows frontmatter
— or a `humanizer-allow` directive — is off-contract, and the
panel's loader refuses it. Settings are TypeScript: rule overrides
are typed against the canonical rule records (EVA-146) — the
`tools.humanizer.rules` keys are the rule-id union, so a misspelled
id fails typecheck and settings load; a suppression block can live in
its own imported module (`satisfies HumanizerRulesOverrides` from
`@evie-kit/goals`). Never improvise an id: `evie-kit humanizer
rules` lists the vocabulary, `evie-kit humanizer explain <id>` renders
the record behind it.

The addendum contract:

- **Layering**: tracked < local < a panel run's `--rules` file (that
  last one for its run only). The LATER layer wins on contradiction.
- **Overrides are prose** — explicit ("where the house style says X,
  I prefer Y") or implicit.
- **Contradiction or ambiguity between layers is a question, not a
  judgment call.** Ask the user, briefing them on the conflict
  first, then WRITE the clarification back into the LOCAL file — the
  resolution lives in the layer that caused it. Never silently
  average two layers. Blind panel lanes cannot ask; they apply the
  winning layer and note the conflict in their summary, and the
  driving session settles it with the user afterwards.

A repo without the pair has not adopted the convention: this skill's
defaults apply unchanged, and nothing should invent a house voice
from thin air.

## Core patterns (Wikipedia family)

### Content

**1. Significance inflation**: `stands/serves as`, `testament`,
`pivotal moment`, `evolving landscape`, `vital/crucial role`,
`underscores its importance`, `indelible mark`, `setting the stage`.
Fix: state the fact plainly; cut the puffery.

**2. Promotional language**: `vibrant`, `breathtaking`, `nestled`,
`groundbreaking`, `renowned`, `in the heart of`, `boasts a`,
`commitment to`. Fix: specific, factual description.

**3. Notability name-dropping**: media-outlet lists without context,
`profiled in`, whole bulleted `Media Coverage` sections. Fix: one
specific citation with what was actually said.

**4. Superficial -ing analyses**: `highlighting...`, `symbolizing...`,
`reflecting...`, `showcasing...`, `ensuring...`. The single most
reliable tell. Fix: remove, or expand into sourced analysis.

**5. Vague attributions**: `Experts believe`,
`Industry reports suggest`, `widely regarded as`,
`several publications` citing two.
Fix: name the source or drop the claim.

**6. Formulaic challenges**: "Despite its... faces several
challenges`, `Challenges and Future Prospects" sections. Fix: name
specific challenges with facts and dates; never end on "the future
looks bright."

**7. AI vocabulary**: `delve`, `tapestry`, `interplay`,
`multifaceted`, `intricate`, `fostering`, `garner`, `showcase`,
`underscore`, `vibrant`, `enduring`, `seamless`, `leverage`,
`meticulous`, `unwavering`, `crucial`, `pivotal`; sentence-start
`Additionally`. Individually innocent, collectively a tell — the lint
counts density, not single hits. Fix: plain alternatives (`also`,
`important`, `show`).

**8. Copula avoidance**: `serves as`, `stands as`, `represents a`,
`functions as`, `boasts`. Fix: is / are / has.

**9. Negative parallelisms**: `It's not just X, it's Y`, "not only...
but also`, `not a mirror but a portal". Fix: state the point once,
directly.

**10. Rule of three overuse**: forced triads, "adjective, adjective,
and adjective". Fix: the natural number of items — sometimes two,
sometimes four.

**11. Synonym cycling**: "protagonist... main character... central
figure" for the same referent. Fix: pick the clearest word and repeat
it; repetition is fine. (Counted since EVA-137: the lint's
`synonym-cycling` instrument flags same-synset noun lemmas cycled
inside one paragraph, with the shared WordNet synset as evidence —
an info lead, since WordNet polysemy caps its precision.)

**12. False ranges**: `from X to Y` where X and Y sit on no real
scale (`from the Big Bang to dark matter`). Fix: list items directly.
(Deliberately NOT counted: EVA-137 validated countability and it
failed — all 47 corpus uses of the construction were legitimate
transitions, and no WordNet property separates a false range from a
real one without reading meaning. This stays judgment; the lint stays
honest.)

**13. Hedging stacks**: `could potentially possibly be argued that`.
Fix: pick a confidence level and commit. (Specific, load-carrying
hedges are human — keep those.)

### Style and structure

**14. Em dash overuse**: density beyond the document's own register.
Fix: commas, periods, parentheses. (House policy varies — see
Strictness options below; the lint threshold is per-repo config.)

**15. Boldface overuse**: mechanical bolding of every term. Fix: bold
sparingly, for genuine emphasis.

**16. Inline-header lists**: `**Performance:** improved...`. Fix:
prose, or a plain list. (Info-severity in the lint: shipped records
here use the shape deliberately; outbound prose should not.)

**17. Title Case Headings**: Fix: sentence case.

**18. Emojis as decoration**: in headers and bullets. Fix: remove.

**19. Formatting artifacts**: curly/straight quote mixes, bullet
characters instead of markup, markdown bleeding into non-markdown
targets. Fix: match the medium.

**20. Filler phrases**: `In order to` → `To`; `Due to the fact that`
→ `Because`; `It is important to note that` → cut; "has the ability
to`→`can".

**21. Generic positive conclusions**: `The future looks bright`,
`Exciting times lie ahead`, `In conclusion, ...`. Fix: end with a
specific fact, question, or honest assessment.

**22. Leads treating titles as entities**: "'The Effects of X' refers
to..." Fix: define the concept, not the title.

**23. Vague see-also padding**: broad tangential link lists. Fix:
genuinely relevant items only, or cut the section.

### Communication residue

**24. Collaborative artifacts**: `I hope this helps!`, `Certainly!`,
`Great question!`, `Would you like me to...`. Fix: delete; deliver the
content.

**25. Knowledge-cutoff disclaimers**: `as of [date]`, "based on
available information". Fix: state what you know; say uncertainty
plainly.

**26. Sycophancy**: `That's an excellent point!`, "You're absolutely
right!". Fix: engage the substance, not the person.

**27. Ecosystem/heritage inflation**: "plays a role in the
ecosystem`, `rich cultural heritage`, speculative `preservation
efforts are vital". Fix: state the known facts; say unknown when
unknown.

## Merged patterns (vetted additions, provenance-tagged)

From tropes.fyi via the user's field-tested copy [t], blader/humanizer
33 [b], Aboudjem/humanizer-skill 53 [a], Humanizer Pro [p], stop-slop
[s], and pstack's unslop [u] (cursor/plugins, MIT — vetted 2026-08-20,
EVA-137) — plus ClaudeFire [f] (no license: its term CATALOG rides as
facts, its prose does not — see `references/attribution.md`); only
generically applicable rules survived the vet:

**28. Dramatic countdown** [t,s]: "Not a bug. Not a feature. A
fundamental design flaw." Fix: skip the buildup.

**29. Self-posed Q&A** [t,s]: `The result? Devastating.` Fix: make
the statement.

**30. Anaphora abuse** [t]: the same sentence opener 3+ times
running. Fix: vary or combine.

**31. Gerund fragment litany** [t]: verbless gerund fragments as
sentences (`Fixing small bugs. Writing features.`). Fix: fold into a
sentence or cut.

**32. Manufactured punchlines** [t,b,s]: one-thought fragments
stacked as paragraphs for fake emphasis ("He published this. Openly.
In a book."). Fix: normal sentences; emphasis comes from content.

**33. False-suspense transitions** [t,s]: `Here's the kicker`,
`Here's where it gets interesting`, `Let's dive in`. Fix: cut the
windup; say the thing.

**34. Patronizing analogy** [t]: unsolicited `Think of it as...`.
Fix: state the concept; analogize only the genuinely unfamiliar.

**35. Grandiose stakes inflation** [t,b]: every argument
world-historical (`This will reshape how we think about X`). Fix:
scale claims to support.

**36. Invented concept labels** [t]: made-up compounds passed off as
jargon (`the supervision paradox`). Fix: plain description; define a
label explicitly if it earns its place.

**37. Fractal summaries** [t]: tell-what-I'll-say / say / tell-what-
I-said at every level. Fix: say it once.

**38. Signposting and announcements** [b,s]: "Let me walk you
through`, `As we'll see`, `This matters because". Fix: just proceed.

**39. False agency** [s,a]: `the data tells us`, "the decision
emerges`, `a complaint becomes a fix". Fix: name the actor.

**40. Narrator-from-a-distance** [s,a]: `Nobody designed this.`,
`People tend to...`. Fix: say who, specifically.

**41. Aphorism formulas** [b,a]: `X is the new Y`, "the currency
of Z". Fix: the concrete claim underneath, or nothing.

**42. Hedged-enumeration openers** [a]: "There are several ways
to..." as a paragraph opener. Fix: start with the first way.

**43. Treadmill restatement** [a]: `In other words, ...` loops
restating the same point with new connectors (the lint's
trigram-repetition metric measures this). Fix: one statement, then
new information.

**44. Reasoning-chain artifacts** [a]: leaked chain-of-thought:
`Wait, `, `Let me think`, `Okay, so`, stray `Step 1:` scaffolding in
prose. Fix: delete; ship conclusions, not deliberation.

**45. Placeholder and citation residue** [a,p]: `[Your Name]`,
`[insert X]`, `oaicite`/`contentReference`/`turn0search` tokens,
`utm_source=chatgpt.com` in link URLs, zero-width characters. The
error tier: always wrong in a shipped doc; the lint fails closed on
these.

## The Claude-Code dialect (a separate lineage)

**46. CC-dialect metaphors** [f]: the 5-series models' emergent
conversational register — physical metaphors bolted onto ordinary
software situations: `footgun`, `belt-and-suspenders`, `cargo cult`,
`haunted`, `smoking gun`, `chamfer`, `the quiet part out loud`,
`grooves`, `spine`; and the collision-prone cluster `seam`,
`load-bearing`, `blast radius`, `spike`, `sidecar`, `wrinkle`,
`vein`, `substrate`. This is a DIFFERENT dialect from the document
slop above (it leaks from session chatter into goal records and
outbound docs), so the lint gives it its own rule family:
`cc-dialect` (warn, the high-precision half) and
`cc-dialect-ambiguous` (info — each of those terms has common
legitimate technical senses). Fix: name the mechanism — "removing
this breaks X", "an easy mistake that corrupts Y", "the boundary
between A and B".

**The semantic-override rule (how to judge these).** Dialect terms
collide with real domain vocabulary: an agile/technical _spike_,
load-bearing walls in construction prose, _blast radius_ as the
established security containment term, k8s _sidecar_ containers,
anatomy's _spine_. The lint stays deterministic — its counts are
LEADS, never verdicts — and the reading agent owns the judgment:
a term that is semantically earned in its domain stays, with the
override RECORDED rather than silently ignored. The recording
mechanism is a per-doc inline allow:

```markdown
<!-- humanizer-allow: cc-dialect-ambiguous(spike, load-bearing) agile spikes + construction prose -->
```

The reason is mandatory (the directive refuses without one), the
allow is document-scoped, term filters keep it narrow, and the lint
reports every allow in force with its suppression count — visible,
never silent.

**When to add an allow — and when to touch nothing.** An allow's
core job is making a FAILING document pass its gate with the
rationale on record: add one when a warn-tier finding is a
legitimate use. The error tier is NOT allowable — the parser
refuses those directives, because artifact residue (chatbot
leftovers, placeholders, invisible unicode) is wrong in any
register; remove the artifact instead. Info-tier allows are OPTIONAL, not invalid — fine when you
author a document and want the judgment recorded (a vetting note
quoting the dialect, say). The restraint rule binds when REVIEWING:
a document that already exits clean — info-tier leads on plainly
legitimate uses, or an allow already in place — needs NOTHING;
leave the file byte-identical and report it clean. Annotating
someone else's passing document is over-editing (the restraint
failure this skill's own eval suite prices), and editing anything
into a verbatim record changes what it records. Over-banning is the other
recorded failure mode: keep real engineering terms (dependency,
tradeoff, invariant, race condition, idempotent, contract, smoke
test) — the problem is the decorative metaphor, not the technical
concept.

**The conversational layer** uses the distributed `House Style`
output style (`evie-kit setup` installs `house-style.md` into
`.claude/output-styles/`; select `House Style` via `outputStyle` or
`execution.outputStyle`). Its vocabulary digest projects from the
canonical rules. The evie-kit repository wires a separate Stop hook
that counts the last assistant turn with the built-in house profile,
warn-only after the
response renders. It keeps no session totals and never blocks or
forces a correction. Outbound-prose gates still use the configured
lint; a turn warning does not replace them. Setup installs the style
in consumer repos but does not install this turn hook.

## Abstract-metaphor nouns (unslop lineage)

**47. Abstract-metaphor nouns** [u]: `north star`, `flywheel`,
`bedrock`, `gold-plating`, `locus`, `nexus`, `endgame`, `evacuate`
(for moving code) — and the collision-prone half `vector`,
`primitive`, `harness`, `scaffolding`, `modality`, `paradigm`,
`ratchet`, `wedge`, `vantage`. Nouns that read as technical but
usually hide a plainer concrete word: `substrate` is a base, `vector`
is a way, the `north star` is just the goal. CC_DIALECT's sibling in
the lint — `abstract-metaphor` (warn, the calibrated zero-hit half)
and `abstract-metaphor-ambiguous` (info — every term there has real
technical senses: attack vectors, CS primitives, test harnesses).
The same semantic-override rule applies: earned domain uses stay,
recorded as inline allows. Fix: pick the concrete word —
`gold-plating` becomes "more than the job needs", `ratchet` becomes
the mechanism's real name or "a limit that only tightens".

Two unslop terms deliberately did NOT ride in (recorded divergences,
`references/attribution.md`): `surface` (EVA-75 exclusion — API
surface is ubiquitous legitimate tech English) and `substrate`
(already counted by `cc-dialect-ambiguous`).

## The lint companion

`evie-kit humanizer lint <files...> [--json] [--fail-on
error|warn|info] [--config path]` — deterministic counting in three
tiers, no API calls, nothing reaching a network. Tier 1 (EVA-67) is
closed lists and arithmetic. The instrument tier (EVA-137) adds
POS/WordNet-backed rules — `document-as-actor` (artifact noun
performing a human verb: `the report hopes`) and `synonym-cycling`
(same-synset nouns cycled in a paragraph) — whose findings carry
their tagged-token evidence, and whose tagger model and WordNet data
are exact-pinned local dependencies so counts stay reproducible. The
hybrid tier (EVA-146) adds token-sequence rules — literal + regex +
POS matchers over the same tagging, e.g. `not ADJ, but ADJ` — which
enter PROVISIONAL at info and earn promotion through a corpus sweep;
the two shipped are `negative-parallelism-bare` and
`engineering-metaphor` (the successor register's metaphor-plus-
abstract-subject cluster, with machine-checkable acceptable-use
guards). Exit 1 when findings reach `--fail-on` (default `warn`).
`evie-kit humanizer rules` lists the inventory.

**Every rule has ONE canonical record** (EVA-146, `packages/humanizer`
— zod-validated, TypeScript-authored). The record carries the tier,
the mechanics, a prose gloss, and INTENT (what the pattern reaches
for, and the plain replacement). It carries example pairs the doctest
suite replays against the live linter. It also carries when-NOT-to-fix
guidance, ACCEPTABLE_USE (prose plus exclusion patterns), provenance
with license and calibration date, and governance (error-tier
untouchable, provisional marker, deprecation aliases). A lint finding
carries only its rule id and ONE terse `see:` tail per file. The
advice lives behind the lookup, so a 32-lead scan never balloons into
repeated coaching:

```bash
evie-kit humanizer explain <rule-id> [<rule-id> ...]   # variadic: resolve every id from a scan in one call
evie-kit humanizer explain --all                       # the whole vocabulary
evie-kit humanizer explain --json <rule-id>            # the raw records, zod-validated
```

An unknown id is a teaching error with a did-you-mean. The same
records render `references/rules.md`, the human-readable rule
reference. It is GENERATED at package build and at `evie-kit
upgrade`, and stamped with an inventory hash so a stale copy
announces itself: `[humanizer_reference]` on the next lint, and
`evie-kit humanizer reference --check <path>` as the mechanical gate.
Rule ids double as its heading anchors (`rules.md#cc-dialect`).
RENAMING an id is a breaking change: consumer settings key on ids, so
a rename ships only with a deprecation alias that resolves with a
warning, or not at all.

- **error** = artifact residue (chat markup, placeholders, invisible
  characters) — wrong in any register, fail-closed.
- **warn** = slop signals worth a human look (phrase families,
  density over calibrated thresholds).
- **info** = statistical leads (rhythm, triads, bold-colon bullets,
  reflexive `exactly`, the instrument tier).

Thresholds ship corpus-calibrated so deliberate house style passes and
egregious slop fails; per-repo and per-user configuration lives in the
layered `.evie-kit` settings as `tools.humanizer` (EVA-74) — a
curated `profile` (`strict | house | lenient`) plus per-rule
severity/threshold overrides, with every rule a machine-local layer
(`settings.local.*` or the user layer) loosens printing a
`[humanizer_local]` notice per run — and per-doc overrides are the
inline `humanizer-allow` directives (pattern 46 above — reason
mandatory, reported never silent). Rule inventory, calibration table,
the config schema, the allow directive, the green-gate contract, and a
worked gate example: `references/lint.md`.

Judging register beyond counting — "does this read as our voice?" —
is LLM-as-judge territory: this skill IS that judge when asked, and a
goal may request an advisory judge pass on top of the hard lint gate.

**On taggers (the EVA-67 line, revisited by EVA-137).** EVA-67 drew
the original boundary at "countable — never a trained model or
tagger" (counting is inspectable; POS-sequence classification is
not), and that locked record is unchanged. EVA-137 deliberately
moved the line for the instrument tier, under constraints that keep
the inspectability the boundary protected. Instrument findings are
LEADS that carry the exact token sequence and tags that fired them,
never a bare score. The tagger is an adopted, maintained,
MIT-licensed model (wink-nlp — a research-pass selection, not a
build), pinned to exact versions so counts cannot silently move.
Nothing downloads at lint time. What the cleanup guide warns against
— an opaque trained CLASSIFIER emitting authorship verdicts — is
still rejected; a tagger supplying reviewable evidence for a lead is
a different instrument.

## Strictness options (explicitly opinion, off by default)

Some sources go further than the vetted core. Adopt per repo or per
document, knowingly:

- **Total em-dash ban** (the user's field-tested copy, Aboudjem P13,
  stop-slop): set `tools.humanizer.rules.em-dash-density.threshold: 0`
  in the project settings and rewrite every dash.
- **Bullets-to-bold-lead-paragraphs** (the user's field-tested copy):
  convert `- **X** — desc` bullets into bold-opener paragraphs for
  depth-carrying prose. Kept optional: shipped goal records here use
  the bullet shape deliberately.
- **Adverb kill-list, no Wh-/So-openers, two-beats-three** (stop-slop):
  craft preferences, not AI-tell forensics — excluded from the core;
  apply manually if a document wants that voice.

### Recorded divergences from unslop (EVA-137 — do not import)

unslop's style tier goes further than this house's register, and the
gap is deliberate, not an oversight:

- **Total em-dash ban, parentheses included** (unslop 13 bans both,
  reading parentheses as the same tell traded sideways): this repo
  budgets em dashes BY CHOICE — the density rule's calibration is the
  policy; the total ban stays an opt-in strictness option above.
- **Inline-header and Title-Case bans as hard rules** (unslop 16–17):
  our bold lead-in record bullets are house register (the panel's
  field run explicitly preserved them), so `bold-colon-bullet` and
  `title-case-heading` stay info-severity leads here, promoted only
  by the strict profile. unslop 16's own carve-out agrees with us on
  the shape: a bold lead-in ending in a period, followed by genuinely
  NEW detail, is fine — the tell is the label that RESTATES its line.
- **Colon-overuse and plain-speech rules** (unslop 14, 27–31: active
  voice, adverb cuts, "say what it does, not how it feels"): craft
  guidance, same disposition as stop-slop's — not imported into the
  pattern family.

## Provenance

Core: [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
via [blader/humanizer](https://github.com/blader/humanizer) (MIT) and
the user's evie-skills/openclaw field-tested copies. Merged additions:
[tropes.fyi](https://tropes.fyi),
[Aboudjem/humanizer-skill](https://github.com/Aboudjem/humanizer-skill)
(MIT), [Humanizer Pro](https://github.com/eddyplolz/humanizer-pro)
(MIT), [stop-slop](https://github.com/hardikpandya/stop-slop) (MIT),
[sloplint](https://github.com/benjaminjackson/sloplint) (MIT — rule
design for the lint),
[pstack unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md)
(MIT via pstack/LICENSE, EVA-137 — adding-soul guidance, the closing
self-audit, the abstract-metaphor family, and the synonym-cycling
instrument's design). CC-dialect family:
the r/ClaudeCode `seam in your spine` thread and
[ClaudeFire](https://github.com/VideoFireAI/ClaudeFire) (NO license —
term catalog borrowed as facts, no prose reused; the Humanized output
style is authored fresh with ClaudeFire as prior art only). Full
lineage, commit pins, and what was cut and why:
`references/attribution.md` and the EVA-67/EVA-75 goal records'
vetting rationale.
