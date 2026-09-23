<!-- Starter default placed by `evie-kit setup` (EVA-140). This file is
     YOURS: edit it to your project's conventions — setup never rewrites
     it. Its PRESENCE arms the matching lifecycle lint; delete it (or
     rename branch-naming.md) to opt out. -->

# Branch naming

The goals workflow owns goal-branch naming. The goal FOLDER
(`goals/{ISSUE-KEY}-{slug}/`) is the goal's identity; the BRANCH is a
policy (EVA-206): the goal record's `identity:` mapping says which
branch a goal lives on, and promotion FIXES that branch — rendered once
from the settings `branchNaming.template` with the real issue key,
confirmed under `mode: "ask"`, or given as `--branch` — and nothing
renames it afterwards (a retry, a settings change, or an adoption never
re-renders identity). Why the earlier one-identity rule was kept as the
DEFAULT: a goal's type is often wrong at draft time, so a type prefix
typed per goal was rejected; adoption depends on one never-renamed
branch per goal. Both hold under the policy — the prefix comes from the
project's standards through the template, and the branch is chosen
once.

- `draft/YYYYMMDD-HHmmSS-{slug}` — created with the draft.
- `{ISSUE-KEY}-{slug}` — the DEFAULT name the draft branch is renamed
  to at promotion (the goal folder name); carries execution. A project
  whose settings declare `branchNaming.template` renders its own
  grammar instead (e.g. `feature/{ISSUE-KEY}-{slug}` from a
  type-keyed prefix map); `evie-kit setup` seeds that template from
  the repository's branch history.
- Goal branches merge with **real merge commits, never squash** — the
  commit hashes baked into tracker permalinks must stay reachable.

The slug derives from the issue title: lowercase alphanumeric words
joined with SINGLE hyphens, kept ≤ ~30 characters (tune via
`conventions.branch.slugSoftMax`; over it warns), cut at word
boundaries. It names the folder (and, by default, the branch); a
`{type}/` prefix belongs in the template, never in the slug. The
grammar is a hard check at the lifecycle seams: a doubled inner hyphen
refuses without `--ignore-branch-naming '<reason>'`, while uppercase,
underscores, and leading/trailing hyphens are PATH-INVALID (the slug
becomes folder and session names) and refuse without any waiver. The
target BRANCH is validated separately as git ref text.

A goal on a branch that carries no issue key is not autolinked by the
tracker; `evie-kit goals tracker pr-link <KEY>` attaches the PR URL to
the issue instead (`goals merge` tries it best-effort).

For rare non-goal branches (hotfixes, tooling):
`{type}/{ISSUE-KEY}-{short-slug}`.
