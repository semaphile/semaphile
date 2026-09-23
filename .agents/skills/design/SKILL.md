---
name: design
description: >-
  Design as a first-class part of the goal lifecycle (EVA-229): three
  layers — upfront design decisions, design gates inside goals, and the
  method — over a verified, pinned impeccable instrument and a ported
  intent protocol, with attribution to both upstreams. Use when the user
  asks what the design skill does or which layers exist yet, wants to
  verify or repair the design instrument on this machine ("is impeccable
  set up?", "design doctor"), or asks how the pinned impeccable release
  is selected and verified. Step 1A ships the instrument and this shell;
  the review lanes, onboarding, preview and gates arrive in later steps
  and this skill says so rather than pretending they exist.
argument-hint: "[doctor | acquire | explain | identity]"
---

# Design

Design enters the lifecycle in three layers. This skill is the door to
all three; in this release only the third layer's foundation exists.

1. **Upfront design decisions** — one durable design record per
   project, written by a design onboarding GOAL that merges impeccable's
   `init`/`shape` interviews with intent's context-gathering protocol.
   Not yet available (map ticket "Design onboarding as a goal").
2. **Design gates inside goals** — audit and critique as green gates
   scoped to what a goal changed, with out-of-scope observations reaching
   the orchestrator or planner as advisories. Not yet available (map
   ticket "Design gates in goals").
3. **The method** — impeccable's craft method through its pinned CLI and
   engine, looked at through agent-browser; intent's purpose method,
   ported with attribution. Step 1A (this release) ships the VERIFIED
   PINNED INSTRUMENT; step 1B moves the `impeccable` and
   `impeccable-detect` review lanes onto it.

Attribution: `references/attribution.md`. The craft method is
[impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus
(Apache-2.0), called by pinned version and never re-implemented. The
purpose method is [intent](https://github.com/ghaida/intent) by ghaida
(CC0-1.0), ported in a later step. Say both whenever you explain what
this skill is.

Zero-ambiguity invocation when the bin might not be linked:
`bun node_modules/@evie-kit/cli/src/evie-kit.ts design doctor`

**Toolchain guard (EVA-81)**: module-not-found on that path means the
machine's bootstrap has not run — not a broken repo. Run it once BY
PATH: `bun /path/to/evie-kit/packages/cli/src/evie-kit.ts onboard`
(`EVIE-KIT.md` at the project root has the full bootstrap).

## What is available now (step 1A)

- **The committed expected identity**, `.evie-kit/design/instrument.json`:
  the impeccable release this project verifies against. It names the CLI
  package version and launcher digest, the engine version with a
  per-platform binary digest, and the playbook closure as a per-file
  manifest with its aggregate digest. `evie-kit setup` places it as a
  managed file, because evie-kit selects the release at its own cadence.
  ADR 0024 is the contract.
- **The pin**: `"npm:impeccable" = "<cli version>"` in the project's
  mise config, beside the bun pin. Setup adds it when absent and never
  rewrites a project-owned pin; a conflicting version is a failed row
  with its cure.
- **The verified store**, `~/.evie-kit/assets/<name>/<version>/…`: setup
  acquires the engine (this platform) and the playbook closure into it,
  digest-verified and atomically published. Downloading is an install
  decision: an interactive setup asks, a headless one needs
  `--design-assets` and otherwise reports the row skipped with the cure.
  A corrupt entry refuses and is never re-blessed. The cure is a hand
  removal of the named directory and a fresh acquisition.
- **The verbs**:

```bash
evie-kit design doctor [--json] [--root <dir>]     # read-only readiness; never downloads
evie-kit design acquire [--dry-run] [--offline] [--json] [--root <dir>]
evie-kit design explain [--root <dir>]             # the three layers + attribution
evie-kit design identity [--json] [--root <dir>]   # the committed release, one line
```

`doctor` exits 0 when every row is ok, 1 when a row failed, and 2 when a
row was skipped. A skipped row is unverified, never green: mise absent,
for example, leaves the pin inert and the CLI row unjudged. The CLI row
verifies the installed launcher's bytes against the committed digest
before it runs the shim.

## What /design does in a session

- **Asked what it is, or bare `/design`**: explain the three layers,
  what step 1A ships and what later steps add, and credit both
  upstreams. `evie-kit design explain` prints the same facts.
- **Asked whether the instrument is ready**: run `evie-kit design
doctor` and report its rows verbatim: the identity line, the engine's
  sha256 prefix, the closure prefix and the exit code as printed. A
  paraphrase like "digest verified" drops the value the user compares
  against the committed identity. Every failed row carries its cure;
  relay the cure, do not improvise one.
- **The instrument is absent** (doctor's identity row fails, or the
  project has no `.evie-kit/design/instrument.json`): say so and point at
  `evie-kit setup`. Do NOT claim any design review ran; nothing can run
  without the verified instrument.
- **Asked to acquire or repair**: `evie-kit design acquire` needs the
  network on a cold machine; offline it reports the asset unavailable
  with the cure and publishes nothing partial. A corrupt store entry is
  named with its removal cure; never delete it silently.
- **Asked for an audit, critique, or design gate**: not yet — these
  arrive with steps 1B and later. Until then the project's existing
  `impeccable` lanes (the vendored tree, where a project still carries
  one) are unchanged.

## Scope note

This step changes nothing in the review lanes, the vendored
`.claude/skills/impeccable/` tree, or `docs/vendored/impeccable/`;
those move in step 1B. Live variant mode under agent-browser is its own
map ticket and is outside every step's acceptance.
