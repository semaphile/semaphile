# AGENTS.md — working agreement for the semaphile repository

This file is read by Codex at session start. It carries, as written
instructions, the working discipline the project owner uses elsewhere with
tooling that is not available here (a goal lifecycle, an interview skill,
compaction handoffs, blind review waves). Follow it as if it were enforced.
Where a rule says "ask", ask through `request_user_input`; never assume.

## 1. What you are building

`SPEC.md` is the authority. Its sections marked **DECIDED** are not open;
its **ENGINEERING** sections may be changed only with a stated reason that
keeps every DECIDED property true. If you find a contradiction in the spec,
stop and ask; do not resolve it silently in code.

Long-term implementation order: `SPEC.md` review → TypeScript core →
conformance suite (run it against the core) → CLI → Bottleneck facade →
Python client (the second implementation proves the spec is
language-neutral; expect to amend the spec and say so) → Go / Rust / Java.

## 2. Before building anything: the interview

For each deliverable, before writing code, run a short interview with the
owner through `request_user_input`, ONE question per call, in this shape:

1. First, in prose: what you did since the last question, what is being
   decided now, and what each option would cause (a concrete scenario per
   option, not adjectives). Define every term you use.
2. Then the picker: your recommended option first and labeled
   "(Recommended)", then the alternatives, and a last option "Go deeper —
   explain more before I decide".

Ask only what the spec leaves to the implementer (its ENGINEERING sections) or what the
code forces you to decide that the spec does not. Do not re-ask DECIDED
items. Record every answer at the bottom of `.scratch/docs/decisions.md` with the
date, the question, the options offered, and the choice.

Stop the interview when no open decision blocks the deliverable. Then say,
in one message: decisions made, what is deferred, and the first file you
will write. Wait for a go before building.

## 3. Building

- Small, reviewable commits. Conventional commits: `type(scope): subject`
  in the imperative, subject ≤ 50 characters, body wrapped at 72 explaining
  WHY. Types: feat, fix, docs, test, refactor, chore.
- Never `git push --force`, never rewrite history, never commit secrets.
- Tests come with the code, not after. A deliverable is not done until the
  conformance scenarios that apply to it (SPEC §7) pass on macOS and
  Linux, and the results are pasted (not summarized) into
  `.scratch/docs/receipts/<deliverable>.md` with the command, the commit, and the
  output.
- The blocking-lock mechanism (SPEC §§4–5) is the hardest part. Build it
  first, in isolation, with a two-process test, before anything depends on
  it. Document which mechanism you chose per platform in `docs/blocking.md`.
- Never add a polling loop to "make it work". If a wait cannot be a kernel
  block or a computed timer, that is a design problem: stop and ask.

## 4. Handoffs (you have no compaction hook, so you write them yourself)

Your context will fill and be summarized without warning. Protect the work
by writing a handoff file at `.scratch/docs/handoffs/<YYYYMMDD-HHmm>-<slug>.md`:

- at every milestone (a deliverable done, a conformance scenario green),
- before any step you expect to take more than ~20 tool calls,
- whenever you notice you are re-reading files you already read.

A handoff contains, in this order: what the goal is; where you are (files
changed, tests passing/failing with numbers); what you tried and what
failed and WHY; decisions made with rejected alternatives; what to do next,
in order; the exact command to verify the current state. Write it for a
reader who has none of your context. Keep private records under `.scratch/docs`; never copy credentials into
records, prompts or public documentation.

When you start a session, read the newest handoff first and continue from
its "next" list. Do not re-explore what it records.

## 5. Review before you call anything done

Before declaring a deliverable complete, run a blind review of your own
diff in a FRESH Codex session that has not seen your reasoning:

```
codex exec --sandbox read-only \
  "You are a reviewer. Read SPEC.md, then review the diff of the last N commits (git log -N) for: spec violations, polling loops, lock-ordering violations (SPEC §§4–5), descriptor discipline (SPEC §5), crash-reclaim gaps, and missing conformance scenarios. Report findings ranked by severity with file:line. Do not fix anything."
```

