# Stacked goals (building on an unmerged parent)

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

When a goal depends on another goal's still-unmerged branch — in team
repos a PR can wait on human review for days — the dependent work does
NOT stall: draft it **stacked on the parent branch** instead of main
(EVA-18). The never-squash convention is what makes this cheap: because
goal branches land as **true merge commits**, a child branched from its
parent needs **zero restacking when the parent merges** — the parent's
commit hashes stay reachable from main, the child's diff-to-main
collapses to its own commits, and Linear permalinks survive untouched.
(Deep-stacking tools like Graphite earn their keep in squash-merge
workflows, where every parent merge rewrites history under the child;
we deleted that problem by convention — an explicit non-goal, revisit
only if stacks become the norm rather than occasional and shallow.)

The mechanics are level-invariant — a grandchild stacks on a child the
same way; there is no artificial depth cap. Absent `stacked_on`, every
path below behaves byte-identically to the main-based flow.

- **Draft**: pass `stackedOn: "<parent-branch>"` to `startDraft` — the
  draft is born FROM the parent branch (the primary checkout still
  never leaves main) and `stacked_on: <parent>` is recorded in the
  frontmatter. Everything stacking-aware reads that one key. The parent
  must be a **promoted** goal branch (`ABC-NNN-slug`) — `startDraft`
  refuses anything else, because promoting a parent RENAMES its draft
  branch (and deletes the old remote name), which would orphan every
  child's `stacked_on`; promote the parent first.
- **The environment builder rides the branch**: a stacked child's
  launch reads its OWN worktree's committed `settings.ts`, which
  includes the parent's unmerged changes — so a `buildWorktree` member
  the parent introduced or modified is already in force for the child.
  No per-goal declaration exists to carry forward (EVA-24 removed the
  `resources:` ledger).
- **Promotion**: the pre-flight rebase and the hard guard both use the
  parent as base automatically (lifecycle step 3). `promoteGoal` hands
  the driver `stackedOn` (parent branch + issue key) in the
  `createIssue` context — record the **Linear blocked-by relation** to
  the parent's issue there, so the stack is visible on the board.
- **Review waves diff against the parent**: a stacked goal's wave
  must judge only its OWN commits — `git diff <parent>...HEAD` — never
  re-review the parent's diff. Driver-level, two knobs: the
  `changeSpec` names the parent as BASE, and `CodeRabbitReviewer` gets
  `base: <parent>`. Derive BASE from the goal's own frontmatter
  (`stacked_on` ?? `main`) so a copied driver stays correct — EVA-18's
  committed driver is the reference. SonarQube needs nothing: its
  per-branch ephemeral projects already scan the child's whole tree.
- **Merge choreography** (the orchestrator's contract, extending the
  serialized-merges rule): the stack lands **parent-first**, walking
  the `stacked_on` chain at any depth. After the parent's true merge,
  the child PR simply **retargets to main** (`gh pr edit --base main`)
  — its diff is already correct, **no rebase**. The one case that DOES
  rebase: the parent's branch is revised BEFORE its merge (review
  feedback, force-with-lease push) — the child then rebases onto the
  updated parent (`rebaseGoalOntoBase`, same conflict-resolution flow
  as the promotion pre-flight). Two caveats on that catch-up rebase:
  the target is the LOCAL parent ref, so freshen it first (`git pull
--ff-only` in the parent's own worktree — the parent branch is
  checked out there, so a `fetch <parent>:<parent>` refspec is
  refused); and once the child has PROMOTED, rebasing rewrites commits
  its issue already pinned — the old hashes survive only as
  forge-served dangling SHAs, not reachable-from-main history. Prefer
  landing a parent unrevised once children have promoted; revising it
  anyway is an accept-the-permalink-cost call, made knowingly.
- **Cleanup refuses stack-aware**: `removeMergedGoalWorktree`'s
  not-ancestor-of-main guard is unchanged, but for a stacked goal the
  refusal names the unmerged parent and says the stack must land first
  — "merge this branch" alone would point at the wrong next action.
