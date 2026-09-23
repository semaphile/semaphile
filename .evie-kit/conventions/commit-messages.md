<!-- Starter default placed by `evie-kit setup` (EVA-140). This file is
     YOURS: edit it to your project's conventions — setup never rewrites
     it. Prose guidance only in v1: no lifecycle lint reads this file
     (mechanical enforcement is recorded follow-up work). -->

# Commit messages

```
{type}({scope}): {description} ({ISSUE-KEY})
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`,
`spike`. Each GOAL type maps to the commit token its primary work
carries (`Feature → feat`, `Bug → fix`, `Research → spike`) —
declared per type as `commitType` in settings
`conventions.goalTypes`, defaulting to the kebab-case of the label.
Scopes: name the package/module directly; keep a small set
of meta-scopes (infra, ci) and prune one-offs.

Append the issue key once the work belongs to a promoted goal's
branch; pre-promotion draft commits omit it (the key does not exist
yet).

- **Surgical commits** — one logical change per commit.
- **50/72** — subject ≤50 chars, body wrapped at 72, body explains
  _why_.
