<!-- Starter default placed by `evie-kit setup` (EVA-140). This file is
     YOURS: edit it to your project's conventions — setup never rewrites
     it. Prose guidance, with ONE machine-stamped family: the goal-type
     label group (EVA-145) the tracker sync writes at promotion — and
     THIS FILE'S PRESENCE arms that stamp (no file, no stamp, nothing
     minted in the tracker); delete it to opt out. No lint reads the
     prose. -->

# Labels

How this project uses tracker labels. If it doesn't, say so here —
an explicit "we run label-free" beats an undefined vocabulary.

## The goal-type label group

Every goal's `type:` (`feat | bug | docs | research | chore`; absent
means `feat`) is stamped on its issue at promotion while this file
exists — on Linear as a child of the `Type` label group
(`tools.tracker.linear.typeLabelGroup` renames it, `null` turns the
stamp off; the group and its children are created, team-scoped and
described, when missing — a workspace or parent-team group is reused
only when it already carries the label; best-effort — a label the key
cannot create warns, never strands the promotion), on GitHub as a
plain label the repo must already define. Labels are Title Case, the
Linear standard (`Feature / Bug / Docs / Research / Chore`); type ids
stay lowercase — the explicit id→label mapping in settings carries
the difference. The frontmatter is the source of truth; the
label is its mirror. The vocabulary and each type's label name live
in settings (`conventions.goalTypes`). A `setup --linear <team>
--smoke-tests` run materializes the whole vocabulary up-front and
reports orphaned labels in the group (labels no type names) — it
never deletes one; the team owns its taxonomy. On a project's very
FIRST setup the sweep waits one run: a labels.md this same run
scaffolded does not arm it — review and commit the starter, then
re-run `setup --linear <team> --smoke-tests`.

**Migrating a pre-Title-Case team (Linear):** the same sweep is the
migration — it RENAMES the team's own legacy children in place
(`feat → Feature`; the id is preserved, so stamped issues keep
their labels) and recases an owned lowercase group, instead of
minting duplicates beside them; the orphan report then names any
leftovers. Promotion converges too — the type id rides the stamp as
the label's legacy spelling, so a promotion made before any sweep
renames instead of duplicating. A bare `upgrade` does not sweep —
the sweep rides the `--smoke-tests` flag. Inherited (workspace/parent-team) groups are never
mutated. On GitHub there is no rename to ride: define the new label
names in the repo and retitle the old ones by hand — a label the
repo does not define simply stops being applied.

## Everything else

- **Don't reach for a label where an existing axis carries the fact**:
  work type is the `Type` group, state the workflow column,
  real-vs-sandbox the project split.
- **Labels are for cross-cutting facets those axes can't express.**
  Define the label with a description before first use.
- **Agents never invent labels**: applying an existing described label
  is fine; creating one is a human decision (in the tracker, or in
  settings for the type group), recorded here.
