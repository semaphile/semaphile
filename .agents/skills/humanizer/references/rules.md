<!-- humanizer-rules-inventory: 7d6e9381ed9cca29 -->
<!-- GENERATED from packages/humanizer/src/records.ts by `bun run --filter @evie-kit/humanizer build` (and re-rendered by `evie-kit upgrade`) — do not edit by hand; freshness: `evie-kit humanizer reference --check`. -->

<!-- humanizer-allow: trigram-repetition generated reference — every rule section repeats the same field labels by construction -->

# Humanizer rule reference

Generated from the canonical rule records (EVA-146): 33 rules, inventory hash `7d6e9381ed9cca29`. Every rule id below is a heading anchor (`#rule-id`), a typed `tools.humanizer.rules` suppression key, and an `evie-kit humanizer explain <id> [<id> ...]` lookup key. Term mentions and examples are backticked or fenced so this file passes the lint it documents. Counts are leads, never authorship verdicts; the skill's SKILL.md carries the editing process.

## Inventory

| id | tier | kind | evidence | provisional |
| --- | --- | --- | --- | --- |
| [`chatbot-artifact`](#chatbot-artifact) | error | phrase (regex) | residue |  |
| [`placeholder-text`](#placeholder-text) | error | phrase (regex) | residue |  |
| [`reasoning-artifact`](#reasoning-artifact) | warn | phrase (regex) | residue |  |
| [`negative-parallelism`](#negative-parallelism) | warn | phrase (regex) | measured |  |
| [`copula-avoidance`](#copula-avoidance) | warn | phrase (regex) | measured |  |
| [`vague-attribution`](#vague-attribution) | warn | phrase (regex) | measured |  |
| [`significance-inflation`](#significance-inflation) | warn | phrase (regex) | measured |  |
| [`filler-phrase`](#filler-phrase) | warn | phrase (regex) | measured |  |
| [`generic-conclusion`](#generic-conclusion) | warn | phrase (regex) | measured |  |
| [`cc-dialect`](#cc-dialect) | warn | phrase (regex) | anecdotal |  |
| [`cc-dialect-ambiguous`](#cc-dialect-ambiguous) | info | phrase (regex) | semi-measured |  |
| [`abstract-metaphor`](#abstract-metaphor) | warn | phrase (regex) | anecdotal |  |
| [`abstract-metaphor-ambiguous`](#abstract-metaphor-ambiguous) | info | phrase (regex) | anecdotal |  |
| [`exact-exactly`](#exact-exactly) | info | phrase (regex) | anecdotal |  |
| [`em-dash-density`](#em-dash-density) | warn | density (>35 per-1000-words) | measured |  |
| [`ai-vocabulary-density`](#ai-vocabulary-density) | warn | density (>4 per-1000-words) | measured |  |
| [`hedge-rate`](#hedge-rate) | info | density (>3.5 per-100-words) | measured |  |
| [`rule-of-three-density`](#rule-of-three-density) | info | density (>6 per-1000-words) | measured |  |
| [`sentence-uniformity`](#sentence-uniformity) | info | density (<0.22 ratio) | measured |  |
| [`copula-density`](#copula-density) | info | density (<0.75 per-100-words) | measured |  |
| [`function-word-rate`](#function-word-rate) | info | density (<20 per-100-words) | measured |  |
| [`trigram-repetition`](#trigram-repetition) | info | density (>0.1 ratio) | measured |  |
| [`document-as-actor`](#document-as-actor) | info | instrument (POS) | anecdotal |  |
| [`synonym-cycling`](#synonym-cycling) | info | instrument (POS/WordNet, >=3) | anecdotal |  |
| [`unicode-invisible`](#unicode-invisible) | error | structure | residue |  |
| [`nbsp`](#nbsp) | info | structure | structural |  |
| [`curly-quote-mix`](#curly-quote-mix) | warn | structure | structural |  |
| [`bold-colon-bullet`](#bold-colon-bullet) | info | structure | structural |  |
| [`hedge-stack`](#hedge-stack) | warn | structure (>=3/sentence) | measured |  |
| [`emoji-decoration`](#emoji-decoration) | info | structure | structural |  |
| [`title-case-heading`](#title-case-heading) | info | structure | structural |  |
| [`negative-parallelism-bare`](#negative-parallelism-bare) | info | hybrid (token sequence: literal + regex + POS) | anecdotal | since 2026-08-22 |
| [`engineering-metaphor`](#engineering-metaphor) | info | hybrid (token sequence: literal + regex + POS) | anecdotal | since 2026-08-22 |

## `chatbot-artifact`

- Tier: error — phrase (regex)
- Message: `Chat-session residue or leaked citation markup`
- Governance: error tier — untouchable by profiles, never allowable per document (remove the artifact instead)

**What:** Phrases and tokens that only make sense inside a chat turn. Sign-offs (`I hope this helps`), openers (`Great question`, `Certainly!`), offers (`Would you like me to`), self-identification (`As an AI`, knowledge-cutoff disclaimers). Also the citation markup some assistants leak into copied text: `oaicite`, `contentReference`, `turn0search1`, `utm_source=chatgpt.com` in a link.

**Why it reads as machine register:** Nothing a human author writes into a shipped document addresses a conversation partner or carries a chat client's citation markup. The residue proves the text was pasted out of a session unedited.

**Intent:** The document is an unedited paste of an assistant's reply; the phrase is addressed to the person who prompted, not to the reader. Plain: `delete the phrase`, `deliver the content without the frame`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Great question! I hope this helps with the relay configuration.
```
```text
after:  The relay configuration follows.
```

```text
before: Sources: https://example.com/doc?utm_source=chatgpt.com
```
```text
after:  Sources: https://example.com/doc
```

_the UTM tail rides a real link, which is why artifact rules still see URLs_

**When not to fix:**

- A document ABOUT assistant residue that quotes a token as subject matter — put the quote in inline code; backticked text is masked, so a mention never counts as a use.

**Acceptable use:** None in shipped prose. Quoted examples belong in code spans or fences (masked); a real occurrence is removed, never allowed — the error tier refuses inline allows.

**Provenance:** Wikipedia signs-of-AI-writing (communication residue) via blader/humanizer; Humanizer Pro chatbot-residue tokens; the EVA-67 research-report artifact shortlist. License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: residue; calibrated 2026-08-04. EVA-67 third-party eval: the only false catch was a QUOTED token — hence the mention-vs-use masking.

**Suppress:**

- `settings: tools.humanizer.rules["chatbot-artifact"] = { severity: "off" | "info" | "warn" | "error" }`

## `placeholder-text`

- Tier: error — phrase (regex)
- Message: `Unfilled template placeholder`
- Governance: error tier — untouchable by profiles, never allowable per document (remove the artifact instead)

**What:** Bracketed template slots left unfilled — `[Your Name]`, `[insert details here]` — and `lorem ipsum`.

**Why it reads as machine register:** A template slot is an instruction to the writer, not content; shipping it means nobody read the document after generating it.

**Intent:** The generator left a blank for a fact it did not have. Plain: `fill the slot with the real value`, `delete the sentence if the value does not exist`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Dear [Your Name], see [insert details here] for the schedule.
```
```text
after:  Dear Ada, see the attached schedule.
```

**When not to fix:**

- A markdown LINK whose label starts with `your` or `insert` — `[Your dashboard](/dashboard)` — is a link, not residue; the pattern already excludes the `](` shape.
- A template file that is MEANT to carry slots (a scaffold others fill in) — disable the rule for that path in settings rather than allowing per document.

**Acceptable use:** Template scaffolds only, by settings (`tools.humanizer.rules.placeholder-text.severity: off` in a layer scoped to that repo) — never by inline allow; the error tier refuses them.

**Provenance:** Aboudjem/humanizer-skill forensic category `placeholder text`. License: MIT (reimplemented). Evidence: residue; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["placeholder-text"] = { severity: "off" | "info" | "warn" | "error" }`

## `reasoning-artifact`

- Tier: warn — phrase (regex)
- Message: `Reasoning-trace residue at sentence start`
- Governance: stable id; settings and profiles may re-tier it

**What:** Chain-of-thought openers leaked into prose — a line starting `Wait,`, `Hmm,`, `Okay, so`, `Let me think`.

**Why it reads as machine register:** Deliberation narrated in the first person is what a model emits while deciding; shipped prose delivers the conclusion, not the deliberation.

**Intent:** The writer is thinking out loud — the sentence after the opener is usually the point. Plain: `delete the opener`, `state the conclusion directly`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Wait, the cache key changes per request.
So the hit rate is zero.
```
```text
after:  The cache key changes per request, so the hit rate is zero.
```

**When not to fix:**

- Verbatim transcripts, dialogue, or a deliberately conversational register where the opener is the voice. The pattern is line-anchored to keep such prose mostly out of reach; allow the rule per document when the register is the point.

**Acceptable use:** Quoted speech and transcripts: `<!-- humanizer-allow: reasoning-artifact verbatim interview transcript -->`.

**Provenance:** Aboudjem/humanizer-skill `reasoning-chain artifacts`. License: MIT (reimplemented). Evidence: residue; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["reasoning-artifact"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: reasoning-artifact(term, term) why this use is legitimate -->`

## `negative-parallelism`

- Tier: warn — phrase (regex)
- Message: `Negative parallelism (“not X, but Y”) — state the point directly`
- Governance: stable id; settings and profiles may re-tier it

**What:** The `not just X, it's Y` / `not only X but also Y` / `less about X, more about Y` contrast frame, where X is a straw position nobody held.

**Why it reads as machine register:** Models reach for the frame to manufacture emphasis. The negated half adds no information, and the construction recurs far above human rates in assistant prose.

**Intent:** The writer wants to stress Y; X exists only to be knocked down. Plain: `state Y once, directly`, `if X is a real position someone holds, name who holds it`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: It's not just a linter, it's a philosophy.
```
```text
after:  It is a linter with a point of view.
```

```text
before: This is not only fast but also correct.
```
```text
after:  This is fast and correct.
```

**When not to fix:**

- A logical claim about scope where both halves are checkable — `not only the parser but also the renderer reads the config` lists two real readers.
- Quoted speech.

**Acceptable use:** Real two-part scope claims stay; record them per document: `<!-- humanizer-allow: negative-parallelism the contrast lists two real readers -->`.

**Provenance:** Wikipedia signs-of-AI-writing via blader/humanizer (MIT) (negative parallelisms); stop-slop fake contrasts. License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: measured; calibrated 2026-08-04. Wikipedia lists the frame among its most reliable tells; house corpus measured zero hits at calibration.

**Suppress:**

- `settings: tools.humanizer.rules["negative-parallelism"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: negative-parallelism(term, term) why this use is legitimate -->`

## `copula-avoidance`

- Tier: warn — phrase (regex)
- Message: `Elaborate verb where “is/has” would do`
- Governance: stable id; settings and profiles may re-tier it

**What:** `serves as`, `stands as`, `acts as a`, `functions as a`, `represents a`, `boasts a` in place of is / has.

**Why it reads as machine register:** Dodging the plain copula is a register tic. It sounds elevated and says nothing the copula would not; assistant prose does it constantly, human prose rarely.

**Intent:** The writer means `X is Y` or `X has Y` and is avoiding the plain verb. Plain: `is`, `are`, `has`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The gallery serves as the exhibition space.
```
```text
after:  The gallery is the exhibition space.
```

```text
before: The library boasts a clean API.
```
```text
after:  The library has a clean API.
```

**When not to fix:**

- The verb carries its literal sense — an object that genuinely `serves as` a stand-in, a value that `represents a` measurement.
- Scarcity of copulas is the OTHER tell (`copula-density`, the floor rule) — do not strip every is/has chasing this one.

**Acceptable use:** Literal senses stay. A document that needs them repeatedly records the override: `<!-- humanizer-allow: copula-avoidance(serves as) API descriptions where the proxy genuinely serves -->`.

**Provenance:** Wikipedia signs-of-AI-writing via blader/humanizer (MIT) (copula avoidance). License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: measured; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["copula-avoidance"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: copula-avoidance(term, term) why this use is legitimate -->`

## `vague-attribution`

- Tier: warn — phrase (regex)
- Message: `Unnamed authority — name the source or drop the claim`
- Governance: stable id; settings and profiles may re-tier it

**What:** `Experts believe`, `industry reports suggest`, `widely regarded as`, `some say`, `critics argue` — authority with no name attached.

**Why it reads as machine register:** Weasel attribution lets a claim borrow weight it has not earned. Models produce it when they have the shape of a citation but not the citation.

**Intent:** The writer wants the claim to sound supported but has no specific source. Plain: `name the source and what it said`, `drop the claim`, `say 'I think' if it is an opinion`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Experts believe the approach scales.
```
```text
after:  Our load test showed the approach scales to the three hosts we run.
```

**When not to fix:**

- A survey of opinion where the vagueness is the point and the sources are listed elsewhere on the page.
- Quoted speech.

**Acceptable use:** Survey prose with sources nearby: `<!-- humanizer-allow: vague-attribution summarizing the cited survey responses -->`.

**Provenance:** Wikipedia signs-of-AI-writing via blader/humanizer (MIT) (vague attributions / weasel words). License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: measured; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["vague-attribution"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: vague-attribution(term, term) why this use is legitimate -->`

## `significance-inflation`

- Tier: warn — phrase (regex)
- Message: `Significance/promotional inflation — state the fact plainly`
- Governance: stable id; settings and profiles may re-tier it

**What:** `a testament to`, `pivotal role`, `rich tapestry`, `evolving landscape`, `underscores its importance`, `groundbreaking`, `nestled in` — puffery that asserts importance instead of showing it.

**Why it reads as machine register:** Models drift toward the most statistically likely praise; the result shouts that the subject matters while the portrait blurs into a generic sketch.

**Intent:** The writer wants the reader to feel the subject is important. Plain: `state the specific fact that makes it matter`, `cut the adjective`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: A testament to its pivotal role in the evolving landscape.
```
```text
after:  It handles retries for the whole platform.
```

**When not to fix:**

- A direct quotation.
- Marketing copy where inflation is the genre — scope the gate away from that path instead of rewriting it.

**Acceptable use:** Quotations; otherwise the fix is the plain fact, and there is no allow to record.

**Provenance:** Wikipedia signs-of-AI-writing via blader/humanizer (MIT) (significance inflation, promotional language). License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: measured; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["significance-inflation"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: significance-inflation(term, term) why this use is legitimate -->`

## `filler-phrase`

- Tier: warn — phrase (regex)
- Message: `Filler that adds no content`
- Governance: stable id; settings and profiles may re-tier it

**What:** `in order to`, `due to the fact that`, `it is important to note that`, `has the ability to`, `at the end of the day`, `here's the kicker`, `let's dive in` — throat-clearing and windups.

**Why it reads as machine register:** Filler pads a sentence without adding a fact. Models emit it as connective tissue because it is the most likely next phrase, not because anything needs saying.

**Intent:** Transition or emphasis the writer felt the sentence needed. Plain: `to`, `because`, `can`, `delete the windup and say the thing`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: In order to deploy, it is important to note that the build runs first.
```
```text
after:  To deploy, run the build first.
```

**When not to fix:**

- Quoted speech.
- `In order to` where `to` alone would read as an infinitive of purpose ambiguously — rare; rewrite the sentence rather than keeping the filler.

**Acceptable use:** Quotations only; the plain form is always available.

**Provenance:** Wikipedia signs-of-AI-writing via blader/humanizer (MIT) (filler phrases); stop-slop windups. License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: measured; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["filler-phrase"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: filler-phrase(term, term) why this use is legitimate -->`

## `generic-conclusion`

- Tier: warn — phrase (regex)
- Message: `Generic conclusion — end with a specific fact or honest assessment`
- Governance: stable id; settings and profiles may re-tier it

**What:** `In conclusion,`, `the future looks bright`, `exciting times ahead`, `only time will tell`, `remains to be seen`, `positioned for future success` — endings that assess nothing.

**Why it reads as machine register:** A generic close is the statistically safest last sentence. Human endings carry a specific fact, a question, or a judgment the writer is willing to own.

**Intent:** The writer needs to stop and reaches for a closing formula. Plain: `end on the last specific fact`, `ask the open question`, `say what you actually think`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: In conclusion, the future looks bright for the team.
```
```text
after:  The team ships the migration next sprint.
```

**When not to fix:**

- `remains to be seen` stating a genuine open question with the unknown named.
- Quoted speech.

**Acceptable use:** A named open question stays: `<!-- humanizer-allow: generic-conclusion(remains to be seen) the vendor has not published the date -->`.

**Provenance:** Wikipedia signs-of-AI-writing via blader/humanizer (MIT) (generic positive conclusions, formulaic challenges). License: MIT (reimplemented); Wikipedia text CC BY-SA (taxonomy only). Evidence: measured; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["generic-conclusion"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: generic-conclusion(term, term) why this use is legitimate -->`

## `cc-dialect`

- Tier: warn — phrase (regex)
- Message: `Claude-Code dialect metaphor — say the plain thing, or record an inline allow`
- Governance: warn-ceilinged family — counts are leads; the reading agent owns the verdict

**What:** The high-precision half of the Claude-Code conversational dialect: `footgun`, `belt-and-suspenders`, `cargo cult`, `haunted`, `smoking gun`, `chamfer`, `the quiet part out loud`, `grooves` (plural), `spine`.

**Why it reads as machine register:** The 5-series models' emergent register bolts physical/visual metaphors onto ordinary software situations; it leaks from session chatter into records and outbound docs. Zero hits across the shipped house corpus at calibration, so each occurrence is worth a look.

**Intent:** A vivid label for a hazard, a redundancy, a diagnosis, or a structure — compressing a judgment and an attitude into one word. Plain: `name the mechanism: what breaks, what the mistake corrupts, what the structure holds`.

| term | indicates | plain |
| --- | --- | --- |
| `footgun` | a design that makes self-inflicted mistakes easy | `hazard`, `mistake-prone default`, `easy to misuse` |
| `belt-and-suspenders` | deliberate redundancy | `redundant`, `a second safeguard`, `a backup check` |
| `cargo cult` | a practice copied without understanding | `copied without the reason`, `ritual` |
| `haunted` | failing in ways nobody has diagnosed | `buggy`, `unexplained failures` |
| `smoking gun` | the decisive evidence | `the evidence`, `the proof` |
| `chamfer` | softening an edge or transition | `soften`, `round off`, `ease the transition` |
| `quiet part out loud` | stating an implicit rule explicitly | `state the unstated rule` |
| `grooves` | a codebase's established conventions | `conventions`, `the existing patterns` |
| `spine` | the central organizing structure | `backbone`, `main thread`, `structure`, `outline` |

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: That config is a footgun for new contributors.
```
```text
after:  That config is easy to get wrong in a way that corrupts the index.
```

```text
before: The validation spine runs every check.
```
```text
after:  The validation pipeline runs every check.
```

**When not to fix:**

- Anatomy, `spine-leaf` networking, a literal `chamfer` in CAD prose — the domain sense is earned; record a term-scoped allow.
- Quoted speech and the dialect catalog itself (backtick the mention).

**Acceptable use:** Domain-earned uses stay, with the override RECORDED per document (term-scoped): `<!-- humanizer-allow: <rule>(<term>) <why this use is legitimate> -->`. A passing document needs nothing — annotating it is over-editing.

**Provenance:** r/ClaudeCode `seam in your spine` thread + ClaudeFire term catalog (facts only — no license, no prose reused). License: term list as unprotectable facts; matching code MIT. Evidence: anecdotal; calibrated 2026-08-04. Warn-ceilinged; the overindexed-vocabulary report tiers the cluster as anecdotal (practitioner catalogs, no per-term denominators).

**Suppress:**

- `settings: tools.humanizer.rules["cc-dialect"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: cc-dialect(term, term) why this use is legitimate -->`

## `cc-dialect-ambiguous`

- Tier: info — phrase (regex)
- Message: `Possible Claude-Code dialect metaphor — the term also has legitimate technical senses; judge in context`
- Governance: stable id; settings and profiles may re-tier it

**What:** The collision-prone half of the dialect: `blast radius`, `seam`, `load-bearing`, `spike`, `sidecar`, `wrinkle`, `vein`, `substrate` — each with common legitimate technical senses (agile `spikes`, k8s `sidecars`, security `blast radius`, this repo's own `seam` vocabulary).

**Why it reads as machine register:** Applied to abstract subjects at density — `the seam between intent and execution`, `a load-bearing claim` — these are the successor register's flagship tic. Applied to domain nouns they are ordinary engineering English, which is why this half is info.

**Intent:** Dependency, boundary, scope of failure, or a point of difficulty — engineering shorthand borrowed to label an abstraction. Plain: `critical`, `boundary`, `failure scope`, `complication`.

| term | indicates | plain |
| --- | --- | --- |
| `load-bearing` | critical dependency — supports something else and must not be removed casually | `critical`, `essential`, `a dependency`, `must not be removed` |
| `seam` | a boundary or junction between systems | `boundary`, `interface`, `join`, `transition` |
| `blast radius` | the scope of damage if something fails | `failure scope`, `impact`, `affected area` |
| `spike` | a time-boxed experiment (agile) or a sudden rise | `experiment`, `a sudden rise` |
| `sidecar` | a companion process or component | `companion process`, `helper` |
| `wrinkle` | a complication | `complication`, `catch`, `exception` |
| `vein` | the same line of thought | `along the same lines`, `similarly` |
| `substrate` | the underlying layer or medium | `base layer`, `foundation`, `underlying system` |

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The seam between the parser and the renderer is load-bearing.
```
```text
after:  The boundary between the parser and the renderer carries the whole pipeline; remove it and rendering breaks.
```

**When not to fix:**

- Metaphor + domain noun is safe: `load-bearing wall`, `API seam`, `incident blast radius`, `k8s sidecar`, `agile spike` — no allow needed at info; add one only when you want the judgment on record.
- Info tier: a passing document stays byte-identical.

**Acceptable use:** Measured placement, not a judgment call: the only would-be warn hits at calibration were three legitimate security uses of `blast radius`, and `seam` alone has ~50 house uses. Domain-earned uses stay, with the override RECORDED per document (term-scoped): `<!-- humanizer-allow: <rule>(<term>) <why this use is legitimate> -->`. A passing document needs nothing — annotating it is over-editing.

**Provenance:** r/ClaudeCode thread + ClaudeFire catalog (facts only); `load-bearing` is the one semi-measured term (Šuppa transcript audit; Claude Code issue 53454 — overindexed-vocabulary report). License: term list as unprotectable facts; matching code MIT. Evidence: semi-measured; calibrated 2026-08-04. `load-bearing`: 188 hits per 1.7M Claude words; Opus 4.6→4.7 0.5→12.0 per 10k words (one user's sessions). The rest of the list is anecdotal.

**Suppress:**

- `settings: tools.humanizer.rules["cc-dialect-ambiguous"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: cc-dialect-ambiguous(term, term) why this use is legitimate -->`

## `abstract-metaphor`

- Tier: warn — phrase (regex)
- Message: `Abstract-metaphor noun — pick the concrete word, or record an inline allow`
- Governance: warn-ceilinged family — counts are leads; the reading agent owns the verdict

**What:** Nouns that read as technical but usually hide a plainer word: `north star`, `flywheel`, `bedrock` (lowercase), `gold-plating`, `locus`, `nexus`, `endgame`, `evacuate` (for moving code).

**Why it reads as machine register:** Abstraction padding: a physical artifact donates a metaphor to software prose, or a pure abstraction stands in for a concrete noun. Zero hits across the gated house corpus at calibration, so each occurrence is worth a look.

**Intent:** A guiding priority, a self-reinforcing loop, a foundation, or a final goal — dressed as a technical noun. Plain: `the goal`, `the loop`, `the foundation`, `the outcome`.

| term | indicates | plain |
| --- | --- | --- |
| `north star` | the guiding priority | `goal`, `main criterion`, `guiding principle` |
| `flywheel` | a self-reinforcing loop | `feedback loop`, `the loop that feeds itself` |
| `bedrock` | the foundation or a basic assumption | `foundation`, `basic assumption` |
| `gold-plating` | more than the job needs | `more than the job needs`, `over-building` |
| `locus` | the place or center of something | `place`, `center`, `where it happens` |
| `nexus` | a link or center | `link`, `center`, `connection` |
| `endgame` | the final goal or outcome | `final goal`, `outcome`, `where this ends` |
| `evacuate` | moving code or data out of a place | `move out`, `migrate`, `remove` |

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Reliability is our north star this quarter.
```
```text
after:  Reliability is our main goal this quarter.
```

```text
before: Docs are the flywheel for adoption.
```
```text
after:  Good docs bring in users, and users file the issues that improve the docs.
```

**When not to fix:**

- Capitalized Bedrock (the AWS service) never fires — the pattern is lowercase-only; a literal `flywheel` in mechanical prose or a literal `evacuation` in emergency prose takes a term-scoped allow.

**Acceptable use:** Domain-earned uses stay, with the override RECORDED per document (term-scoped): `<!-- humanizer-allow: <rule>(<term>) <why this use is legitimate> -->`. A passing document needs nothing — annotating it is over-editing.

**Provenance:** pstack unslop pattern 26 (cursor/plugins, MIT — vetted 2026-08-20 at 99559f2); WordNet 3.1 hypernym walks for curation. License: MIT (reimplemented). Evidence: anecdotal; calibrated 2026-08-20. EVA-137 results/CALIBRATION.md: `bedrock` went lowercase-only (AWS collisions), `vantage` demoted to the ambiguous half (adhd skill vocabulary).

**Suppress:**

- `settings: tools.humanizer.rules["abstract-metaphor"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: abstract-metaphor(term, term) why this use is legitimate -->`

## `abstract-metaphor-ambiguous`

- Tier: info — phrase (regex)
- Message: `Possible abstract-metaphor noun — the term also has legitimate technical senses; judge in context`
- Governance: stable id; settings and profiles may re-tier it

**What:** The collision-prone half: `vector`, `primitive`, `harness`, `scaffolding`, `modality`, `paradigm`, `ratchet`, `wedge`, `vantage` — attack `vectors`, CS `primitives`, test `harnesses`, real Kuhnian `paradigms`.

**Why it reads as machine register:** Applied to abstractions (`a paradigm shift in how we think`, `a vector for adoption`) the noun hides a plainer word. Applied to its domain it is the right term, which is why this half is info.

**Intent:** A way, a basic building block, a support, or a kind of thing — named with a borrowed technical noun. Plain: `way`, `building block`, `support`, `kind`.

| term | indicates | plain |
| --- | --- | --- |
| `vector` | a way or route by which something arrives | `way`, `route`, `path` |
| `primitive` | a basic building block | `building block`, `basic operation` |
| `harness` | the setup that runs something | `test runner`, `setup` |
| `scaffolding` | temporary support for building or learning | `support`, `starter structure`, `setup` |
| `modality` | a mode or kind | `mode`, `kind`, `channel` |
| `paradigm` | a model or approach | `model`, `approach`, `way of working` |
| `ratchet` | a limit that only tightens | `a limit that only tightens`, `one-way` |
| `wedge` | a first foothold or opening | `opening`, `first step`, `foothold` |
| `vantage` | a viewpoint | `viewpoint`, `perspective` |

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Shipping weekly became a paradigm shift for the team.
```
```text
after:  Shipping weekly changed how the team plans work.
```

**When not to fix:**

- Domain senses — `attack vector`, `CS primitive`, `test harness`, the adhd skill's `vantage prompt` — need no allow at info.
- Info tier: a passing document stays byte-identical.

**Acceptable use:** Domain-earned uses stay, with the override RECORDED per document (term-scoped): `<!-- humanizer-allow: <rule>(<term>) <why this use is legitimate> -->`. A passing document needs nothing — annotating it is over-editing.

**Provenance:** pstack unslop pattern 26 (MIT); WordNet 3.1 abstractness evidence (EVA-137). License: MIT (reimplemented). Evidence: anecdotal; calibrated 2026-08-20. 66 gated-corpus hits at calibration, dominated by legitimate technical senses — the collision profile that makes this the info half.

**Suppress:**

- `settings: tools.humanizer.rules["abstract-metaphor-ambiguous"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: abstract-metaphor-ambiguous(term, term) why this use is legitimate -->`

## `exact-exactly`

- Tier: info — phrase (regex)
- Message: `Reflexive “exactly” emphasis — usually survives a delete`
- Governance: stable id; settings and profiles may re-tier it

**What:** `exactly` as bare emphasis — `this is exactly why`, `exactly what we need` — with nothing checkable attached.

**Why it reads as machine register:** Emphasis with no referent is a register tic; the sentence means the same without it, which is the sloplint test the rule borrows.

**Intent:** The writer wants emphasis on agreement or fit. Plain: `delete it`, `name the thing that makes it exact`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: This is exactly why the cache matters.
```
```text
after:  This is why the cache matters.
```

_`exactly one worktree` and other quantified invariants are guard-listed and never fire_

**When not to fix:**

- A quantified invariant — exactly one, exactly twice, exactly the same — is excluded by the pattern's guard list. If a new invariant shape fires, extend the guard; do not rewrite the invariant.
- Info tier: leave a passing document alone.

**Acceptable use:** Invariants and quotations; info leads on legitimate uses need no allow.

**Provenance:** sloplint `exact-exactly` rule. License: MIT (reimplemented). Evidence: anecdotal; calibrated 2026-08-04. The number-adjacent guard list is the false-positive class the EVA-67 corpus eval measured.

**Suppress:**

- `settings: tools.humanizer.rules["exact-exactly"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: exact-exactly(term, term) why this use is legitimate -->`

## `em-dash-density`

- Tier: warn — density (>35 per-1000-words)
- Message: `Em-dash density above threshold`
- Governance: stable id; settings and profiles may re-tier it

**What:** Em dashes (— or spaced --) per 1000 masked words above the ceiling.

**Why it reads as machine register:** Em-dash pileups are the single most reported assistant tell. The rule is a DENSITY ceiling, not a presence check. Deliberate house style uses the dash (house goal docs run 15–30 per 1000 by choice), so presence rules on it are pure noise.

**Intent:** An aside, a pause, or an appositive the writer wanted to set off. Plain: `a comma`, `a period and a new sentence`, `parentheses`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Words — more — words — again — and — again — here.
```
```text
after:  Words, more words, again and again, here.
```

**When not to fix:**

- A document quoting a dash-heavy source verbatim.
- House style under the ceiling is not slop — the threshold is per-repo config (strict drops it to 15; a total ban is `threshold: 0`).

**Acceptable use:** `<!-- humanizer-allow: em-dash-density quoting a dash-heavy source verbatim -->`; otherwise tune the threshold per repo.

**Provenance:** Wikipedia signs-of-AI-writing (em dash overuse) via blader/humanizer; sloplint density design. License: MIT (reimplemented). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house 16–31, Exa reports 0–1; 35 keeps house style green.

**Suppress:**

- `settings: tools.humanizer.rules["em-dash-density"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: em-dash-density why this document is exempt -->`

## `ai-vocabulary-density`

- Tier: warn — density (>4 per-1000-words)
- Message: `AI-vocabulary cluster density above threshold`
- Governance: stable id; settings and profiles may re-tier it

**What:** Hits from the AI-vocabulary list (delve, tapestry, interplay, multifaceted, underscore, showcase, foster, garner, intricate, vibrant, seamless, leverage, meticulous, crucial, pivotal, …) per 1000 words above the ceiling.

**Why it reads as machine register:** Individually innocent, collectively a tell: the excess-vocabulary literature measured delves at 28× expected frequency, underscores 13.8×, showcasing 10.7× in 2024 abstracts. Density, never single hits — one 'crucial' is coincidence.

**Intent:** Emphasis, scope, or polish — 'showcasing' means showing, 'crucial' means important, 'leverage' means use. Plain: `show`, `important`, `use`, `also`, `look at`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: We delve into the tapestry of intricate, vibrant realms and showcase the interplay.
```
```text
after:  We look at how the parts fit together.
```

**When not to fix:**

- A short document where one or two list words push the ratio over — read the hits; if each is the right word, leave it.
- A document ABOUT the vocabulary (backtick the mentions).

**Acceptable use:** `<!-- humanizer-allow: ai-vocabulary-density quoting the source's own wording -->`.

**Provenance:** Wikipedia signs-of-AI-writing (AI vocabulary) via blader/humanizer; Kobak et al. excess-vocabulary study (Science Advances, PubMed 2024) for the tiering. License: MIT (reimplemented); word list trimmed of house register. Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house 0, Exa reports 0–1.5.

**Suppress:**

- `settings: tools.humanizer.rules["ai-vocabulary-density"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: ai-vocabulary-density why this document is exempt -->`

## `hedge-rate`

- Tier: info — density (>3.5 per-100-words)
- Message: `Hedge-word rate above threshold`
- Governance: stable id; settings and profiles may re-tier it

**What:** Hedge words (`could`, `may`, `might`, `perhaps`, `possibly`, `potentially`, `arguably`, `somewhat`, `seems to`, `tends to`) per 100 words above the ceiling.

**Why it reads as machine register:** Document-wide hedging dilutes every claim; assistant prose hedges reflexively where a human commits or names the specific uncertainty.

**Intent:** Uncertainty the writer did not want to own. Plain: `commit to the claim`, `name the specific unknown once`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: It could perhaps possibly seem to work, arguably.
```
```text
after:  It works on the three hosts we tested.
```

**When not to fix:**

- Risk assessments and forecasts, where hedges carry real probability — keep those; the info tier never gates.

**Acceptable use:** Genuine uncertainty stays; an info lead needs no allow.

**Provenance:** Wikipedia signs-of-AI-writing (hedging) via blader/humanizer; tier-1 closed-list counting (EVA-67 grill). License: MIT (reimplemented). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house 0–0.3 per 100 words.

**Suppress:**

- `settings: tools.humanizer.rules["hedge-rate"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: hedge-rate why this document is exempt -->`

## `rule-of-three-density`

- Tier: info — density (>6 per-1000-words)
- Message: `Triad (“X, Y, and Z”) cadence density above threshold`
- Governance: stable id; settings and profiles may re-tier it

**What:** `X, Y, and Z` triads per 1000 words above the ceiling.

**Why it reads as machine register:** Forced triads — adjective, adjective, and adjective — are a rhythm tic; models pad lists to three because three scans as complete.

**Intent:** Completeness or rhythm. Plain: `the natural number of items — sometimes two, sometimes four`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Build, test, and ship; then plan, write, and review.
```
```text
after:  Build and ship it, then review the plan.
```

**When not to fix:**

- Enumerations of three real things — build, test, typecheck — are lists, not cadence; read the hits before touching a listicle.

**Acceptable use:** Real lists stay; info leads need no allow.

**Provenance:** Wikipedia signs-of-AI-writing (rule of three) via blader/humanizer. License: MIT (reimplemented). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: triads ≲4 per 1000 on non-listicle house docs.

**Suppress:**

- `settings: tools.humanizer.rules["rule-of-three-density"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: rule-of-three-density why this document is exempt -->`

## `sentence-uniformity`

- Tier: info — density (<0.22 ratio)
- Message: `Sentence lengths unusually uniform (low variation)`
- Governance: stable id; settings and profiles may re-tier it

**What:** Coefficient of variation of sentence length (words, newline-bounded sentences of 4+ words, 10+ sentences) BELOW the floor.

**Why it reads as machine register:** Uniform rhythm reads machine-made; human prose mixes short sentences with long ones. The floor is instrument-specific (this extractor measures house docs at 0.26–0.93; other tools report higher for the same files).

**Intent:** Every sentence was built to the same template. Plain: `vary the rhythm: a short sentence, then a longer one that takes its time`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops. The parser reads the file and stops.
```
```text
after:  The parser is the entry point and the first gate. The renderer is the second gate and the last check. Each module has one job: it takes input, passes output along, and exits. The pipeline has no state between runs, and every stage logs what it saw before the next one begins.
```

**When not to fix:**

- Changelogs, tables rendered as lines, and other structurally uniform text — the shape is the genre.

**Acceptable use:** Structurally uniform genres; info leads need no allow.

**Provenance:** StyloAI / sentence-rhythm literature via EVA-67's research pass. License: MIT (own implementation). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house CV 0.26–0.93; never port a threshold between tools.

**Suppress:**

- `settings: tools.humanizer.rules["sentence-uniformity"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: sentence-uniformity why this document is exempt -->`

## `copula-density`

- Tier: info — density (<0.75 per-100-words)
- Message: `Copula rate below floor — is/are/has may be being avoided`
- Governance: stable id; settings and profiles may re-tier it

**What:** is/are/was/were/has/have/had per 100 words BELOW the floor (documents of 50+ words).

**Why it reads as machine register:** Copula AVOIDANCE is the tell (see copula-avoidance for the per-phrase half): prose that never says 'is' has been dressed up sentence by sentence.

**Intent:** The writer replaced every plain copula with an elaborate verb. Plain: `is`, `are`, `has`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The parser serves as the entry point and acts as the first gate. The renderer functions as a second gate and stands as the last check. Each module performs one job, passes its output along, and exits. Nothing in the pipeline keeps state between runs, and every stage logs what it saw before the next stage begins.
```
```text
after:  The parser is the entry point and the first gate. The renderer is the second gate and the last check. Each module has one job: it takes input, passes output along, and exits. The pipeline has no state between runs, and every stage logs what it saw before the next one begins.
```

**When not to fix:**

- Imperative prose (runbooks, recipes) legitimately has few copulas — the floor is silent under 50 words and info above it; read before rewriting.

**Acceptable use:** Imperative genres; info leads need no allow.

**Provenance:** EVA-67 grilled tier-1 list (copula density as a floor). License: MIT (own implementation). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house 1.0–4.2 per 100 words.

**Suppress:**

- `settings: tools.humanizer.rules["copula-density"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: copula-density why this document is exempt -->`

## `function-word-rate`

- Tier: info — density (<20 per-100-words)
- Message: `Function-word rate below floor — dense noun-pile register`
- Governance: stable id; settings and profiles may re-tier it

**What:** Function words (the, a, of, to, in, and, …) per 100 words BELOW the floor (documents of 50+ words).

**Why it reads as machine register:** Function-word-poor prose is the machine noun pile — headings glued into sentences; StyloAI names stop-word behavior among its most salient features.

**Intent:** Compression into noun stacks. Plain: `write sentences with articles and prepositions`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration. Module component subsystem architecture layer pipeline framework integration.
```
```text
after:  The parser is the entry point and the first gate. The renderer is the second gate and the last check. Each module has one job: it takes input, passes output along, and exits. The pipeline has no state between runs, and every stage logs what it saw before the next one begins.
```

**When not to fix:**

- Terse record docs and tables-as-text sit at the low end of the house range (24) by design; the floor is under it, and the info tier never gates.

**Acceptable use:** Terse record genres; info leads need no allow.

**Provenance:** EVA-67 grilled tier-1 list (StyloAI stop-word family). License: MIT (own implementation). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house 24–38 per 100 words.

**Suppress:**

- `settings: tools.humanizer.rules["function-word-rate"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: function-word-rate why this document is exempt -->`

## `trigram-repetition`

- Tier: info — density (>0.1 ratio)
- Message: `Repeated-trigram ratio above threshold (treadmill prose)`
- Governance: stable id; settings and profiles may re-tier it

**What:** 1 − unique/total word trigrams, above the ceiling (documents of 50+ words).

**Why it reads as machine register:** Treadmill restatement — the same point re-said with new connectors — repeats its trigrams. The metric separated Exa machine prose (0.137) from goal-authored docs (≤0.052) on the calibration corpus.

**Intent:** Restating the same point to fill space. Plain: `say it once, then add new information`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result. The cache stores the result and the cache returns the result.
```
```text
after:  The parser is the entry point and the first gate. The renderer is the second gate and the last check. Each module has one job: it takes input, passes output along, and exits. The pipeline has no state between runs, and every stage logs what it saw before the next one begins.
```

**When not to fix:**

- Reference material that repeats a fixed phrase by contract (a command repeated per row) — read the hits; the info tier never gates.

**Acceptable use:** Repeated-by-contract reference material; info leads need no allow.

**Provenance:** Aboudjem/humanizer-skill metrics CLI (treadmill metric). License: MIT (reimplemented). Evidence: measured; calibrated 2026-08-04. EVA-67 corpus calibration (2026-08-04); house range in skills/humanizer/references/lint.md: house 0.00–0.05; Exa 0.02–0.03; machine prose 0.137.

**Suppress:**

- `settings: tools.humanizer.rules["trigram-repetition"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: trigram-repetition why this document is exempt -->`

## `document-as-actor`

- Tier: info — instrument (POS)
- Message: `Artifact noun performing a human verb — name the human actor`
- Governance: stable id; settings and profiles may re-tier it

**What:** An artifact noun (report, document, section, codebase, …) as the subject of a human agency/emotion verb — `the report hopes`, `the document celebrates`. Composes two instruments: the tagger establishes the in-context role (object and PP positions are guarded), WordNet vets that the noun has an artifact sense and no person/organization sense.

**Why it reads as machine register:** False agency was the most-flagged standard in both consumer field runs: a document cannot hope; the writer is hiding the human who does.

**Intent:** The writer is attributing a person's intent to the artifact that carries it. Plain: `name the human actor: the authors hope, the team decided`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The report hopes readers adopt it.
```
```text
after:  The authors hope readers adopt the report.
```

**When not to fix:**

- Citation idiom — `the paper argues`, `this section describes`, `the spec promises` — is a reviewable EXCLUSION list (CITATION_IDIOM_VERBS), never matched; moving a verb is a calibration decision, not a code tweak.
- `The author of the report hopes` stays silent by the PP guard; `people who read the report hope` by the object guard.

**Acceptable use:** Accepted newsroom metonymy (`the paper hopes`) is vetted out structurally — paper has an organization sense. Anything else legitimate takes a term-scoped allow: `<!-- humanizer-allow: document-as-actor(report) deliberate personification in the intro -->`.

**Provenance:** stop-slop / Aboudjem false-agency tables; EVA-137 composition design; wink-nlp + wink-eng-lite-web-model (MIT, exact-pinned) and WordNet 3.1 via @evie-kit/wordnet. License: MIT (own implementation); WordNet under the Princeton license (attribution in packages/wordnet/README.md). Evidence: anecdotal; calibrated 2026-08-20. EVA-137 results/CALIBRATION.md: 20 pre-tuning hits were all house idiom; five verbs moved to the exclusion list; zero hits across 2216 files after.

**Suppress:**

- `settings: tools.humanizer.rules["document-as-actor"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: document-as-actor(term, term) why this use is legitimate -->`

## `synonym-cycling`

- Tier: info — instrument (POS/WordNet, >=3)
- Message: `Same-synset nouns cycled in one paragraph — pick the clearest word and repeat it`
- Governance: stable id; settings and profiles may re-tier it

**What:** Three or more distinct noun lemmas sharing one WordNet synset inside a paragraph or markdown block (`aim`, `objective`, `target`).

**Why it reads as machine register:** Elegant variation — cycling synonyms for one referent — reads as padding; repetition of the clearest word is fine. WordNet polysemy caps precision, so it is a lead by construction.

**Intent:** The writer is avoiding repeating a word. Plain: `pick the clearest word and repeat it`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The aim of this work is speed. Our objective is a smaller binary, and the target is a faster build.
```
```text
after:  The aim of this work is speed: a smaller binary and a faster build.
```

**When not to fix:**

- Different-sense coincidences — `choice, pick, option` each used in a different sense — are the common false lead; read the shared synset in the evidence before editing.
- Group-shaped: only a bare rule-level allow covers it; info tier never gates.

**Acceptable use:** `<!-- humanizer-allow: synonym-cycling quoting a thesaurus discussion verbatim -->`.

**Provenance:** pstack unslop pattern 11 (MIT) made countable via WordNet 3.1 (@evie-kit/wordnet). License: MIT (own implementation); WordNet under the Princeton license. Evidence: anecdotal; calibrated 2026-08-20. Block-aware windows since EVA-137 results-002; 4 gated-corpus leads at the final sweep, mostly different-sense coincidences.

**Suppress:**

- `settings: tools.humanizer.rules["synonym-cycling"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: synonym-cycling why this document is exempt -->`

## `unicode-invisible`

- Tier: error — structure
- Message: `Invisible/zero-width character`
- Governance: error tier — untouchable by profiles, never allowable per document (remove the artifact instead)

**What:** Zero-width spaces, word joiners, BOMs, soft hyphens anywhere in the file (code included), and a ZWJ/ZWNJ splitting an ASCII word.

**Why it reads as machine register:** Invisible characters are either obfuscation (defeating word-level detectors) or copy residue. Either way they corrupt search, diffs, and rendering, and are wrong in any register.

**Intent:** Residue of a paste or a deliberate attempt to disguise a word. Plain: `delete the character`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Zero\u200Bwidth space inside.
```
```text
after:  Zero-width space removed.
```

**When not to fix:**

- Emoji ZWJ sequences and orthographic joiners (Persian ZWNJ) never fire — the joiner pattern requires ASCII alphanumerics on both sides.

**Acceptable use:** None; the error tier refuses inline allows. A repo that needs the characters disables the rule in settings.

**Provenance:** Aboudjem/humanizer-skill `unicode obfuscation`. License: MIT (reimplemented). Evidence: residue; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["unicode-invisible"] = { severity: "off" | "info" | "warn" | "error" }`

## `nbsp`

- Tier: info — structure
- Message: `Non-breaking space in prose`
- Governance: stable id; settings and profiles may re-tier it

**What:** U+00A0 in prose.

**Why it reads as machine register:** Usually paste residue from a rich-text editor; legitimate in some typography (units, initials), hence info.

**Intent:** A paste from a word processor, or deliberate typographic glue. Plain: `an ordinary space`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: Hard\u00A0space here.
```
```text
after:  Hard space here.
```

**When not to fix:**

- Typographic glue between a number and its unit, or in an initialism — the strict profile raises it to warn; house keeps it info.

**Acceptable use:** Typography; info leads need no allow.

**Provenance:** Aboudjem/humanizer-skill forensic tier. License: MIT (reimplemented). Evidence: structural; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["nbsp"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: nbsp why this document is exempt -->`

## `curly-quote-mix`

- Tier: warn — structure
- Message: `Mixed curly and straight double quotes`
- Governance: stable id; settings and profiles may re-tier it

**What:** Both “curly” and `straight` double quotes in one document's prose.

**Why it reads as machine register:** A document that mixes them was assembled from two sources — typically a generated passage pasted into a hand-written one. One finding per document.

**Intent:** Two authoring tools met in one file. Plain: `pick one quote style for the file`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: She said “yes” and then "no".
```
```text
after:  She said "yes" and then "no".
```

**When not to fix:**

- Quoted source material that must keep its typography — allow per document.

**Acceptable use:** `<!-- humanizer-allow: curly-quote-mix the quoted passages keep their source typography -->`.

**Provenance:** Wikipedia signs-of-AI-writing (formatting artifacts) via blader/humanizer. License: MIT (reimplemented). Evidence: structural; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["curly-quote-mix"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: curly-quote-mix why this document is exempt -->`

## `bold-colon-bullet`

- Tier: info — structure
- Message: `Bold-colon bullet — prose or a plain list reads better`
- Governance: stable id; settings and profiles may re-tier it

**What:** List items of the shape `- **Label:** text` (or `- **Label** — text`).

**Why it reads as machine register:** Wikipedia's guide reads the inline-header list as an AI tell. This repo's shipped records use the shape BY CHOICE (58 calibration-corpus hits), so house keeps it info and strict sides with the guide.

**Intent:** A labeled list the writer wanted to scan. Plain: `a plain list`, `a short paragraph per item`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: - **Performance:** improved by 20%.
```
```text
after:  - Performance improved by 20%.
```

**When not to fix:**

- House register (record bullets with a bold lead-in). unslop's own carve-out agrees: a bold lead-in followed by genuinely NEW detail is fine; the tell is a label that restates its line.

**Acceptable use:** House record bullets; info by default, strict raises it to warn.

**Provenance:** Wikipedia signs-of-AI-writing (inline-header lists) via blader/humanizer; the user's openclaw copy pattern 43. License: MIT (reimplemented). Evidence: structural; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["bold-colon-bullet"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: bold-colon-bullet why this document is exempt -->`

## `hedge-stack`

- Tier: warn — structure (>=3/sentence)
- Message: `Several hedges in one sentence — pick a confidence level`
- Governance: stable id; settings and profiles may re-tier it

**What:** Three or more hedge words in ONE sentence (threshold configurable).

**Why it reads as machine register:** `could potentially possibly be argued that` stacks hedges until the sentence claims nothing; a human picks a confidence level and commits.

**Intent:** The writer wants to say something without being held to it. Plain: `commit`, `name the one uncertainty that matters`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: It could perhaps possibly be argued that this works.
```
```text
after:  This works.
```

**When not to fix:**

- A sentence whose hedges each carry a distinct, real uncertainty — rare; keep it and record why.

**Acceptable use:** `<!-- humanizer-allow: hedge-stack the forecast sentence states three independent unknowns -->`.

**Provenance:** Wikipedia signs-of-AI-writing (hedging stacks) via blader/humanizer. License: MIT (reimplemented). Evidence: measured; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["hedge-stack"] = { severity: "off" | "info" | "warn" | "error", threshold: <number> }`
- `inline: <!-- humanizer-allow: hedge-stack why this document is exempt -->`

## `emoji-decoration`

- Tier: info — structure
- Message: `Decorative emoji in prose`
- Governance: stable id; settings and profiles may re-tier it

**What:** Pictographic emoji in prose, headings, or bullets.

**Why it reads as machine register:** Decorative emoji in a document are a chat-register carry-over; house keeps it info, strict raises it to warn.

**Intent:** Visual emphasis or friendliness. Plain: `remove it; let the words carry the tone`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: 🚀 Ship it fast.
```
```text
after:  Ship it fast.
```

**When not to fix:**

- Status legends and UI copy where the glyph IS the content; the info tier never gates.

**Acceptable use:** Glyph-as-content; info leads need no allow.

**Provenance:** Wikipedia signs-of-AI-writing (emojis as decoration) via blader/humanizer. License: MIT (reimplemented). Evidence: structural; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["emoji-decoration"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: emoji-decoration why this document is exempt -->`

## `title-case-heading`

- Tier: info — structure
- Message: `Title Case heading — prefer sentence case`
- Governance: stable id; settings and profiles may re-tier it

**What:** A level-2+ heading of four or more words with every word capitalized.

**Why it reads as machine register:** Title Case headings are the default of several assistants; this house writes sentence case. Info, because it is a style fact, not a slop signal on its own.

**Intent:** A default heading style. Plain: `sentence case`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: ## The Quick Brown Fox Jumps
```
```text
after:  ## The quick brown fox jumps
```

**When not to fix:**

- Proper-noun headings and a repo whose style guide IS Title Case — tune it off in settings.

**Acceptable use:** Proper nouns; repo style via settings.

**Provenance:** Wikipedia signs-of-AI-writing (Title Case headings) via blader/humanizer. License: MIT (reimplemented). Evidence: structural; calibrated 2026-08-04.

**Suppress:**

- `settings: tools.humanizer.rules["title-case-heading"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: title-case-heading why this document is exempt -->`

## `negative-parallelism-bare`

- Tier: info (provisional) — hybrid (token sequence: literal + regex + POS)
- Message: `Bare “not X but Y” contrast — state the point directly`
- Governance: PROVISIONAL since 2026-08-22 — promote when: three corpus sweeps (EVA-137 recipe) without a false-positive report, then warn is the ceiling

**What:** The negative-parallelism frame WITHOUT its lexical marker — `not fast, but correct`, `not speed but correctness` — which the regex rule (negative-parallelism) cannot see because nothing but a part-of-speech pattern identifies it.

**Why it reads as machine register:** Same manufactured contrast as negative-parallelism: the negated half is a straw position and the construction recurs above human rates. The pos-sequences research verdict named generalizing negative-parallelism to a mixed lexical+tag pattern as the first hybrid candidate (EVA-137 recorded follow-up).

**Intent:** Emphasis on Y by contrast with an X nobody proposed. Plain: `state Y once`, `if X is a real alternative, say who prefers it and why`.

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: The fix is not fast, but correct.
```
```text
after:  The fix is correct and slower.
```

```text
before: We optimize not speed but correctness.
```
```text
after:  We optimize correctness first.
```

**When not to fix:**

- A genuine correction of a stated misreading (`not blue, but green` answering `is it blue?`) — the contrast carries information.
- Provisional + info: leads only; a passing document stays byte-identical.

**Acceptable use:** Real corrections stay; the tic is the contrast with no prior claim to correct. `<!-- humanizer-allow: negative-parallelism-bare answering the reviewer's misreading -->`.

**Sequences:**

- `["not", {pos=ADJ|ADV}, {text="," optional}, "but", {pos=ADJ|ADV}]`
- `["not", {pos=NOUN}, {text="," optional}, "but", {pos=NOUN}]`
- `["not", {pos=VERB}, {text="," optional}, "but", {pos=VERB}]`

**Provenance:** Wikipedia signs-of-AI-writing (negative parallelisms) generalized per docs/research/writing-quality/pos-sequences-for-slop-detection.md (EVA-137). License: MIT (own implementation); Wikipedia text CC BY-SA (taxonomy only). Evidence: anecdotal; calibrated 2026-08-22. The POS form is unmeasured on its own; it rides the measured regex family's evidence by construction and earns its tier through the sweep.

**Suppress:**

- `settings: tools.humanizer.rules["negative-parallelism-bare"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: negative-parallelism-bare(term, term) why this use is legitimate -->`

## `engineering-metaphor`

- Tier: info (provisional) — hybrid (token sequence: literal + regex + POS)
- Message: `Engineering metaphor on an abstract subject — say the plain thing`
- Governance: PROVISIONAL since 2026-08-22 — promote when: a paired-corpus measurement shows elevation after suppressing domain-correct contexts, plus three house sweeps without a false-positive report. Warn is the ceiling.

**What:** The successor register's engineering-metaphor cluster applied to abstract subjects: `a load-bearing claim`, `the seam between intent and execution`, `the spine of the argument`, `the blast radius of a decision`, `guardrails around tone`. Plus the bare Tier-3 terms no other family counts: `estate`, `plumbing`, `sharp edges`, `yak shaving`. Single hits are info leads. A construction hit reports at warn when its own 1000-word window (500 words either side) holds three distinct CONSTRUCTION keys; warn is this provisional rule's ceiling. The bare terms never escalate (house-endemic in their domain senses, per the calibration sweep).

**Why it reads as machine register:** Assistant prose borrows engineering shorthand to label abstract dependencies, boundaries, risks, and controls. The same words on domain nouns (`a load-bearing wall`, `an API seam`, `an incident's blast radius`) are ordinary English, which the neighborhood and exclusion guards protect.

**Intent:** Criticality, a boundary, a central structure, failure scope, or a constraint — compressed into a vivid label. Plain: `critical`, `boundary`, `backbone`, `failure scope`, `limits`.

| term | indicates | plain |
| --- | --- | --- |
| `load-bearing` | critical dependency | `critical`, `essential`, `a dependency`, `must not be removed` |
| `seam` | a boundary or junction | `boundary`, `interface`, `join`, `transition` |
| `spine` | the central organizing line | `backbone`, `main thread`, `outline` |
| `blast radius` | the scope of damage if it fails | `failure scope`, `impact`, `affected area` |
| `guardrails` | constraints that prevent bad outcomes | `limits`, `rules`, `checks`, `constraints` |
| `estate` | the managed set of assets or obligations | `portfolio`, `set`, `inventory`, `systems` |
| `plumbing` | hidden enabling work | `infrastructure`, `wiring`, `integration work` |
| `sharp edges` | usability hazards or surprising failure modes | `rough spots`, `gotchas`, `risks` |
| `yak shaving` | preparatory subwork that distracts from the task | `setup detour`, `side task`, `unnecessary prerequisite` |

**Examples** (before fires, after is clean — replayed by the doctest suite):

```text
before: That is a load-bearing claim in the narrative.
```
```text
after:  That claim carries the whole narrative; drop it and the argument fails.
```

```text
before: The seam between intent and execution is wide.
```
```text
after:  The gap between what we intend and what we do is wide.
```

```text
before: Add guardrails around tone before the launch.
```
```text
after:  Add rules about tone before the launch.
```

```text
before: The estate of obligations keeps growing.
```
```text
after:  The portfolio of obligations keeps growing.
```

_the guards (`real estate` exclusion, PROPN-adjacent `Hoffman Estates`, the domain neighborhood) are exercised by tokens.test.ts, not by a rewrite pair_

**When not to fix:**

- Metaphor + domain noun: `load-bearing wall`, `test seam`, `incident blast radius`, `data estate`, literal `plumbing` — the guards already keep most of it quiet; a remaining domain use takes a term-scoped allow.
- Provisional: single hits are info leads for the agent-judge pass; only a window with three distinct construction keys reaches warn. A passing document stays byte-identical.

**Acceptable use:** Domain uses are the acceptable use, and the guards below are their machine-checkable half. That is the EVA-137 CITATION_IDIOM_VERBS recipe generalized: sweep the human baseline, turn false-positive contexts into allowlist patterns. Anything the guards miss: `<!-- humanizer-allow: engineering-metaphor(estate) the IT estate inventory -->`.

Exclusion patterns (a hit overlapping one is dropped):

- `["real", {lemma=estate}]`
- `[{lemma=estate}, {lemma=sale}]`
- `[{lemma=estate}, {lemma=agent}]`
- `[{lemma=estate}, {lemma=tax}]`
- `[{lemma=estate}, {lemma=planning}]`
- `[{pos=PROPN}, {lemma=estate}]`
- `[{lemma=estate}, "of", {pos=PROPN}]`

Domain neighborhood (sequences 7 only): any of 17 lemma(s) within ±5 tokens silences a hit — `real`, `sale`, `agent`, `tax`, `planning`, `plan`, `housing`, `council`, `industrial`, `executor`, `inheritance`, `probate`, `heir`, `acre`, `manor`, `country`, `fourth`.

Domain neighborhood (sequences 8 only): any of 18 lemma(s) within ±5 tokens silences a hit — `git`, `porcelain`, `pipe`, `water`, `bathroom`, `kitchen`, `sink`, `toilet`, `leak`, `drain`, `plumber`, `fixture`, `faucet`, `tap`, `heater`, `sewer`, `valve`, `boiler`.

Domain neighborhood (sequences 9 only): any of 16 lemma(s) within ±5 tokens silences a hit — `blade`, `knife`, `metal`, `glass`, `table`, `corner`, `cut`, `deburr`, `machining`, `paper`, `steel`, `aluminium`, `aluminum`, `plastic`, `wood`, `tool`.

**Sequences:**

- `["load-bearing", {lemma=[31] pos=NOUN}]`
- `[{lemma=seam}, "between", {pos=DET optional}, {lemma=[20]}]`
- `["spine", "of", {pos=DET optional}, {lemma=[31]}]`
- `["blast", "radius", "of", {pos=DET optional}, {lemma=[31]}]`
- `[{lemma=guardrail}, {text="around"}, {pos=DET optional}, {lemma=[15]}]`
- `[{lemma=guardrail}, {text="for"}, {pos=DET optional}, {lemma=[15]}]`
- `[{lemma=estate pos=NOUN}]`
- `[{lemma=plumbing pos=NOUN}]`
- `["sharp", {lemma=edge}]`
- `[{regex=/^yak$/}, {text="-" optional}, {regex=/^shav(?:e|es|ed|ing)$/}]`

Cluster escalation: 3+ distinct cluster keys inside a 1000-word window report at `warn` — sequences 1, 2, 3, 4, 5, 6 only; the rest are leads that never escalate.

Cluster keys (one per sequence): `load-bearing`, `seam`, `spine`, `blast radius`, `guardrails`, `guardrails`, `estate`, `plumbing`, `sharp edges`, `yak shaving`.

**Provenance:** docs/research/writing-quality/overindexed-ai-vocabulary.md (2026-08-22): Šuppa transcript audit and Claude Code issue 53454 for `load-bearing` (semi-measured); MCP.Directory Claude-jargon roundup for the rest (anecdotal). Density-window design from slop-lint (MIT). License: MIT (own implementation); term catalog as facts; GPTZero/Copyleaks lists cite-only, never vendored. Evidence: anecdotal; calibrated 2026-08-22. Tier 3 by the report's own tiering; promotion needs the paired-corpus measurement the report recipes (200–500 prompts, log-odds vs a domain-matched human baseline).

**Suppress:**

- `settings: tools.humanizer.rules["engineering-metaphor"] = { severity: "off" | "info" | "warn" | "error" }`
- `inline: <!-- humanizer-allow: engineering-metaphor(term, term) why this use is legitimate -->`
