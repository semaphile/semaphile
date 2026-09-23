# Invoking `@evie-kit/goals`

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

**Toolchain guard (EVA-81)**: every invocation below assumes the
toolchain is present on THIS machine. It is a machine-local link that
git never carries and `bun install` does not create, so in a freshly
cloned consumer repo they all fail with module-not-found: the machine's
bootstrap has not run, and the repo is not broken. The fix is one
by-path run from an evie-kit checkout (`bun
/path/to/evie-kit/packages/cli/src/evie-kit.ts onboard`); the
project's own `EVIE-KIT.md` carries the details.

The lifecycle verbs are library functions — the package registers no bin
of its own (one-bin rule: the only bin any `@evie-kit/*` package
registers is `evie-kit`, owned by `@evie-kit/cli`); the door
verbs ride the unified CLI as `evie-kit goals draft | share | list |
completed | context | rebase | promote | plan | execute | restart |
liveness | adopt |
block | unblock | retire | release | review |
goal-review | compact | self-compact | auto-continue | session-start |
watch | resume | rebind | env | reconcile | tracker | cleanup | reap`
(the lifecycle four
landed in EVA-22 — in a repo where setup linked only `@evie-kit/cli`,
the CLI verb is the CANONICAL invocation for those steps; the `bun`
one-liners below remain the escape hatch and the orchestrator's
programmatic surface). Anything else is
invoked from a short `bun` script or one-liner at the repo root, where
bun resolves the package (workspace or linked). Verified surface — the
package's public exports (`startDraft`, `pushDraft` /
`resolveDraftCommitPolicy` (EVA-62), `rebaseGoalOntoBase`,
`promoteGoal`, `startGoalExecution`, `runReviewWave`,
`removeMergedGoalWorktree`, `deleteSonarBranchProject`,
`discoverRunningGoals`, the door functions `detectGoalContext` /
`readGoalsSurface` / `classifyIntake` / `captureIntake` and the list
views, the pure primitives `createDraft` / `scaffoldGoalFolder`, the
frontmatter transitions `transitionGoalFile` / `startFrontmatter` /
`completeFrontmatter`, and the EVA-33 fence/cleanup surface —
`installExecutorGuard` / `executorGuardEnv` /
`buildExecutionHandoffInstruction`, the EVA-47 compaction surface —
`compactExecutor` / `resolveCompactionPolicy` /
`readCompactReadyMarker`, the EVA-93 legal-pause surface —
`readPauseMarker` / `readPauseState` / `citedPause` / `resumeExecutor`,
`cleanupLockedGoal` with its
preflight primitives `resolveLockedGoalWorktree` /
`assertDurableLock`).

