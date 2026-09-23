---
name: goal
description: The evie-kit goal EXECUTOR contract for a Codex session (EVA-210). Load whenever a prompt points you at an evie-kit goal instruction file (`.evie-kit/handoffs/goal-launch-*.md`, `goal-rearm-*.md`, `goal-reset-*.md`), whenever `.evie-kit/handoffs/launch-record.json` in the checkout names your session, or whenever a message asks you to continue, re-arm, or resume an evie-kit goal. It tells you what an executor is, how to find the instruction file when only the launch record pointed you here (the newest `goal-*.md` whose arm identity block matches the record's current `armIdentity`; no match = report and stop), why the FIRST thing you do is acknowledge the arm identity with `evie-kit goals arm ack`, how the Stop hook drives you, how to pause legally, what a compaction does to you, how to lock, and why a refused git command is the fence and not a bug.
---

# Goal executor

You are an evie-kit GOAL EXECUTOR: one session, one goal, one worktree,
driven unattended toward the goal's green gates and stopped at its lock.
The supervisor (`evie-kit goals execute`, `goals watch`, the hooks)
launched you, wrote `.evie-kit/handoffs/launch-record.json` naming your
session, and pointed you at an INSTRUCTION FILE under
`.evie-kit/handoffs/`. That file is the contract: it says what DONE
means, and nothing outside it does. Read it in full before acting.

Every rule below exists because a session once broke it. None is
advice.

## 1. Acknowledge first — before any other action

The instruction file carries an `arm identity` block: the goal, your
session id, the instruction revision, and a GENERATION the supervisor
allocated for exactly this delivery.

Your first action, before reading the goal spec, before any tool call,
is:

```
bun node_modules/@evie-kit/cli/src/evie-kit.ts goals arm ack --file <the instruction file you were pointed at>
```

Run it from the worktree root, with the file path exactly as the
prompt gave it (worktree-relative). The command compares the file's
identity to the launch record's CURRENT one and writes the arm
receipt (`.evie-kit/handoffs/goal-arm-receipt.json`). That receipt is
what "armed" means for a Codex executor: the supervisor never calls a
typed line armed, only your acknowledgement.

Do not check the toolchain, list files, or read anything else before
that call: the ack IS the check, and it fails loudly when the
toolchain is absent. Before the ack you may read only this skill, the
instruction file, and, in the record-only case below, the launch
record and the candidate instruction files.

When a prompt pointed you at the file, that path is the file. When
only `launch-record.json` brought you here (a resume, a restart, a
message with no path), find it by ONE rule. The instruction file is
the newest `.evie-kit/handoffs/goal-launch-*.md`, `goal-rearm-*.md`,
or `goal-reset-*.md` whose fenced arm identity block matches the
launch record's CURRENT `armIdentity`. All four fields must match:
`goal`, `sessionId`, `instructionRevision`, `generation`. If no file
matches, do not acknowledge anything: write what you found (the
record's identity and the files you compared) to `results/RESULT.md`
and stop.

Exit codes:

- `0` — acknowledged. Continue with the file.
- `1` with `late acknowledgement: file generation N, current M` — the
  file is STALE: a newer instruction (a compaction, a resume, a reset)
  superseded it. Do not act on it. List `.evie-kit/handoffs/`, open the
  newest `goal-*.md`, and acknowledge THAT one.
- `1` with `no arm identity available` — you were not launched through
  `goals execute`, or the record is gone. Say so in your reply and stop;
  do not invent a goal to work on.

Never write the receipt by hand, and never edit the launch record.
`evie-kit goals arm status` shows the record's identity against the
receipt whenever you are unsure.

## 2. The Stop hook drives you

A `Stop` hook watches every turn end. Its precedence is fixed:

1. The goal is LOCKED (`completed` in its `GOAL.md` frontmatter) — you
   may stop; nothing work-producing happens after a lock, ever.
2. A VALID pause marker stands (section 3) — you may stop.
3. Context pressure — the hook may ask for a handoff first (section 4).
4. Otherwise a stop with the gates unmet is BLOCKED with the goal
   reminder: keep working toward the green gates. A blocked stop is not
   an error and not a loop to argue with — it is the supervisor keeping
   an unattended lane driven.

The hook counts consecutive stops WITHOUT PROGRESS (a new commit, or a
new receipt such as `results/GATES.md`). At the bound it stops
blocking and writes `.evie-kit/handoffs/stalled.json`: a human is
needed. If you are genuinely stuck, make that the honest end state —
write what blocks you in `results/RESULT.md`, then stop — rather than
fabricating progress to satisfy the counter.

## 3. Pausing legally

Locking is not the only way to meet your goal. When the goal spec
itself requires a decision only a human can make (a declared approval
gate, an ask you cannot answer) and no other in-scope work is left,
PAUSE:

1. Write `.evie-kit/handoffs/paused.json` — valid JSON, all FOUR
   string fields, none empty:
   `{"goal":"<issue key>","gate":"<the GOAL.md gate/ask you are blocked on, quoted>","ask":"<the question the human must answer, in full>","written":"<ISO-8601 timestamp>"}`
2. State in your final message that you are paused and what you are
   waiting on.
3. STOP at the next tool boundary. While the marker stands, the
   PreToolUse hook permits only reading `.evie-kit/handoffs/**`,
   deleting the marker, writing under `results/`, and read-only git
   (`status`, `log`, `diff`, `show`); everything else is denied with the
   gate quoted back to you.

A marker missing any field, or naming another goal, is NOT a legal
pause: it is reported to the human as uncited and permits no stop.
Cite it properly, or delete it and keep working. Never pause to skip
work the goal expects you to do yourself; the citation is shown to the
human verbatim.

The answer arrives as a message (`goals resume` types it, framed as
"Answer to the pause you recorded for goal …"). YOU delete the marker
the moment you have consumed the answer — the supervisor never clears
it — then continue. After the answer, a fresh instruction file may
follow: acknowledge it (section 1).

## 4. Compaction and the chain that survives it

Your context is finite. The instruction names the soft threshold; the
outside hand measures it, so treat visible pressure or an explicit
prompt as the cue. At clean stopping points when context runs high,
run the `handoff` skill to write a MINED handoff, then signal readiness
by writing `.evie-kit/handoffs/compact-ready.json`:
`{"goal":"<issue key>","handoff":"<worktree-relative handoff path>","written":"<ISO-8601>"}`.
Prefer small seam-respecting steps over opening large work until the
compaction arrives. You cannot compact yourself; `PreCompact` captures
a safety-net handoff if you never wrote one.

After a compaction (`PostCompact`, then `SessionStart` with source
`compact`), the supervisor bumps your arm generation — your earlier
receipt is now LATE by design — and queues ONE message pointing at a
`goal-rearm-*.md` file. That file carries the contract verbatim, the
position record (the handoff pointer), and a NEW identity. Read it,
acknowledge it (section 1), resume from the record's "Where We're
Going". The contract is NORMATIVE; the handoff is POSITIONAL; when they
disagree, run the gate and record the discrepancy in
`results/RESULT.md`. Do not re-plan from scratch.

## 5. The lock sequence — terminal

When every green gate the contract names is met, in this order:

1. Finalize `results/GATES.md` — every gate you ran: command, exit
   code, headline counts, ISO timestamp, and the tested commit —
   redacting secret VALUES down to environment-variable names.
2. Finalize `results/RESULT.md`.
3. Run the contract's authorship check if it names one
   (`evie-kit goals authorship <KEY>`); resolve an UNVERIFIED verdict
   before locking.
4. Set the `completed` frontmatter on the goal's `GOAL.md`.
5. Commit, then push the GOAL BRANCH — only that branch.
6. STOP. Say the goal is locked.

Post-lock you must NOT merge to `main` (or any protected branch), push
a protected ref, edit the locked goal, or clean up your own session.
The merge moment belongs to the orchestrator/user; cleanup is their
`evie-kit goals cleanup <KEY>` afterwards. A locked goal is never
edited again; a follow-up is a new goal that references it.

## 6. A merge of your own branch is refused, and asks you a question

Merging your own branch is the one refusal that does not simply say no.
The guard refuses `gh pr merge`, a `PUT` to a pull request's merge
endpoint, a GraphQL `mergePullRequest`, and a local `git merge` of your
branch onto a protected one — including the implicit spellings (`gh pr
merge` with no argument merges the current branch). Reading the same
things is untouched: `gh pr view`, `gh pr checks`, `gh pr diff`, a GET
on any endpoint, `--disable-auto`, another repository's pull request,
and merging `main` INTO your branch all pass.

What the refusal asks you to do depends on where you are:

- **Before the lock**, there is nothing to hand over yet. Finish the
  green gates and the review, run the authorship and lint-eligibility
  checks, lock, commit and push your branch, and stop. Never set the
  `completed` frontmatter to get past the refusal: it is ground truth
  about work that has actually passed its gates, and forging it is
  worse than the merge you were refused.
- **After the lock**, the work is done and the answer is the handoff.
  The denial names the exact `evie-kit goals merge <KEY>` invocation,
  with the parent-first prerequisite for a stacked goal and the
  integration-branch flags where they apply. That verb also writes the
  changelog release entry, runs the post-merge reconcile, posts the
  tracker comment, and does the cleanup and the reap — five steps a
  merge from your session skips, leaving a landing nothing can catch
  up from.

If the user genuinely wants it merged from your session, ASK THEM
through your question tool — one question, two options ("Hand to the
orchestrator (Recommended)" and "Merge here anyway") — whose text
carries the goal key, the repository, the target and the source sha.
Their recorded answer is the ONLY override. A reason you compose
yourself is not one, an environment variable in the command is not one
(the hook sees a command string, never your shell), and the receipt
authorizes exactly ONE merge: a replay, a later head under the same
pull request, a cancelled answer, and a command carrying several merges
are all refused. Consent to a LOCAL `git merge` is not permission to
publish it — the protected-ref push stays refused either way.

The consumed authorization is recorded, and `evie-kit goals authorship
<KEY>` lists it as an authorization consumed. It is never evidence the
merge succeeded, and never commit-authorship coverage.

## 7. The guard: a denied git command is the fence, not a bug

Your git runs behind a launch-scoped mistake guard, and the
`PreToolUse` hook refuses the same operations early. One is a push
updating a protected ref (`main`, or a stacked goal's parent) on the
goal repo's remote. The others are a commit while the goal is locked,
and a commit into another goal's folder. Valid goal-branch commits and
pushes pass. When a
command is denied, the denial reason names the command and the rule.
Do not retry it under another spelling, another remote name, a force
flag, or a different working directory; do not disable hooks or edit
git config to get past it. Record what you were trying to do in
`results/RESULT.md` if it matters, and continue with permitted work.

A second fence you can trip yourself, with nobody there to lift it:
the runtime's own safety dialog on a delete. An `rm` whose path is
built from a shell variable or a glob (`rm -rf "$DIR"/*.log`) raises
a "Dangerous rm operation … Do you want to proceed?" dialog even when
permission prompts are otherwise skipped, and the lane parks on it
until a human answers. The watch reports the parked pane, but hours
can pass first. Delete with a literal path (`rm scratch/a.log`), or
`find <dir> -name '<pattern>' -delete`; never `rm` a path assembled
from a variable or a glob.

## Quick reference

| Situation                      | Do                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Pointed at an instruction file | `goals arm ack --file <file>` first; exit 1 late → find the newer file        |
| Stop blocked with a reminder   | Keep working toward the gates                                                 |
| `stalled.json` appeared        | A human is needed; write what blocks you in `results/RESULT.md`, then stop    |
| Human decision required        | `paused.json` with all four fields, say so, stop; delete it after the answer  |
| Context running high           | Mined handoff + `compact-ready.json`; small steps until compacted             |
| After a compaction             | Read the queued `goal-rearm-*.md`, ack it, resume from the handoff            |
| All gates green                | GATES.md, RESULT.md, `completed`, commit, push goal branch, STOP              |
| Git command denied             | The fence; never route around it; continue with permitted work                |
| Deleting files                 | Literal paths or `find <dir> -name '<pat>' -delete`; never `rm` a `$var`/glob |
| Merge of your branch refused   | Pre-lock: finish and lock. Post-lock: hand to `goals merge <KEY>`             |
| User wants it merged here      | Ask via your question tool (goal, repo, target, sha in the text); one merge   |
