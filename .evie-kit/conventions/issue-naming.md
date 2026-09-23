<!-- Starter default placed by `evie-kit setup` (EVA-140). This file is
     YOURS: edit it to your project's conventions — setup never rewrites
     it. Its PRESENCE arms the matching lifecycle lint; delete it (or
     rename issue-naming.md) to opt out. -->

# Issue naming

Rules for tracker issue titles. The countable subset (length caps,
the per-type title grammar) is enforced at the goal-lifecycle seams —
`goals draft` checks the title at capture, `goals promote` re-checks
it before the issue is created. Soft caps warn; hard-cap and grammar
violations refuse without `--ignore-issue-naming '<reason>'` (the
reason is recorded in the promotion commit and the goal record under
`conventions.ignore.issue-naming`). Every refusal prints the pattern
the goal's type expects, a rewrite where one is derivable, and the
escape flag. Tune the numbers and the verb list via the
`conventions.issueTitle` settings block; the type vocabulary via
`conventions.goalTypes`.

## Goal types pick the grammar

A goal carries ONE type in its `type:` frontmatter — `feat`,
`bug`, `docs`, `research`, or `chore` (absent means `feat`;
`goals draft --type` sets it, the intake classifier proposes one).
`feat`/`docs`/`research`/`chore` titles are verb-first; a `bug`
title states the observed defect in present tense
(`Log In Times Out When Idle`, never `Fix …`). The type is also
the issue's tracker label (see `labels.md`). A project extending
the vocabulary declares each type's label AND grammar
(`verb-first | symptom | none`) — an unknown type refuses where it
is typed.

## Verb prefix (feat, docs, research, chore)

Start the title with an imperative verb signaling the type of work:
**Implement** (new code), **Draft** (documents), **Research**,
**Decide** (ADR-worthy choices), **Wire** (connecting existing
pieces), **Port**, **Fix**, **Add**, **Refactor**, **Test**,
**Provision** (infrastructure), **Dogfood** (workflow exercises).
Add project-specific verbs to `conventions.issueTitle.verbs`.

## Bug titles (symptom)

State what the system does wrong — `Log In Times Out When Idle`,
`Reviewer Dies at Launch: Untrusted SessionStart Hook`,
`Non-Deterministic Reviewer Outcome in Poll Loop`. An opening verb
refuses; a vocabulary verb used as a NOUN (`Test Runner Hangs on
Exit`) is the expected waiver reason.

## Length

Aim for **35–50 characters**. Past 50 should justify itself; past 60
refuses without the ignore flag.

## Style

Title Case (product/tool names keep their native casing). Name the
**technical thing**, not the area — a title you couldn't grep the
tracker for later is not specific enough.

## Mentioning issues

Pair the key with its title on first mention in anything a human
reads (`ABC-12 (Fix Lazy Tab Spawn Losing Typed Input)`), never a
bare key — at any distance from the work, nobody remembers what the
number means.