- **Draft** (step 1): from the primary checkout, on main:

  ```bash
  bun -e 'import { startDraft } from "@evie-kit/goals";
  const d = await startDraft({ repoRoot: process.cwd(), slug: "my-idea",
    timestamp: new Date(), title: "My Idea",
    frontmatter: { author: "evie", repo: "my-repo" } });
  console.log(d.worktreePath, d.branch);'
  ```

  Branch, worktree at `.worktrees/drafts/<ts>-<slug>/`, and scaffold in
  one step — the primary checkout stays on main. Commit+push follows
  the `goals.drafts.commit` policy (EVA-62, default `false`: local
  plain files; `push: true` / `goals draft --push` commits+pushes this
  one draft, `evie-kit goals share` shares an existing local draft
  later, and the returned `committed` says which mode applied).
  Work on the draft inside `d.worktreePath` from here. When the project
  carries `.evie-kit/conventions/issue-naming.md` /
  `branch-naming.md`, the naming-conventions lint (EVA-140) checks the
  title and slug at this capture seam (the `type` option /
  `--type` picks the title grammar, EVA-145: a `bug` draft's title
  states the symptom, the rest stay verb-first; absent = `feat`;
  `evie-kit goals classify --description-file …` is the read-only
  pre-mutation call that reports the proposed type): soft
  caps warn, hard-cap/grammar violations refuse without the NAMED
  convention's waiver —
  `--ignore-issue-naming '<reason>'` / `--ignore-branch-naming
'<reason>'` (the `conventionIgnores` option on
  `startDraft`/`captureIntake`; EVA-142 retired the blanket
  `--convention-override`) — and a consumed waiver's reason lands in
  the draft's `conventions.ignore.<name>` frontmatter. For a draft born
  from a `/goals draft` intake, use `captureIntake` (or `evie-kit
goals draft`) instead — same startDraft underneath, plus the verbatim
  `references/intake.md` capture (see `SKILL.md`, "The `/goals`
  door"). To
  stack the draft on an unmerged parent goal branch, add
  `stackedOn: "<parent-branch>"` (see `stacked-goals.md`).

- **Adopt a loose draft** (recovery, EVA-102): when a draft folder
  exists on disk but has no draft branch and no worktree — the shape a
  hand-scaffolded folder has, and the reason `goals promote` refuses it
  with "runs from the draft's worktree on its `draft/<name>` branch
  (currently on main)". Hand-rolling the promotion instead is what
  bypasses every invariant promotion enforces; adopt the folder rather
  than working around it:

  ```bash
  # from the primary checkout, on main:
  evie-kit goals adopt-draft goals/drafts/<ts>-<slug>
  # equivalent library call:
  bun -e 'import { adoptDraft } from "@evie-kit/goals";
  console.log(await adoptDraft({ repoRoot: process.cwd(),
    folderPath: "goals/drafts/<ts>-<slug>" }));'
  ```

  It retrofits exactly what `startDraft` would have made — branch,
  mirror worktree, provisioning, the resolved draft-commit policy —
  sharing that path's own choreography, and tops up only MISSING
  skeleton files (reported as `scaffolded`), never touching authored
  content. `--push` publishes the folder and therefore needs
  `--intake-reviewed`, the same EVA-62 gate as `draft --push` and
  `share`. It refuses rather than guessing when the folder is outside
  `goals/drafts/`, misnamed, has no readable GOAL.md, is already
  tracked on main, or already has its branch — and any failure restores
  the folder to where it was found.

- **Cross-developer adoption** (EVA-138 — see
  `references/collaboration.md` before driving any of these): from the
  primary checkout,

  ```bash
  evie-kit goals adopt EVA-142                  # promoted goal by key (or full name)
  evie-kit goals adopt draft/<ts>-<slug>        # a shared draft
  evie-kit goals adopt EVA-144 --takeover       # claim a STARTED goal (recorded handshake)
  evie-kit goals adopt --issue EVA-145          # issue-import-as-intake (no goal exists)
  ```

  Programmatic equivalents: `adoptGoal` / `importIssueAsDraft`. The
  positional form fetches the branch, mints the mirror worktree, and
  provisions the estate (copy stage + `bun install`). The claim
  commit's push is the atomic step — a lost push stops before the
  issue is reassigned. A started goal refuses without the owner's
  release or `--takeover`. The `--issue` form scaffolds a draft whose
  `references/intake.md` is the issue's thread byte-for-byte;
  promotion then reuses the same issue (`import_issue` frontmatter is
  promote's default `--issue`).

- **Dependency edges + the status verbs** (EVA-138): from anywhere in
  the repo (the goal resolves to its mirror worktree; a goal with no
  local worktree names `goals adopt` first),

  ```bash
  evie-kit goals block EVA-142 --by EVA-140,EVA-141   # declare edges (recorded commit)
  evie-kit goals unblock EVA-142 [--by EVA-141]       # drop stale edges (bare = all)
  evie-kit goals retire EVA-143 [--reason <text>]     # promoted-tier terminal status
  evie-kit goals release EVA-144 [--note <text>]      # owner's recorded release for adoption
  evie-kit goals promote --blocked-by EVA-140,EVA-141 # map-stamped edges at promotion
  ```

  Each is one forward commit in the goal's worktree, pushed
  best-effort, with the matching tracker event behind it (`blocked` →
  Backlog default, `retired` → Canceled/closed default, release/adopt
  posting their issue comments). Programmatic equivalents:
  `withBlockedBy` + `materializeBlockedStatus` (the one writer of the
  derived `blocked` status), `retireFrontmatter`, `releaseFrontmatter`,
  `propagateUnblocks` (the merge-time flip `goals merge` runs itself).

- **Promotion pre-flight** (step 3): with local main freshened first —
  `git pull --ff-only` **on the primary checkout** (which is on main;
  `git fetch origin main:main` does NOT work here — git refuses to
  update a branch that a checkout has checked out),

  ```bash
  # from inside the draft worktree, or from the primary checkout with
  # --worktree .worktrees/drafts/<ts>-<slug> (the always-works form):
  evie-kit goals rebase
  # equivalent library call:
  bun -e 'import { rebaseGoalOntoBase } from "@evie-kit/goals";
  console.log(await rebaseGoalOntoBase({
    worktreePath: ".worktrees/drafts/<ts>-<slug>" }));'
  ```

  The rebase target resolves from the draft's own `stacked_on`
  frontmatter (main when absent) — nothing extra to pass for a stacked
  draft. On conflicts this leaves the rebase in progress in the
  worktree — resolve there, `git rebase --continue`, re-run to
  force-push (with lease). Then promote — `evie-kit goals promote`,
  run from inside the draft worktree, or from the primary checkout
  with `--worktree .worktrees/drafts/<ts>-<slug>` — the form that
  always works, even when the worktree's toolchain link is missing
  (EVA-22): it re-runs the rebase
  pre-flight itself, creates the issue on the active tracker from the
  layered `tools.tracker.*` block (EVA-26: Linear team/project/apiKey,
  or GitHub via `gh`; the body mirrors GOAL.md
  with permalinks pinned to the real pushed head, each linked path
  verified with `git cat-file -e` — never extend a short hash), then
  drives `promoteGoal`. For a draft with an UNCOMMITTED
  `references/intake.md` (the EVA-62 default), run the intake review
  gate first (lifecycle step 3) and pass `--intake-reviewed` — without
  it the promotion refuses before touching anything. Independently of
  that attestation, the confidentiality lint (EVA-139) runs at every
  publication seam when the project carries the
  `.evie-kit/conventions/confidentiality.md` pair. It scans the draft
  folder's publishable surface plus the commits the push would
  publish. A refusal names rule + file + line with the matched value
  redacted, and suggests the alias spelling when one is declared. Fix
  the named lines (or a wrong deny entry in
  `confidentiality.local.md`) and re-run — there is no skip flag.
  The naming-conventions lint (EVA-140) runs at the same pre-mutation
  point when the project carries the conventions files: the GOAL.md H1
  and branch slug are re-checked under the record's `type:` grammar
  (refinement edits the H1, so the draft-time pass does not carry),
  and the type's label is stamped on the created issue under the
  tracker's `Type` label group (EVA-145; Title Case labels over
  lowercase ids since EVA-148; materialized when absent,
  reported on the console); hard-cap/grammar violations refuse
  without the named convention's waiver (`--ignore-issue-naming
'<reason>'` / `--ignore-branch-naming '<reason>'`, EVA-142), and a
  consumed waiver is recorded in the promotion commit body and the
  `conventions.ignore.<name>` frontmatter key.
  `--issue KEY`
  (optionally `--issue-url URL`)
  escapes to an issue created elsewhere (the orchestrator case, whose
  facts promotion now VERIFIES where it has a credential — EVA-83); with
  no resolvable API key and no `--issue`, it fails loudly — a goal is
  never promoted without an issue. `--assignee <name|email|id|me>`
  overrides who the issue is assigned to for this promotion.
  `--create-project` creates a configured-but-absent Linear project in
  the team instead of refusing. Under a declared
  `tools.tracker.linear.hierarchy` (EVA-236), a draft carrying
  `wayfinder/MAP.md` takes the map-shape answer: `--map-shape
<create-epic|attach-epic|related-issues|sub-issues>`. `--epic <name>`
  is required for attach, and names a created epic (default: the
  map's title). `--initiative <name>` links the epic under an
  initiative that must already exist; it overrides
  `hierarchy.initiative`. Without `--map-shape` under `mode:
"prompt"`, the verb STOPS with exit 2. Its stdout is the confirmation
  JSON (`needsConfirmation: "map-shape"`, the shapes, the epics with
  descriptions, the preselected default). The flags refuse on a
  map-less draft, on a project with no hierarchy block, on the
  imported-issue path, and on a map already placed. `--create-project`
  refuses beside an epic shape, since the epic replaces the project.
  Both CLI invocation forms are equivalent: inside the draft worktree,
  or `--worktree <path>` from the primary checkout (the always-works
  form). Programmatic callers use
  `promoteGoal` (with `repoRoot` = the draft worktree) directly; either
  way branch + folder + worktree rename together — use the returned
  `worktreePath` afterward, the drafts/ path is stale.

- **Right-sizing** (step 5, before the handoff — EVA-90): from the
  orchestrator, on the primary checkout or the goal's own worktree —

  ```bash
  # recommend and PRINT (records nothing); --json for the same as data
  evie-kit goals plan ABC-NNN
  # correct a misread spec, then record what the user confirmed
  evie-kit goals plan ABC-NNN --size L --code
  evie-kit goals plan ABC-NNN --accept
  ```

  It accepts the bare issue key or the full folder name, plus
  `--repo-root`, `--json`, `--accept`, `--docs-only` / `--code`,
  `--size`, `--model`. Programmatic equivalent:
  `readGoalSignals(goalBody)` → `recommendLifecyclePlan(signals, opts)`
  → `recordAcceptedPlan({ goalRoot, plan })`, with
  `renderPlanSummary` for the seam's prose. Semantics:
  `right-sizing.md`.

- **Execution handoff** (step 5): from the orchestrator, on the primary
  checkout (which must NOT have the goal branch checked out) —
  `evie-kit goals execute ABC-NNN` (EVA-22; accepts the bare issue key
  or the full folder name, `--mode`/`--model`/
  `--override-unisolated-launch` pass through) resolves the stated
  herdr session itself. Since EVA-130 it also SELF-ARMS the lock-watch
  companion as a detached child (log:
  `.evie-kit/runs/watch-<KEY>.jsonl`; the report's `watch` field says
  what happened; `--no-watch` opts out — EVA-128's second half).
  Programmatic equivalent:

  ```ts
  // save as a script (or inline via bun -e) and run at the repo root
  import { HerdrClient } from "@evie-kit/herdr";
  import {
    herdrBindingFor,
    launchSessionFacts,
    loadSettings,
    resolveOperatorIdentity,
    startGoalExecution,
  } from "@evie-kit/goals";
  const repoRoot = process.cwd();
  // Session binding must be STATED (EVA-20) and is TIERED (EVA-120):
  // tools.herdr.session when set (this operator composed on, EVA-116),
  // else the herdr session THIS process runs in (`HERDR_SESSION`), else
  // `launchSessionFacts` REFUSES — execute is pane-touching, and the
  // repo-slug guess is gone. A pin disagreeing with the caller's own
  // pane refuses too (decision 7); pass `{ explicitSession: "<name>" }`
  // in the opts below to override eyes-open (this example resolves
  // ambiently, so it does not).
  // Resolve ONCE and derive both the client binding and the record from
  // it: omitting `sessionBinding` is not a simpler launch, it is one
  // with no durable binding, and every later verb then falls back to
  // the ambient chain without saying so.
  const { settings } = await loadSettings(repoRoot);
  const identity = resolveOperatorIdentity();
  const facts = launchSessionFacts(settings, identity);
  await startGoalExecution({
    repoRoot,
    goalRelPath: "goals/ABC-NNN-the-slug",
    herdr: new HerdrClient(herdrBindingFor(settings, facts.session)),
    sessionBinding: facts,
    timestamp: new Date(),
  }); // adopts .worktrees/<branch> (creates it only if absent),
  //    marks started, launches the executor
  ```

- **Goal review** (step 2 — the pre-EXECUTION refinement tool):
  `evie-kit goals goal-review round --brief-file <path>` from inside
  the goal's worktree — the goal resolves from the branch. The
  lifecycle boundaries are two, deliberately distinct: ROUNDS run any
  time before execution (`draft/<ts>-<slug>`, or a promoted
  not-yet-started goal — post-promotion spec edits start fresh
  rounds), while the persistent CRITIC lives only until promotion
  (promotion dismisses it; a post-promotion round respawns from the
  committed artifacts). Roster comes from the settings' goal-staged
  tools; critic tabs are re-found by label across invocations.
  `status` prints latest verdicts + consensus and `dismiss` closes
  critic tabs — both work at ANY lifecycle stage (cleanup and reading
  history are never gated). Read `references/goal-reviews.md`
  **before running one** — the round contract, routing rules, and
  seams live there.

- **Review wave** (step 7): `evie-kit goals review` from inside the
  goal's worktree, or from the primary checkout with
  `--worktree .worktrees/<KEY>-<slug>` — the always-works form
  (EVA-22) — the goal comes from the branch (or pass
  `ABC-NNN`), the diff base from its `stacked_on` frontmatter (or
  `--base`), reviewers from the settings' defined tool blocks; the
  stated-session binding, bound-session workspace resolution, and
  per-tool stall thresholds are the EVA-20/21 reference-driver shape,
  productized. This is what makes waves runnable in a foreign repo
  where setup linked only `@evie-kit/cli` (the NE-215 gap — driver
  scripts import sibling packages by name, which only resolve from
  inside the workspace). Credential sourcing still applies
  (`references/review-waves.md`). Write a goal-specific driver script
  (copy-adapt EVA-21's `goals/*/results/run-review-wave.ts` reference)
  only when the gate needs assertions beyond the wave itself —
  pre-EVA-21 `run-review-round.ts` drivers target the removed
  `runReviewRound` API and fail loudly. A round that verifies a fix
  batch declares itself — `evie-kit goals review --purpose
verification --verifying "the round-2 fix batch"` (EVA-90) — which
  exempts it from the finding-round budget and records the claim in
  the round's `ROUND.json` and INDEX.

- **Executor compaction** (mid-execution, EVA-47): `evie-kit goals
compact <ABC-NNN> [--skip-handoff] [--handoff <path>] [--soft <tokens>]
[--hard <tokens>]` from the primary checkout — locates the executor
  pane by agent name in the repo's stated herdr session, prompts the
  mined handoff (default), and types the `/compact` in. Programmatic
  equivalent: `compactExecutor`. See `executor-compaction.md` for
  the cycle, thresholds, and readiness signal.

- **Self-arranged compaction** (any herdr-hosted session, EVA-73,
  reshaped EVA-124): `evie-kit goals self-compact --handoff
<worktree-relative path> [--session-id <id>] [--goal <KEY>]
[--continuation <single line>]` from the session's own checkout —
  spawns the detached one-shot helper (pane found via the ambient
  `HERDR_PANE_ID`/`HERDR_SESSION` env first, the herdr `agent_session`
  search behind it; typed `/compact` citing that SPECIFIC handoff; the
  continuation queued IMMEDIATELY through the compaction — the `/goal`
  re-arm for a goal executor with a recorded launch instruction, the
  plain pointer line otherwise; a queued-copy check prevents
  double-typing). Programmatic equivalent: `selfCompact`. See
  `executor-compaction.md` for when to self-arrange vs signal the
  watcher.

- **Auto-continue** (after a compaction or a session reset, EVA-105):
  `evie-kit goals auto-continue --session-id <cc session id>
[--trigger post-compaction|session-start] [--root <path>]` — the
  HOOK-SPAWNED arm, for sessions no `goals watch` covers. Evaluates the
  guards in the foreground (so a stand-down is observable), then spawns
  a detached worker that types the resume pointer and, for a goal
  executor, re-issues the launch's own recorded `/goal` contract.
  Nothing normally runs this by hand — the PostCompact hook and the
  SessionStart hook do — but running it IS the way to see why a session
  was or was not nudged. Programmatic equivalents:
  `evaluateAutoContinue` (the guard core) and `deliverAutoContinue`
  (the typing). `evie-kit goals session-start` is the SessionStart
  hook body itself, for consumer repos with no `packages/` path to
  point a hook at. See `executor-compaction.md`, "Auto-continue after a
  compaction or a reset".

- **Lock-watch companion** (mid-execution, EVA-68): `evie-kit goals
watch <ABC-NNN> [--poll <seconds>] [--once] [--report-to <agent>]` from the primary
  checkout — liveness plus compact-on-marker, until lock (exit 0) or a
  dead executor (exit 1), or exit 2 when observation itself failed
  (a one-shot `--once` that threw, or 5 consecutive tick errors —
  watcher failure, NOT executor death). Programmatic equivalent:
  `createLockWatch`
  (injectable deps) — the CLI wires it to the goal's worktree marker,
  herdr agent list, and `compactExecutor`. Since EVA-93 it also emits
  `executor-paused` / `pause-marker-invalid` / `executor-resumed`
  events (edge-triggered, carrying the executor's citation verbatim).
  Since EVA-105 it also delivers the post-compaction auto-continue nudge
  for the executor it watches, emitting `auto-continue` or
  `nudge-failed`. Since EVA-112 it carries two more jobs: it RETRIES a
  refused `/goal` re-arm at each idle-without-lock window
  (`rearm-retried` / `rearm-armed` / `rearm-dead-end`, working through
  the retry ledger at `.evie-kit/handoffs/nudge-failed.json`), and it
  delivers a LOCK REPORT to the orchestrator's pane when the goal locks
  (`lock-reported` / `lock-report-skipped`). Since EVA-130 it also runs
  the signature-to-remedy PLAYBOOK over an idle executor's pane text
  (EVA-128; a data-driven table — `RETRY_PLAYBOOK` in
  `watchApiRetry.ts`, future classes are table entries, not code):
  transient API 5xx/overloaded/timeouts are RESENT on fibonacci backoff
  (30/30/60/90/150…s capped at 15m, one-time `api-retry-cap` ping);
  safeguards-flagged turns get at most 2 FRESH nudges (never verbatim,
  never a model switch) then escalate; the account's SESSION LIMIT
  ("You've hit your session limit · resets 12:40am (America/Chicago)")
  is wait-then-resend — nudges are HELD until the stated reset time
  (`hold_until` on the event and the ledger), then one continue line
  on the same schedule; auth/credit/permission/question
  states and unrecognized API errors are escalate-only —
  `api-retry-escalated` is the human-notification event, and the watch
  never nudges past a human gate. Events `api-error-detected` /
  `api-error-retried` / `api-error-recovered` / `api-retry-escalated`,
  ledger at `.evie-kit/handoffs/api-retry.json`. It also surfaces the
  typing guard's `delivery-audit`
  records (EVA-127: cleared/restored residue drafts, echo refusals).
  Note the launch self-arms this watch since EVA-130 — arm it by hand
  only for `--no-watch` launches or after a watcher died. The report
  target is `--report-to <herdr agent>`, else the project's ORCHESTRATOR
  RECORD (EVA-218; written by `goals spawn orchestrator` or `goals bind
orchestrator`). When it arms, the watch CAPTURES that record's identity
  (agent, herdr session, pane, observed session id, generation, runtime;
  EVA-212 gate 3, ported EVA-222) and writes it to the goal worktree's
  `.evie-kit/handoffs/watch-record.json`. At lock it resolves the record
  AS IT IS THEN. A live record is delivered to. The receipt on every
  lock-report event names the captured identity, the transition since
  arm (`same`, `rotated`, `replaced`, `uncaptured`) and the lock commit.
  An absent record is a named no-target skip, even when the captured
  pane still hosts the same agent: a pane with no record is never typed
  a lock report. An unreadable liveness is a refusal. The outbox then
  turns a skip into a human delivery. The
  goal's own executor is never a target. None of this is fatal: an
  unresolvable target is reported and the watch still exits 0. See
  `executor-compaction.md` for the watchdog/companion split.

- **The lock-time authorship check** (completion, EVA-130): `evie-kit
goals authorship [<ABC-NNN>] [--worktree <path>]` — from the goal's own
  worktree (the executor's shape; a bare invocation uses cwd) or by key
  from the primary. Verifies every commit since the commit fence armed
  is in the executor ledger or the audited-override ledger; exit 1 on
  `unverified` (a foreign write — the EVA-124 shape), exit 0 with a
  stderr note on `not-armed` (pre-EVA-130 launches have no chain).
  Programmatic equivalent: `verifyAuthorshipChain`. Legitimate hand
  commits into an executing worktree ride
  `EVIE_GOAL_COMMIT_OVERRIDE='<short reason>'` — allowed and
  audit-logged; `goals cleanup` re-runs the check as a REFUSAL —
  `unverified` needs `--authorship-accepted '<reason>'` — and retires
  the fence key. Absorbed mainline history classifies as `inherited`,
  never a foreign write (EVA-157): reachable from the goal's base
  branch, not a descendant of the fence base. The verb takes
  `--main-branch`/`--remote` when the defaults are wrong.

- **Answer a paused executor** (mid-execution, EVA-93): `evie-kit
goals resume <ABC-NNN> "<answer>" [--ready-timeout <seconds>]
[--no-rearm]` from the
  primary checkout — types the human's decision into the pane through the
  submitting channel (one line; quote it), waits for the executor to
  clear its own marker, and then RE-ARMS the session's `/goal` from the
  launch's own recorded instruction (a legal pause satisfies CC's
  evaluator, so the contract clears with it; re-arming before the pause
  clears would just install a contract that pause already satisfies).
  Reports whether a cited pause marker was actually on disk. The
  EXECUTOR clears its own `paused.json`; this verb never does.
  Refuses when no executor pane matches (a paused executor is a
  running one), when the answer is empty, or when it is not a single
  line; a re-arm it cannot perform (no recorded instruction, no cited
  pause, `--no-rearm`) is reported, never fatal. `--ready-timeout` caps
  EACH of the three sequential waits — answer-ready, marker-clear,
  re-arm-ready — so the worst case is three times the value, not one.
  `<ABC-NNN> --rearm-only` is the recovery mode: it re-issues the
  recorded `/goal` and types no answer, for a session that was
  answered but left undriven; it refuses while a cited pause still
  stands. Programmatic equivalent: `resumeExecutor`. The pane itself
  remains the substrate — a human at the pane just answers — but that
  path cannot re-arm the goal, so prefer the verb for executors nobody
  is watching. A DEAD executor cannot be relaunched by
  `goals execute` (it starts only `promoted` goals) — `goals restart`
  is the recovery verb (EVA-150, below), and resume's own refusal
  names it after checking process truth.

- **Launch the project's orchestrator** (EVA-218): `evie-kit goals
orchestrate [--model <model>] [--session <herdr-session>] [--planner
current|<agent>|none|clear] [--json]` from anywhere in the repo — an
  interactive Claude Code session in the PRIMARY checkout on
  `execution.orchestrator.model` (flag > settings > `claude-opus-5`),
  given the generated role instruction
  (`.evie-kit/handoffs/orchestrator-instruction.md`), and RECORDED as
  the project's singleton orchestrator
  (`.evie-kit/handoffs/orchestrator-record.json`: project identity,
  herdr session/agent/pane, Claude session id, generation, instruction
  path + revision, model) once herdr lists the live pane. Refuses
  (exit 1) while the recorded one is live, naming it; replaces a DEAD
  record with the generation bumped; refuses to replace on an
  uncertain liveness read; recovers a pane whose launch died before
  publishing its record instead of doubling it. `--planner current`
  (run from the planner's own pane) or `--planner <agent>` binds the
  OPTIONAL notice-line destination — never inferred; `none` keeps the
  existing binding, `clear` removes it. The herdr session resolves as
  `goals execute` resolves one. Programmatic equivalent:
  `launchOrchestrator`; every reader uses `locateOrchestratorRecord`.

- **Planning requests** (EVA-218): `evie-kit goals requests [list
[--all]] | show <id> | write --seam <seam-id> --subject <text>
--changed <text> --why <text> [--goal <KEY>] [--no-notify] | open <id>
| resolve <id> --outcome <text> [--ref <text>] | dismiss <id> [--note
<text>] [--by planner|user]` from any worktree — the requests live
  under the PRIMARY checkout's handoffs directory
  (`planning-requests/<id>.json`), so cleanup of the triggering goal
  cannot remove them. `write` is the ORCHESTRATOR's act: it refuses
  without a recorded orchestrator (the request carries its identity and
  generation as source), dedupes on `(seam, goal|no-goal, subject)` so a
  repeated trigger updates the request, then attempts the ONE notice
  line against the planner binding — typed only into a live, idle,
  empty-composer planner; for absent, reused, blocked, working, unknown
  and non-empty-composer targets nothing is typed, no Escape is sent,
  and the attempt is recorded on the request (`notice.attempts`). A
  request noticed once is never re-typed. `open`/`resolve`/`dismiss`
  are the PLANNER's or USER's transitions (`pending → opened →
resolved|dismissed`; `resolve` needs the outcome — a draft, a
  promoted goal, a re-grilled spec — which the orchestrator reads back
  with `show` and never acts on automatically). `open` RETURNS the
  request it opens, so the planner gets the change and the rationale in
  the same turn it records having loaded them. Bare `/goals` renders
  `list`. `list` and `show` are the read-only pair — they never change a
  request; `open` records the opened state.

- **Executor liveness, from processes** (EVA-150): `evie-kit goals
liveness <ABC-NNN>` from anywhere in the repo — is a live agent
  process cwd'd to the goal's worktree? The probe is pgrep (anchored
  claude/codex patterns) + `lsof -d cwd`. The CLI excludes the
  CALLER's own process-ancestor chain, so it is safe from inside the
  worktree. That is what lets the /goal contract's startup self-check
  ride every launch: a fresh session verifies no live predecessor
  owns the worktree before its first write (the CED-24 duplicate
  guard).
  Deliberately NEVER herdr registry presence: the registry drops live
  executors (the CED-24 incident), while processes do not lie. Exit 0
  = the probe ANSWERED (the JSON's `status` says `live` or `none`);
  exit 2 = unanswerable — never read exit 2 as "dead", it means the
  probe could not certify either way. Record-tier: works with the
  herdr server down, which is exactly when you are diagnosing.
  Programmatic equivalent: `probeExecutorLiveness`.

- **Restart a dead executor** (EVA-150): `evie-kit goals restart
<ABC-NNN> [--mode …] [--model …] [--as <operator>] [--session <name>]
[--no-watch]` from the primary checkout — the sanctioned recovery for
  a STARTED goal whose executor died. It owns the sequence that used
  to be a manual recipe, in seven steps. (1) The liveness preflight: a
  LIVE verdict REFUSES (steer the surviving session; `evie-kit herdr
panes --processes` finds its pane). An UNANSWERABLE one refuses too —
  restart acts on death and fails closed. (2) A
  dead-but-still-registered herdr agent's pane is closed. (3) A stale
  pause marker belonging to the dead session is cleared WITH its
  citation reported; the fresh executor re-reaches the gate and
  records its own pause, and a FAILED rebuild restores the marker.
  (4) The pane + agent rebuild runs through the launch's own machinery
  — envFiles env, the descriptor's setUp()/envUp(), the EVA-33 guard,
  compaction policy, the derived legal agent name. (5) The `/goal`
  contract is regenerated by the launch's own builder from the CURRENT
  record and delivered in the verified bracket form. (6) The commit
  fence is rotated to the new executor with the ORIGINAL authorship
  base preserved, so the first executor's commits stay verified.
  (7) The lock-watch self-arms again (`--no-watch` opts out). No
  lifecycle motion: the goal is `started` before and after — no
  frontmatter edit, no tracker move, no commit. Programmatic
  equivalent: `restartGoalExecution`.

- **Re-bind a dead recorded session** (EVA-120, decision 4):
  `evie-kit goals rebind <ABC-NNN> [--session <name>] [--as <operator>]`
  from anywhere in the repo — the ONE recovery every pane verb's
  dead-session refusal names. When a goal's recorded herdr session died
  (machine reboot, `herdr server stop`), pane-touching verbs refuse
  rather than silently starting an empty session under the recorded
  name; rebind re-resolves — explicit `--session`, else the settings
  pin, else the herdr session YOU are running in — and stamps the new
  binding as a recorded act (the record keeps `reboundFrom`). It
  refuses outside herdr with nothing stated, exactly like every other
  pane verb, and it REFUSES a target session that is not running:
  stamping a dead target would just re-arm the dead-record refusal, so
  start or attach it first (`herdr session attach <name>`); rebinding
  from inside a live pane with no `--session` needs no start. For a DRAFT whose goal-review critics lost their
  session, the equivalent recovery is `goals goal-review round
--session <name>`, which re-stamps on its way into the round.

- **Pane sends that SUBMIT** (EVA-56): from the repo,
  `evie-kit herdr send [--session <name>] <pane> <text…>` types the
  text into the pane in the resolved herdr session — the pin, else the
  sender's own pane's session, else a refusal (EVA-120); the leading
  `--session` is the explicit address — and presses Enter after the
  settle (the slash-command rule). Get the pane id from
  `herdr --session <s> agent list` — executor agents are named
  `<KEY>-<slug>-cc` (EVA-48), and each row carries its `pane_id`.
  Single-line only; flags are refused rather than typed into the pane
  (text that must start with a dash goes after a literal `--`). The
  output includes a post-send `screenTail` — READ it: a message still
  sitting in the composer is what a failed Enter looks like. This is
  the orchestrator's steer channel — raw `herdr agent send` never
  submits (see `lifecycle.md`, the step-5 orchestrator note).
  Programmatic equivalent:
  `HerdrClient.typeAndSubmit`.

- **The tracker back-fill sweep** (EVA-113):
  `evie-kit goals tracker sync [<KEY>…] [--apply] [--json]` from the
  PRIMARY checkout (it reads both record surfaces — the integration
  branch's tree via `git show`, and every `.worktrees/` record). DRY-RUN
  by default: it prints the plan — per goal, the resting state its
  lifecycle implies, what the board says, and the actions that would
  close the gap (`state`, `stamp`, `assignee`) — and writes nothing
  until `--apply`. Named goals restrict the sweep (bare key or full
  folder name, POSITIONAL — a repeated `--goal` is not expressible in
  the shared flag parser, and honoring only the last of three would be
  the quiet wrong answer). Locked goals get board-only corrections;
  unlocked ones also get their `tracker_state` stamp restored and, on
  either, an EMPTY-ONLY assignee back-fill. Never blocking: rows read
  `synced` / `diverged` / `warned` / `absent`, and one unreadable issue
  degrades its own row rather than the sweep. Programmatic equivalent:
  `syncTrackerBatch` (with `scanGoalRecords` / `planTrackerSync` as its
  testable halves). `goals cleanup` runs the same sweep scoped to the
  goal it just cleaned, plan-only, on stderr (`trackerSyncAdvisoryFor`).

- **Lifecycle comments** (EVA-113):
  `evie-kit goals tracker comment --event <launch|review-round|
compaction|grill> [<KEY>] [--round results-002] [--session <path>]
[--handoff <path>] [--body-file <path>] [--force] [--json]` — run from
  the GOAL's worktree (the goal is inferred from the branch, like the
  wave verb). `launch` and `compaction` post themselves from `goals
execute` / `goals compact`; this mouth exists for the two that cannot
  (a round's findings are the executor's merge judgment, a grill session
  ends in conversation) and for re-posting one by hand. `--event grill`
  skips silently when the transcript is already in the issue's
  description. Every comment carries a marker footer, so a re-run
  reports `duplicate` rather than posting twice. Programmatic
  equivalent: `postGoalComment` plus the body builders
  (`launchCommentBody`, `reviewRoundCommentBody`, `compactionCommentBody`,
  `grillCommentBody`).

- **Post-lock cleanup** (step 8's orchestrator follow-up, EVA-33):
  `evie-kit goals cleanup <KEY>` from the primary checkout — resolves
  the bare key against mirror-path goal WORKTREES (pre-merge, the
  locked record lives only on the goal branch), refuses unless the lock
  is DURABLE (committed at HEAD, clean tracked tree, remote goal ref
  equal to local HEAD — `completed` merely written or unpushed is the
  executor's window, and closing its session then would kill the lock
  mid-flight), then strictly closes the goal's executor/reviewer
  sessions in the repo's stated herdr session, acts on the goal's
  built environment (EVA-50, between the session closes and the reap,
  MERGE-GATED; v3.0 vocabulary, EVA-53: `envStop()` — suspend — while
  the branch is unmerged, the `envDown()` + `tearDown()` destroy pair
  only once it is provably an ancestor of main, and
  skipped entirely when any session close went unconfirmed — never
  stop or destroy a stack beneath a possibly-live session; failure is
  loud but non-fatal, so an unreachable docker daemon never strands
  reviewer worktrees), and reaps their ephemeral
  reviewer worktrees (close first, reap only after confirmed teardown).
  **Old-contract degrade (EVA-77)**: a goal branch cut before the
  project's descriptor-contract migration still spells a retired
  member (`apply()`, `setup()`, …) in its own settings.ts, and the
  runtime refuses to load it — cleanup treats exactly that recognized
  contract-version mismatch as recoverable: it probes docker by the
  DERIVED worktree stack labels (toolkit key + snake variant, plus
  compose's own working-dir provenance label for stacks whose project
  name is not derivable — no descriptor load) and, when no running
  container carries them, records a visible `skipped` environment row
  naming the mismatch and branch and exits 0 so merge can proceed; a
  running stack (or an unprovable probe — fail-closed) keeps the loud
  `failed` row, now carrying the exact derived
  `docker compose -p … stop|down` / `supabase stop` commands to finish
  by hand. Any OTHER descriptor error still fails loudly, and no
  cleanup message ever suggests editing the locked branch.
  Per-resource outcomes print as JSON; any unresolved failure exits
  nonzero. Idempotent — a rerun on a cleaned goal is a no-op. It never
  touches the goal worktree, branch, or Sonar project
  (those are the merge companion steps). Programmatic equivalent:
  `cleanupLockedGoal` (with `resolveLockedGoalWorktree` /
  `assertDurableLock` as the underlying primitives; the docker probe
  is the injectable `probeStack` seam beside the
  `envDown/tearDown/envStop` lifecycle ones).
  **The reconcile hold (EVA-87)** rides this same read-only preflight:
  a merged goal whose shared-environment drift is unacknowledged
  refuses BEFORE any herdr client exists, with the detectors' exact
  commands and the clearing verb in the message. Every other reconcile
  outcome — no detectors, unmerged, undetectable — proceeds.

- **Post-merge estate reap** (EVA-103, the destructive second act after
  cleanup's bookkeeping): `evie-kit goals reap (<KEY> | --all-merged)
[--dry-run] [--rescue-to <dir>] [--remove-orphan-container a,b]
[--remove-orphan-volume a,b] [--no-orphans] [--json]` from the primary
  checkout. Execution creates a per-goal ESTATE — worktree, local
  branch, per-worktree service stack with its NAMED VOLUMES, herdr
  workspace — and before this verb, completion and merge tore down none
  of it (the pass that motivated the goal found 21 worktrees, running
  orphaned stacks, 12 idle workspaces; worktrees were ~30G on a roomy
  volume while the volumes were 56G on the small root disk). Reap is a
  SEPARATE verb from `cleanup` on purpose: cleanup is bookkeeping, reap
  destroys, and destruction gets its own safety posture. Five gates run
  before anything is touched — **locked** at HEAD, **provably merged**
  (the same `proveMerged` gate cleanup's destroy rides; unprovable is
  refused like unmerged, so a squash-merged branch is a by-hand job),
  **shared-environment hold clear** (the EVA-87 hold cleanup also runs,
  cleared by `goals reconcile <KEY> --acknowledge …` — reap deletes the
  branch ref that report resolves the merge from, so an unheld reap
  ends the drift report rather than deferring it),
  **review-round reconciled** (the latest round's INDEX must not still carry
  the `RECONCILIATION REQUIRED` placeholder AT HEAD — an uncommitted
  reconciliation dies with the worktree exactly like the per-tool
  output it describes, which is machine-local since EVA-59), and
  **content** (anything beyond gitignored build residue REFUSES, naming
  every file and printing the `--rescue-to <dir>` rerun, which copies it
  out and then reaps). Past the gates: the descriptor's `envDown()` +
  `tearDown()` (through cleanup's own hardened environment step,
  contract degrade included), the herdr workspace close, the worktree
  removal with the gitignored-residue `rm` fallback (root-owned residue
  is REPORTED, never sudo'd), and `git branch -d` — never `-D`; a branch
  git will not delete is kept and reported with the `-D` command. Output
  is a PER-COMPONENT summary (`--json` for the machine surface), because
  one total hides the volume component that actually fills the disk.
  `--all-merged` sweeps every merged goal worktree and SKIPS a refusing
  one rather than stalling, and it carries the ORPHAN report:
  containers and named volumes attributable to a goal whose worktree is
  already gone, listed with sizes and removal commands but never deleted
  without their per-target flag (EVA-49 fail-closed — volume data is
  database data). `--all-merged --dry-run` is the sized report the
  unreaped-estate advisory points at. Programmatic equivalents:
  `reapGoalEstate` / `reapAllMerged`, with `discoverOrphans`,
  `runSafetyGate` and `unreapedEstates` as the underlying primitives.

- **The locked landing** (EVA-117):
  `evie-kit goals merge <KEY> [--main-branch main] [--remote origin]
[--wait] [--wait-seconds N] [--push] [--allow-unlocked] [--catch-up]
[--dry-run] [--json]` from the primary checkout, with the integration branch
  checked out and clean. MORE than `git merge`, and that is the whole
  reason the verb exists: inside ONE landing lock it enumerates the live
  goals (named, never blocked), writes a REAL merge commit (`--no-ff`;
  a conflicted merge is ABORTED so main is never half-landed behind a
  freed lock), calls the project's `worktrees()` `onMerge` member with
  the LANDING GOAL's flags — the shared-instance migrations and type
  regeneration a consumer owns — and then runs the EVA-87 reconcile
  report. The lock is a real `flock` in the repository's common git dir,
  so a killed landing releases it; a second landing FAILS FAST naming
  the holder by goal key, and `--wait` queues behind it. Refuses an
  unlocked goal (`--allow-unlocked` is the explicit exception), a dirty
  tree, and a checkout on any other branch. Drift found afterwards does
  NOT fail the verb — the landing happened; `goals cleanup` still holds
  until it is acknowledged. `cleanup` and `reap` stay separate verbs,
  outside the lock. Programmatic equivalents: `mergeGoal`,
  `withMergeLock` / `acquireMergeLock`, `liveGoalsWithFlags`,
  `runMergeMoment`.

- **The post-merge reconcile step** (EVA-87):
  `evie-kit goals reconcile <KEY> [--main-branch main] [--remote
origin] [--acknowledge ran|deferred] [--note <text>] [--json]` from
  the primary checkout. It reads the project's `worktrees()`
  `reconcile` detectors from the PRIMARY checkout (the question is
  about MAIN's environment), proves the branch merged, derives the
  MERGE COMMIT's own diff (`<merge>^1..<merge>` — what the branch
  actually brought), matches, and prints what main now needs. It never
  runs a detector's command and never touches the shared environment.
  Exits nonzero exactly when the report HOLDS — unacknowledged drift
  with `reconcile.hold` on — so the verb's exit code and cleanup's
  refusal always agree. `--acknowledge ran|deferred` records the human
  decision (v1 cannot observe whether the commands ran, so the record
  is a declaration either way) into the common git dir, keyed by goal
  AND merge commit so a later merge is never silently covered; every
  flag TRAILS the key (`--json <KEY>` would swallow it, and refuses
  loudly). Bare-key resolution is main-first, so it works after the
  goal worktree is gone. Programmatic equivalents: `reconcileGoal`,
  `assertReconcileClear`, `detectDrift` (pure — no git, no settings),
  `readReconcileAck` / `writeReconcileAck`.

- **Environment lifecycle verbs** (EVA-50; two-axis vocabulary
  EVA-51; the compose-faithful five-member split in contract v3.0,
  EVA-53): `evie-kit goals env setup|up|stop|down|teardown <KEY>`
  from the primary checkout — the manual mouths for the environment
  descriptor's five lifecycle members (kebab/lower CLI verbs mapping
  to camelCase members: `setup`→`setUp()`, `up`→`envUp()`,
  `stop`→`envStop()`, `down`→`envDown()`, `teardown`→`tearDown()`),
  resolved against mirror-path goal worktrees (draft folder names
  resolve too — the destroy's CLI surface exists precisely for the
  abandoned-draft case cleanup cannot reach, since a draft never
  locks). `env setup` CREATES (runs `setUp()` — the files half of a
  launch, which also runs `envUp()`; pair it with `env up` for a
  descriptor that starts services there); `env up` STARTS/RESUMES the
  goal's services (`envUp()`); `env stop` SUSPENDS a parked-but-alive
  goal's environment (`envStop()`): services stopped, everything
  kept, delete NOTHING — `env up` (or the next launch's `setUp()`)
  resumes it; `env down` DESTROYS the services — compose semantics,
  volumes included (`envDown()`: `compose down -v`) — with no
  live-session check and no merge gate: a goal you may still resume
  wants `env stop`. The bare form REFUSES and teaches — destroy needs
  the trailing `--yes` (`env down <KEY> --yes`), because through
  contract v2.0 this exact verb SUSPENDED (the reversal guard;
  `teardown` stays unguarded — it always meant destroy); `env
teardown` restores the FILES half (`tearDown()`) — `env down <KEY>
--yes` plus `env teardown <KEY>` is the full manual destroy. A
  project (or goal branch) whose descriptor lacks the member is a
  clean, reported no-op; the retired `env close` verb is refused
  naming the rename chain. Programmatic equivalents:
  `setUpGoalEnvironment` / `envUpGoalEnvironment` /
  `envStopGoalEnvironment` / `envDownGoalEnvironment` /
  `tearDownGoalEnvironment`.