Paste the findings into `.scratch/docs/reviews/<deliverable>-<n>.md`, disposition
each one (fixed / rejected with reason / deferred), and fix the accepted
ones before moving on. Two review rounds per deliverable is the budget; if
the second round is as long as the first, the deliverable is too big —
split it and say so.

## 6. Completion marker

When a deliverable is complete and reviewed, append one line to
`.scratch/docs/PROGRESS.md`:

```
- [x] <deliverable> — <commit> — conformance: <scenarios green>/<total> — <date>
```

and write a final handoff. That line is the completion signal the owner
looks for; nothing else counts as "done".

## 7. Things you must never do

- Publish packages (npm, PyPI, crates.io, Maven) — the owner does that.
- Change the on-disk format (SPEC §3) without a spec change first, agreed
  through the interview, with `formatMinor` bumped.
- Use a network filesystem or `/tmp` shared across users for the
  conformance store; use a directory under the repo's `.tmp/`.
- Add a dependency that requires compiling native code at install time
  without recording why in `.scratch/docs/decisions.md` and asking first.
- Leave a deliberately failing test, a `TODO` without an issue reference,
  or a skipped conformance scenario without a written reason.

## 8. Where things live

The owner approved the public/private documentation split on 2026-09-09.
`docs/` contains curated contributor documentation. `.scratch/docs/` contains
private historical decisions, reviews, receipts and handoffs. Moves preserve
the existing records; links inside historical logs describe their original
workspace and are not rewritten. The private tree is excluded from Git.

```
SPEC.md                  the contract
AGENTS.md                this file
.scratch/docs/decisions.md        interview answers (append-only)
.scratch/docs/handoffs/           your handoffs
.scratch/docs/reviews/            blind review rounds and dispositions
.scratch/docs/receipts/           pasted test/conformance output per deliverable
docs/blocking.md         per-platform blocking-lock mechanism
.scratch/docs/PROGRESS.md         completion markers
packages/, clients/, conformance/   implementations and tests
```

<!-- evie-kit:codex-executor:begin -->

## evie-kit goal sessions (managed block — do not edit by hand)

If `.evie-kit/handoffs/launch-record.json` exists in this checkout and
its `sessionId` names YOUR session (or its `runtime` is `codex` and no
session id is recorded yet), you are an evie-kit GOAL EXECUTOR: load the
`$goal` skill (`.agents/skills/goal/SKILL.md`) before doing anything
else, and follow its acknowledgement step — run
`bun node_modules/@evie-kit/cli/src/evie-kit.ts goals arm ack --file <the
instruction file you were pointed at>` first. The skill also carries the
pause protocol, the compaction chain, the lock sequence, and the git
guard: a denied git command is the fence, not a bug — never merge or
push a protected branch. If the record names a different session, you
are a critic or an orchestrator in the same project; the executor rules
above are not yours.

Two supervising sessions exist here (ADR 0022): a PLANNER, which drafts and grills goals and never records itself, and ONE ORCHESTRATOR per project, which launches executors, receives lock reports and lands merges. Only when the user designates THIS session as the orchestrator, run `bun node_modules/@evie-kit/cli/src/evie-kit.ts goals bind orchestrator` once at the start of the session to record its seat — every goal it launches phones its lock report home to that seat. An orchestrator started with `goals spawn orchestrator` is recorded already and needs no bind. Load the `goals` skill for the lifecycle either way. On Codex the lifecycle's pickers render only in
Default mode with the `default_mode_request_user_input` feature enabled
(`evie-kit setup --codex-executor` sets it); an empty picker answer is
silence, never consent.

House prose style: write every piece of prose in this repository by `.evie-kit/conventions/writing-style.md` (the tracked house voice) plus its gitignored addendum `.evie-kit/conventions/writing-style.local.md`, which wins on contradiction; read both at every writing seam (drafting, review gates, tracker comments, handoffs). Lint tuning lives in settings, never in that pair.

<!-- evie-kit:codex-executor:end -->
