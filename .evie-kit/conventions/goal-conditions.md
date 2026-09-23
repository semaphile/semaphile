<!-- Starter default placed by `evie-kit setup` (EVA-140). This file is
     YOURS: edit it to your project's conventions — setup never rewrites
     it. Prose guidance only in v1: no lifecycle lint reads this file
     (mechanical enforcement is recorded follow-up work). -->

# Goal conditions — how "done" is written

The rules for writing a goal's green gates and any ad-hoc `/goal`
condition (EVA-227; adapted from a consumer project's `goal-prompt`
command). Two readers depend on them: the executing session, which
drives to the gates, and the `/goal` evaluator, which judges the
session after every turn from the CONVERSATION TRANSCRIPT ALONE — it
cannot run commands or read files. A gate whose evidence never appears
in the transcript can never be satisfied.

## Predicates, not instructions

- Every gate is a true/false statement about FINISHED work, never an
  imperative. "The failing test was run and its failure output shown
  before the fix" — not "write a failing test first".
- Every gate names its proof inline: not "the migration is applied"
  but "the migrate command was run and its output above reports no
  pending migrations".
- External predicates (a server action, a ticket or PR update, a
  measurement) each carry the evidence that shows them true.
- Constraints the ask stated ("do not touch the server", "only in this
  worktree") become predicates too; they are never dropped.
- Non-goals: name what must remain untouched, so a gate cannot be met
  by widening the change.
- A stop clause: "or stop after N turns and report partial progress",
  with N sized to the task.
- Concrete beats padded: file paths, measured baselines (test counts,
  warning counts), and exact commands belong in the gate; restated
  rationale does not.

## Standing gates for this project

<!-- The gates every coding goal here carries regardless of its ask —
     the project's test discipline, its check command, its commit
     rules. Write them as predicates with their proof, e.g.
     "`just check` was run at the final head and its output above
     ends in success". The goals skill copies this section into every
     new goal's Green gates at drafting time. -->

## Ad-hoc conditions

For work that runs in a hand-started session rather than a goal,
`/goals condition <task>` drafts a paste-ready `/goal` block under
these same rules — the standing gates included — and writes it to the
session scratchpad. The block is plain text: no headings, no fences.
