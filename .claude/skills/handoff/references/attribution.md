# Attribution

Primary source: [REMvisual/claude-handoff](https://github.com/REMvisual/claude-handoff)
(`skills/handoff`, `skills/handoffplan`, `hooks/precompact-handoff.sh`) — a
notably more rigorous handoff design than the alternative found in
[mattpocock/skills](https://github.com/mattpocock/skills), which has two
much thinner variants: `skills/productivity/handoff` (writes a file to the OS
temp dir, no chain tracking) and `skills/in-progress/claude-handoff` (spawns
a fresh background `claude --bg` agent seeded with a summary — a different,
simpler shape we did not adopt here).

## What we changed from REMvisual's version

- **Dropped the "beads" dependency entirely.** REMvisual's version assumes a
  `bd` CLI (an issue/task tracker) for chain resolution, claiming tickets,
  and a `bd remember` memory-persistence call. evie-kit has no such tool;
  chain tracking here is keyed off goal/loop-folder slugs (from the
  goals-workflow design and `@evie-kit/coding-agent`'s `loopFolder`
  convention) instead of ticket IDs.
- **Handoffs live in ONE runtime-managed, gitignored directory** —
  `.evie-kit/handoffs/` — rather than upstream's committed-by-default
  `plans/handoffs/`. Upstream states no policy on committing vs
  ignoring (verified 2026-07-28: no `.gitignore` guidance, no
  ephemeral-vs-durable statement), so there was no upstream position to
  defer to; EVA-41 settled it. An earlier evie-kit divergence put the
  handoff in the active goal/loop folder with a `.claude/handoffs/`
  fallback — RETIRED: that location only paid off if handoffs were
  COMMITTED, and once they are ignored it merely scatters machine-local
  ephemera through the durable record. Locked goals still containing a
  `handoffs/` folder are legacy history, not the current rule.
- **Folded `handoffplan` into `handoff` as a mode** rather than keeping it a
  separate skill, since it's the same mining process with a different
  ending (plan + commit + close vs. just capture).
- **The PreCompact hook** — upstream's `hooks/precompact-handoff.sh`,
  which we reimplemented as `packages/handoff/src/precompact-handoff.ts`
  (no `hooks/` directory exists here) — is retargeted the
  same way — no beads, writes to the same single `.evie-kit/handoffs/`
  directory (it still finds the most-recently-modified goal/loop folder,
  but only to REPORT which unit of work was active), and is explicitly
  labeled as a _safety net_ (filesystem/git state only) rather than a
  substitute for the full mining pass this skill does when invoked
  deliberately.
- Line-budget and split thresholds kept as REMvisual specified (they're
  reasonable defaults, not evie-kit-specific), noted in
  `references/validation.md`.
