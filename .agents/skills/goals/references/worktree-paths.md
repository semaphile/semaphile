# What happens to each path when a worktree is built

Two surfaces decide what ends up in a goal worktree, and they are easy
to confuse because both speak gitignore-ish patterns and one of them has
a verb called `ignore` sitting next to a member called `exclude`. This
page is the single table that keeps them straight — the documentation
obligation EVA-96's decision 7 took on when it refused to fold checkout
excludes into `baseFiles`.

The one-sentence version:

- **`baseFiles`** (EVA-63) decides what happens to **untracked** content
  the primary checkout has and a fresh worktree would not — copied,
  symlinked, or left behind. It is a provision-time **file operation**.
- **`checkout.exclude`** (EVA-96) decides which **tracked** content the
  worktree materializes at all. It is persistent **git sparse state**.

They never contend, because they act on disjoint sets: a path is either
tracked by git or it is not.

## The table

| The path is…                                                                                          | Decided by                                 | Default                                 | How to change it                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- | ------------------------------------------------------- |
| **tracked**, anywhere                                                                                 | the checkout profile                       | materialized                            | `checkout: { exclude: ["…"] }`, `.checkoutignore`       |
| **tracked**, matched by a checkout exclude                                                            | the checkout profile                       | **not materialized**                    | `!`-negate it in `.checkoutignore.worktree`             |
| **tracked**, under `goals/<another goal>/`                                                            | the checkout profile's active-goal scoping | **not materialized**                    | not overridable — read it with `goals read <KEY>`       |
| **tracked**, under `goals/<active goal>/` or an ancestor                                              | the checkout profile's active-goal scoping | materialized                            | n/a (this is the invariant)                             |
| **tracked**, loose under `goals/` (e.g. a README)                                                     | nothing — scoping hides goal FOLDERS       | materialized                            | a checkout exclude, if you really want it gone          |
| **untracked** in the primary, matched by a copy rule                                                  | `baseFiles` / `worktree.copy.*`            | copied                                  | `baseFiles: { "path": "ignore" }`                       |
| **untracked** in the primary, `symlink` rule                                                          | `baseFiles`                                | symlinked (subtree is opaque)           | narrow the symlink root                                 |
| **untracked**, engine-generated (`.envrc.worktree`)                                                   | the provisioning engine                    | rebuilt every pass                      | `envVars` — no rule may target the file itself          |
| **untracked**, checkout-generated (`goals/EXCLUDED.md`, `.checkoutignore.worktree`, `.goal-imports/`) | the checkout profile                       | created, and shielded from `git status` | `goals unsparse` removes the tombstone with the profile |

## Why they are separate members, in one paragraph

`baseFiles` verbs run once, at provisioning, and their grammar is the
copy engine's validated glob subset (no `**`). Checkout excludes are
persistent git state with a lifecycle of their own — reapply, converge,
unsparse, per-worktree `!` negation, generations — and their grammar is
git's own, so `**` and character classes work. Folding them together
would have put `exclude` (do not check out a tracked file) next to
`ignore` (do not copy an untracked file) in one map, where they read as
synonyms and mean opposite things. The `worktrees()` unknown-member
refusal for a bare `exclude` names both, for exactly this reason.

## Precedence inside the checkout axis

Carriers compose like nested `.gitignore` files — concatenated in this
order, last match wins, so a later carrier **refines** an earlier one
rather than replacing it:

1. `worktrees().checkout.exclude` in settings (committed layer, then the
   machine-local layer's, appended);
2. the repo-level `.checkoutignore` (tracked, read from the TREE);
3. the per-worktree `.checkoutignore.worktree` (untracked, read from
   disk — this is the one a human or agent edits mid-goal).

Then, after all of them, the active-goal scoping lines. Being last is
what makes `goals/` scoping unoverridable: an override that tries to
re-include the whole corpus is emitted, and then loses.

## The verbs

```
evie-kit goals unsparse [<ABC-NNN>]   # PANIC: restore a COMPLETE checkout. Idempotent.
evie-kit goals read <ABC-NNN>         # stage a prior goal read-only into .goal-imports/
```

`unsparse` is named in every sparse-related error this feature produces,
because the operator usually meets the feature as "a file I expected is
missing".

## Degrade behavior

Every error — unparseable frontmatter, a broken `stacked_on` chain, an
invalid pattern, a sentinel mismatch after applying — produces a
**COMPLETE checkout with one warning line**. The degrade direction is
always toward more files, never fewer, and it is never partial. Sparse
checkout can misapply silently (a pattern matching nothing is not an
error), so every application is verified against the profile's own
sentinels rather than trusted.

## Generations

Profiles apply to **newly provisioned worktrees only**. A worktree that
predates the feature carries no stamp and stays fat forever; a worktree
stamped with an older generation is left alone. Files must never vanish
under a running executor, and a fat worktree is valid — the remedy is
re-provisioning, never patching.

## Reviewer worktrees: what blindness does and does not buy

A reviewer worktree runs the same profile with the REVIEWED goal as the
active one. That goal's folder is materialized — the reviewer prompt
points at its `GOAL.md`, so it has to be readable — while every other
goal's record is physically absent. The wave preflight FAILS on a
materialized foreign record or a non-empty `.goal-imports/`, counting
every entry including a bare `LEDGER.jsonl`, and it fails CLOSED: a
reviewer worktree whose profile did not apply is a wave failure, not a
pass.

What it does NOT close: prior rounds of the goal being reviewed live
inside that goal's own folder and come with it. Excluding its `results/`
and `reviews/` subtrees would close that physically (one rule after the
include line, last match wins) and is a recorded follow-up, not a silent
addition — grilled decision 4 says reviewers get the same profile. Nor
is any of it a sandbox: `git log` / `git show` still reach everything
the profile hid.

## Known limit: hooks under a guarded executor

Per-worktree `post-merge` / `post-checkout` / `post-rewrite` hooks
re-converge the profile after bare git operations, and they chain
through to whatever hook they shadow. But `GIT_CONFIG_COUNT` /
`GIT_CONFIG_KEY_n` environment overrides outrank every config file
scope, and an executor launched behind the EVA-33 git mistake guard runs
with exactly such an override. Inside a guarded session the hooks do not
fire — which is correct (the guard must not be shadowable), and it is
why `convergeWorktree` at the goals-verb seam, not the hooks, is the
primary healing path.
