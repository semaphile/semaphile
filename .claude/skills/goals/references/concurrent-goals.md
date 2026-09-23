# Concurrent goals (parallel execution)

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

Multiple goals may execute at once on one machine (EVA-11). The
mechanism makes it structurally safe; the JUDGMENT stays with the
orchestrator — the coordinating agent owns sequencing and refuses risky
overlap, the tooling gives it the information and the levers.

What makes concurrency safe (all in place, nothing to do per goal):

- **Filesystem**: every goal executes in its own worktree (EVA-8).
- **Shared infra**: the project's **environment builder** — a
  `buildWorktree` member on the committed project `settings.ts` (EVA-24,
  superseding EVA-11's `resources:` declare-and-serialize ledger;
  EVA-35 folded the standalone `.evie-kit/buildEnvironment.ts` hook
  into this settings-hosted factory — no shim, a leftover hook file
  errors loudly). One typed factory makes a worktree genuinely
  independent: `buildWorktree(ctx) => { isolated, setUp?, envUp?,
envStop?, envDown?, tearDown?, exclude?, link?, provision? }`. The
  call is CHEAP (no side effects); the lifecycle members are TWO
  AXES, five members (contract v3.0, EVA-53 — FILES `setUp`/`tearDown`
  in xUnit casing, SERVICES `envUp`/`envStop`/`envDown`
  compose-faithful; no shim, the loader's unknown-member error names
  every rename for stale v1.x/v2.x descriptors): `setUp()` = create —
  runs at launch, does the real container/DB/port work labeled with
  `ctx.key` (reap-then-create, so crashes self-heal — the same
  idempotence is what restores a suspended environment), and returns
  the env injected into the executor; `envUp()` = start/resume the
  goal's services (optional, idempotent, absent = no-op; the launch
  seam runs `setUp()` then `envUp()` when defined, and
  envStop-then-envUp resumes); `envStop()` = suspend — THE stop state:
  services stopped, everything kept, delete NOTHING (compose's
  analogue is `stop`; `supabase stop`); optional, absent = no-op, a
  clean no-op on a never-set-up environment; `envDown()` = destroy
  the SERVICES — compose semantics, volumes included (`compose down
-v`, `supabase stop --no-backup`); `tearDown()` = restore the FILES
  half. Merged-goal cleanup runs `envDown()` + `tearDown()`, in that
  order — the merge gate binds the AUTOMATIC paths (cleanup and the
  merge companion step); the manual `env down`/`env teardown` mouths
  deliberately have none.
  `ctx` provides `readSource`, `writeOverlay` (gitignored generated
  files — the source tree is never mutated), `reservePorts` (held,
  idempotent release), `portFor` (deterministic), and env/TOML helpers.
  **The one member that is NOT about this worktree** (EVA-87): the
  settings-v3 `worktrees()` config's `reconcile` — a declarative list
  of drift detectors (`{ name, paths, command, reason? }`) describing
  what the SHARED environment needs once the branch lands. It is DATA,
  never a hook: the step reports and never executes, and it reads from
  the PRIMARY checkout, because the question is about main's
  environment. Not spelled `postMerge` — git's own post-merge hook is a
  different thing. See "The post-merge reconcile step" in
  `lifecycle.md` step 8 and `docs/adr/0016-reconcile-detect-and-tell.md`.
  The `buildWorktree` surface never grew the member (its deprecation
  grace window is running); declaring it there refuses with that
  pointer.
  **Inverted signal**: `isolated: true` is the project ASSERTING
  worktrees are independent — that assertion, not a ledger, is what
  unlocks parallelism. A project with no `buildWorktree` member is
  `{ isolated: false }` = no assertion (setup no longer scaffolds a
  stub at all — absence IS the default). All-or-nothing: assert only
  when the worktree is FULLY independent.
- **Agent names**: executor and reviewer names carry the goal FOLDER
  NAME (`<KEY>-<slug>-cc`, `<KEY>-<slug>-cc-review`, … — EVA-48,
  extending EVA-9's key-only scheme: the key still prevents collisions
  in herdr's server-global namespace; the slug makes `herdr agent list`
  say what each goal is ABOUT), and a wave's tab sweep only ever
  matches its own goal's labels — BOTH shapes during a deploy window
  (sweep, cleanup, and liveness matchers recognize the pre-EVA-48
  `<KEY>-<code>` shape too, so an executor launched under the old
  naming is never stranded). Each executor keeps ONE workspace (its own
  tabs), labeled with the goal folder name itself so the herdr UI
  answers "what is this goal about" at a glance.
