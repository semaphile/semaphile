# Attribution and lineage

The vetted skill merges seven sources plus two of the user's
field-tested copies. Every source that contributed EXPRESSION is
MIT-licensed and reimplemented rather than copied wholesale;
Wikipedia's guide text is CC BY-SA, so the skill paraphrases its
taxonomy and links the original rather than reproducing its prose or
tables; and ClaudeFire — which carries NO license — contributed only
its term catalog as facts, never prose (see the caveat section
below).

| source                                                                                                                                                                               | what we took                                                                                                                                                                                                                                                                                                                | commit (at vetting, 2026-08-04)                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) + [cleanup guide](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup/Guide) | the core taxonomy; the counts-are-leads caution that shapes the whole lint contract                                                                                                                                                                                                                                         | n/a (retrieved 2026-08)                                                    |
| [blader/humanizer](https://github.com/blader/humanizer) (MIT)                                                                                                                        | the 27-pattern base (via the user's evie-skills copy of v2.1.1); from the current 33: fabrication-check self-audit, what-NOT-to-flag guards, signposting, stakes inflation, aphorism formulas                                                                                                                               | `523374d`                                                                  |
| user's evie-skills copy (`evie-skills/skills/humanizer`)                                                                                                                             | the vetted 27-pattern baseline text this skill's core section derives from                                                                                                                                                                                                                                                  | local, May 2026                                                            |
| user's openclaw copy (`~/.openclaw/workspace/skills/humanizer`) + [tropes.fyi](https://tropes.fyi)                                                                                   | merged patterns 28–37 (dramatic countdown, self-posed Q&A, anaphora, gerund litany, manufactured punchlines, false-suspense, patronizing analogy, stakes, invented labels, fractal summaries)                                                                                                                               | local, Apr 2026                                                            |
| [Aboudjem/humanizer-skill](https://github.com/Aboudjem/humanizer-skill) (MIT)                                                                                                        | forensic tier (placeholders, citation-markup tokens, UTM params, unicode obfuscation, reasoning-chain artifacts), treadmill/trigram-repetition metric, hedged-enumeration openers                                                                                                                                           | `9a7f35b`                                                                  |
| [Humanizer Pro](https://github.com/eddyplolz/humanizer-pro) (MIT)                                                                                                                    | artifact-blocker tier design (error severity, fail-closed exit), audit-without-rewriting mode, per-doc stats block idea                                                                                                                                                                                                     | `d5905ed`                                                                  |
| [stop-slop](https://github.com/hardikpandya/stop-slop) (MIT)                                                                                                                         | false agency + narrator-from-a-distance trigger tables; windup/false-suspense phrasing                                                                                                                                                                                                                                      | `8da1f03`                                                                  |
| [sloplint](https://github.com/benjaminjackson/sloplint) (MIT)                                                                                                                        | lint DESIGN: stable rule IDs, JSON output, markdown masking, category severities, why/fix inline; the `exact-exactly` rule                                                                                                                                                                                                  | `56e2c97`                                                                  |
| [ClaudeFire](https://github.com/VideoFireAI/ClaudeFire) (**no license** — see below) + the r/ClaudeCode `seam in your spine` thread                                                  | the CC-dialect TERM CATALOG (facts, not expression) behind the `cc-dialect`/`cc-dialect-ambiguous` family; prior art for the Humanized output style (authored fresh, zero prose reuse)                                                                                                                                      | vetted 2026-08-04 (EVA-75)                                                 |
| [pstack unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md) (MIT — see below)                                                                         | "Adding soul" positive guidance (skill + panel editor lanes), the closing self-audit question, the abstract-metaphor noun family (pattern 47 + the `abstract-metaphor` lint rules), synonym-cycling as an instrument; its inline-header/title-case/em-dash bans deliberately NOT imported (SKILL.md "Recorded divergences") | `99559f2` (unslop tree) / repo main `51a96e0`, vetted 2026-08-20 (EVA-137) |

## The unslop license verification (EVA-137)

The cursor/plugins repository carries NO top-level license (GitHub
API `license: null`, checked 2026-08-20) — but each plugin directory
ships its own: `pstack/LICENSE` is MIT (Copyright (c) 2026 Lauren
Tan) and covers `pstack/skills/unslop/SKILL.md`, and the repo README
states MIT. The intake's license gate therefore PASSED: patterns and
adapted prose ride with attribution, the same footing as the other
MIT sources above. Pinned at vetting: unslop tree last touched
`99559f2` (2026-08-02), repo main at `51a96e0`.

The EVA-137 instrument tier also adopts runtime dependencies with
their own licenses, recorded where they live: wink-nlp and
wink-eng-lite-web-model (both MIT, exact-pinned in
`packages/humanizer/package.json`), and the WordNet 3.1 database via
wordnet-db (MIT wrapper; the data itself under the Princeton WordNet
license — attribution in `packages/wordnet/README.md`).

## The ClaudeFire license caveat (EVA-75)

The EVA-75 intake assumed ClaudeFire was MIT; vetting found NO
license anywhere in the repo (GitHub API `license: null`, no LICENSE
file, no README grant — checked 2026-08-04), which means
all-rights-reserved by default. Consequences, applied: only the
banned-term LIST was merged (individual words and short phrases are
unprotectable facts), every borrowed term is provenance-tagged, and
the distributed Humanized output style was written from scratch in
this repo's register with ClaudeFire as prior art only — none of its
prose, tables, or examples were reused. The full disposition table
(which terms landed in which tier and why, including the measured
"blast radius" demotion and the "surface" exclusion) is in the
EVA-75 goal record: `goals/EVA-75-cc-dialect-and-output-style/results/VETTING.md`.

## What was cut, and where the rationale lives

The opinion/generic split — per-pattern dispositions, the borderline
items surfaced to the user, the hands-on tool evaluation that set the
thresholds, and the excluded companions (TTS.md, SLACK.md, the
email-specific rules) — is recorded in the EVA-67 goal record:
`goals/EVA-67-add-humanizer-skill/results/VETTING.md` and
`results/third-party-eval.md` in the evie-kit repo. Consumers get
this skill without those records; the one-line summary is that
channel-specific and persona-derived guidance stayed home, and every
strictness rule beyond the Wikipedia family is either
provenance-tagged in the merged section or listed under Strictness
options as explicit opinion.
