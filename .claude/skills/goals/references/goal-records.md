# Goal records: draft-commit policy, committed vs machine-local, worktrees

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

## Draft-phase commit policy (EVA-62)

Creating a draft creates a branch named after the draft folder (e.g.
`draft/YYYYMMDD-HHmmSS-{goal-slug}`) **born directly into its own
worktree** — the primary checkout never leaves main. Whether the DRAFT
PHASE also commits is the `goals.drafts.commit` setting (EVA-62),
**default `false`**:

- **Local mode (the default)**: nothing is committed or pushed during
  drafting — intake, grilling, and GOAL.md edits are plain files in the
  worktree, and the branch keeps pointing at its start point. Files are
  crash-durable on disk; what is given up is git-level undo and any
  remote copy (see the abandonment warning under Worktree layout). At
  promotion the whole folder enters history as **one promotion-capture
  commit**, behind the **intake review gate** (lifecycle step 3).
- **Commit mode** (`goals.drafts.commit: true` in the layered settings):
  the pre-EVA-62 behavior wholesale — the scaffold is committed and
  pushed at creation and drafting-phase edits are committed to the
  branch as they land, inside the worktree.
- **Per-draft escape (both directions)**: `goals draft --push` (the
  `push: true` option on `startDraft`/`captureIntake`) commits+pushes
  ONE draft while others stay local, and `evie-kit goals share`
  (`pushDraft`) later shares an existing local draft — one commit of
  the folder, branch pushed with upstream, behind the intake review
  gate (`--intake-reviewed` after the scan, lifecycle step 3). Under
  commit mode, `goals draft --no-push` (`push: false`) keeps one
  draft local.

## Committed vs machine-local (EVA-59)

Git stays the system of record for goals — commit-pinned tracker
permalinks, lock immutability, executors and blind reviewers reading
files from disk, and survival across worktrees/machines/fresh clones all
depend on it — but the record is split into a **committed skeleton** and
**machine-local ephemera** so goal records stop drowning out the code in
PR diffs:

- **Committed** (the durable skeleton): `GOAL.md`, `references/`,
  `grilling/` (decision provenance — promotion permalinks point into
  transcripts), goal-round per-engine `CRITIQUE.md` files (load-bearing:
  goal-review consensus is computed by reading them across rounds, not
  the INDEX), `reviews/*/INDEX.md`, `BRIEF.md`, `results/RESULT.md`,
  `results/GATES.md` (EVA-79 gate receipts — committed BEFORE the
  review wave, since reviewer worktrees are cut from HEAD),
  and — on mapped goals — `wayfinder/` (`MAP.md` + its references: the
  rolled-forward map is exactly the state that must survive worktrees
  and fresh clones).
- **Machine-local** (gitignored raw dumps, `goals/.gitignore` — written
  by `evie-kit setup`/`upgrade`, same ownership as the EVA-41
  `handoffs/` rule): `adhd/` session folders and results-wave per-tool
  output dirs (`reviews/results-NNN/<tool>/` — FINDINGS.md, screens,
  completion markers). The wave INDEX's merged-findings section is the
  durable record of a wave; its per-tool FINDINGS.md links resolve only
  on the machine that ran it, and only until the goal worktree is
  reaped (merge cleanup deletes ignored files with the tree) — so a
  wave MUST be reconciled into its INDEX before the goal locks, while
  the raw output still exists.

FORWARD-ONLY: gitignore never affects tracked files, so everything
committed in pre-EVA-59 goals (and the permalinks into it) stays as it
is. On top of this, the repo's `.gitattributes` marks `goals/**`
`linguist-generated` so what IS committed renders collapsed in PR diffs
(expand on demand) — with `GOAL.md` and `RESULT.md` kept expanded: the
spec and the outcome are reviewable content. The `.gitattributes` layer
is REPO-LOCAL: `evie-kit setup`/`upgrade` distribute only the
gitignore rules (per the EVA-59 spec), so a consumer repo wanting the
collapse adds the three lines to its own `.gitattributes`:

```gitattributes
goals/** linguist-generated=true
goals/**/GOAL.md linguist-generated=false
goals/**/RESULT.md linguist-generated=false
```

## Worktree layout (path-mirror invariant)

Every goal lives in exactly one worktree across its whole life, and at
every lifecycle stage the worktree path is `.worktrees/` + the goal
folder's path relative to `goals/`:

```
.worktrees/
  drafts/
    YYYYMMDD-HHmmSS-{slug}/   # draft — mirrors goals/drafts/<ts>-<slug>/
  ABC-NNN-{slug}/             # promoted onward — mirrors goals/ABC-NNN-<slug>/
```

`ls .worktrees/drafts/` **is the draft backlog surface**: every active
draft sits there with its full GOAL.md on disk (there is deliberately no
separate index file to keep in sync); undrafted candidates stay in locked
goals' RESULT follow-up sections. Worktrees are LOCAL state — they exist
on the machine that created them, not in git. `goals list` marks drafts
with no LOCAL RECORD of a remote copy as **local-only** (EVA-62). The
read is last-push/fetch knowledge, never the network — a remote branch
deleted elsewhere keeps its stale tracking ref until a pruning fetch,
so an UNMARKED draft is not proof a remote copy still exists.

**Lifecycle end — remove on merge**: a goal's worktree is removed once
its branch is merged to main (`removeMergedGoalWorktree`) — locked +
merged means everything in it is reachable from main and the worktree is
dead weight. Hard guard: **never remove a worktree whose branch is not
an ancestor of main**; removal is non-force, so git refuses a dirty
tree. An abandoned draft's worktree goes when its branch is deleted
(manual, deliberate). **Under the default `goals.drafts.commit: false`
policy this loses the draft ENTIRELY** (EVA-62): a local-only draft has
no commits and no remote copy — the worktree's plain files ARE the
draft, and nothing anywhere can restore them once the worktree and
branch are gone. Check `goals list` for the `local-only` marker (or
`goals context`) before deleting — and because the marker reads only
local refs, run a pruning fetch (`git fetch --prune`) or check the
remote directly before trusting its ABSENCE; `evie-kit goals share`
first if the idea might be worth keeping. Abandoning a goal whose
waves ran sonar
also means deleting its ephemeral `<projectKey>-<branch>` sonar project
(`deleteSonarBranchProject`), which otherwise accumulates on the
server; merge cleanup handles this automatically only for merged
goals.