- **SonarQube**: every wave scans into the ephemeral per-branch
  project `<baseKey>-<branch>` (auto-created on first scan), so
  concurrent scans cannot clobber each other and each wave's verdict
  is provably against its own tree. The authoritative base project is
  only ever scanned from main, post-merge, outside the wave path.
- **Waves**: fully concurrent across goals — reviewers, watchers, and
  completion detection are all goal-scoped. The wayfinder
  one-loop-at-a-time rule is unchanged and PER MAP, not global: one
  map's work stays serial, but goals from different maps (or mapless
  goals) may overlap.

What needs judgment (the orchestrator's contract):

- **Launch**: when the project's environment hook does NOT assert
  isolation (`NOT_ISOLATED` — the no-op stub, or no hook at all),
  `startGoalExecution` refuses to launch while ANY other goal is
  executing (discovery: worktrees at the mirror path with a started
  GOAL.md, enriched by herdr session liveness — no registry file).
  Overriding (`overrideUnisolatedLaunch: true`; CLI:
  `--override-unisolated-launch`, EVA-46) is the
  user's/orchestrator's explicit call. A project asserting
  `isolated: true` overlaps freely — the hook's isolation is what makes
  that safe. Launches, like merges, are **orchestrator-serialized** —
  one `startGoalExecution` at a time: the check closes mistakes, not
  races (two launches passing the check simultaneously would each miss
  the other, since neither is `started` yet). Discovery is
  convention-based: a goal started at a custom `worktreePath` (off the
  mirror path) is invisible to it — an unisolated project refuses a
  custom path outright.
- **Merges are serialized**: locked goals merge to main ONE AT A TIME —
  never two landings racing. Since EVA-117 that is MECHANIZED, not just
  sequenced by whoever is driving: `evie-kit goals merge <KEY>` takes a
  LANDING LOCK (a real `flock` on a file in the repository's common git
  dir, so a killed landing releases it with no stale marker) and holds
  it across the whole window the shared environment is inconsistent —
  the real merge commit, the project's own `onMerge` catch-up
  (shared-instance migrations, type regeneration), the EVA-87
  reconcile report, and (when asked) the `--push` publish, in that
  order — the publish is the one network call inside the lock, and a
  push-only failure is reported as exactly that, with a retried push
  (never `--catch-up`) as the prescription. A second landing FAILS FAST naming
  the holder by goal key; `--wait` queues behind it. A landing that
  fails AFTER its merge commit is recovered with
  `evie-kit goals merge <KEY> --catch-up`, which re-drives the
  post-merge half — the `onMerge` catch-up and the reconcile report —
  against the existing merge commit; until it is caught up, other
  goals' landings refuse on the recorded incomplete landing. The verb
  ORDERS the
  reconcile step inside the lock rather than replacing it — its
  acknowledge machinery is still where a human's decision is recorded —
  and `cleanup`/`reap` stay separate verbs outside the lock. The window
  matters because it is where the EVA-70 incident lived: main's code had
  moved and main's database had not.

  With two operators on one machine this replaces the social form of the
  same rule ("only the primary session handles merges") — there is
  deliberately no operator gating, because the lock IS the policy.

  Live goals reading a shared resource are named in the landing's
  output, never blocked: drift is a stated property of choosing a shared
  strategy, and blocking would hand any open branch a veto over main.

  If a merge required conflict resolution, that resolution happened
  AFTER the goal's review wave — so before pushing, re-verify on the
  merge result: workspace tests + a fresh scan. (`goals merge` ABORTS a
  conflicted merge rather than leaving main half-landed behind a
  released lock, so conflict resolution is a deliberate by-hand step.) A
  conflict-free merge (still a REAL merge commit — fast-forwards are
  never used, per the directory-conventions section) needs no
  re-verification.

- **Soft contention** (model throughput, CodeRabbit tier limits, user
  attention) is self-regulating and deliberately untooled — just be
  aware that N concurrent waves multiply reviewer load.
