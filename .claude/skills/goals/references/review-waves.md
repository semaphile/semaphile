# Review waves: mechanics, configuration, driver

Operational detail behind lifecycle step 7's summary. Read this in full
before running, monitoring, or debugging a blind review wave, and when
touching the `.evie-kit/settings.*` review configuration. The INDEX.md
format the wave generates is in `references/templates.md`.

## How a wave runs

The **executing session itself** spawns the reviewers, via herdr — the
only wired path; an executor outside a herdr pane must pass a workspace
explicitly or the wave fails fast (a tmux fallback stays deferred, see
`references/non-goals.md`). Each reviewer runs as a **labeled tab in the
executing session's own herdr workspace** (`ABC-9-some-slug-cc-review`,
`ABC-9-some-slug-cd-review`, … — the per-goal naming contract below) —
never a new workspace, never pane splits. The wave resolves that workspace
from the caller (explicit option or `HERDR_WORKSPACE_ID`) and throws
rather than silently creating one.

## The per-goal naming contract

herdr agent names are **server-global**, so every goal-scoped agent name
is prefixed with the goal FOLDER NAME — `<KEY>-<slug>` (EVA-48,
extending EVA-9's key-only prefix: the key still guarantees uniqueness;
the slug makes `herdr agent list` say what each goal is ABOUT):

- Reviewers: `<KEY>-<slug>-cc-review`, `<KEY>-<slug>-cd-review`,
  `<KEY>-<slug>-sq-review`, `<KEY>-<slug>-cr-review` (cc=claude-code,
  cd=codex, sq=sonarqube, cr=coderabbit) —
  `reviewerTabLabel(goalName, tool)`.
- The executor session itself: `<KEY>-<slug>-cc` —
  `executorAgentName(goalName)`, applied by `startGoalExecution`, which
  also labels the executor's dedicated WORKSPACE with the goal folder
  name itself (the herdr UI answers "what is this goal about" at a
  glance).
- Reviewer tab labels equal agent names (the tabs are created with the
  label). The executor's own workspace-initial tab is different: it is
  best-effort renamed to the agent command (`claude`/`codex`) after a
  successful launch — cosmetic, not a guarantee to build logic on.
- **Transition tolerance** (EVA-48): the sweep, `goals cleanup`, and
  running-goal liveness all match BOTH shapes — the current
  `<KEY>-<slug>-<code>` names and the pre-EVA-48 `<KEY>-<code>` ones.
  External matchers call the exported combiners
  `reviewerTabMatchLabels(goalName, tool)` /
  `executorAgentMatchNames(goalName)` (new shape first) rather than
  rebuilding the union from `legacyReviewerTabLabel` /
  `legacyExecutorAgentName` (matcher input only). Launches only ever
  mint the new shape — the canonical helpers REFUSE a bare issue key —
  and containers re-found under a legacy label (reused headless tabs,
  nudged critics) are best-effort relabeled to the new shape so the
  deploy window actually closes.

With unique per-goal names, `agent_name_taken` across goals is
structurally impossible, and concurrent goals run waves in parallel
(the full concurrency contract — sonar isolation, `buildWorktree`
environment isolation, merge serialization — is in
`references/concurrent-goals.md`). The wave derives the goal name
from its `goalRoot` basename and therefore only runs for promoted
goal folders (`ABC-NNN-slug`); a
driver that names its interactive reviewer sessions anything other than
`reviewerTabLabel(goalName, tool)` breaks the sweep — copy a prior
goal's driver rather than improvising.

Reviews run **concurrently and blind** (sequential reviewing would let
the second reviewer anchor on the first's findings), but tab setup
itself is serial — herdr spawns unfocused tabs' terminals lazily, and
interleaving two setups can lose typed input. Goal delivery is verified
before any resend.

**Interactive reviewers review their own worktrees (EVA-16, from
NE-213)**: at setup each cc/codex reviewer gets an ephemeral
`git worktree` of the checkout's HEAD — the SAME commit, so blindness
is preserved — with `bun install` run when the tree has a lockfile
(~0.9s per reviewer, measured), removed unconditionally at wave end.
One reviewer's build can no longer tear state under another's analysis
and feed a FALSE "build broken" finding into blind reconciliation.
Headless tools stay on the shared tree (sonar's workdir is off-repo;
coderabbit reads the diff). Drivers can opt out with
`interactiveIsolation: "shared"`. Belt-and-braces, every reviewer
prompt also carries a working-tree-discipline clause
(`buildReviewerPrompt`): no watch modes or servers, prefer typecheck
over full builds, re-run surprising build/artifact state once before
reporting it as a finding.

**Launch-phase spawn retry (EVA-16)**: the codex spawn race is
recurring (EVA-10, EVA-15 round 1) — `agent_not_found` when the tab
vanishes between `agent start` and the first wait. An interactive
launch that dies with a `*_not_found` error gets ONE automatic retry
with a fresh tab; each attempt's evidence (error + the pane's last
screen, captured before the failed tab closes) lands in the tool dir
as `launch-failure-<n>.txt`. Launch-infrastructure retry is not
absorption — a reviewer that fails after a clean launch still fails
the wave.

**Completion detection**, per tool kind:

- Interactive TUIs (Claude Code, Codex): agent-state polling with
  debounced blocked/stalled classification plus a FINDINGS.md
  completion marker — some TUIs settle to `idle` without ever reporting
  `done`; herdr's blocking `wait agent-status` remains available via
  `AgentSession.waitForState`.
- Headless tools (SonarQube, CodeRabbit): the `.done`/`.failed` file
  channel. They stream full output live into their tab (tee semantics —
  the tab is the observability surface).

**CodeRabbit legs preflight the CLI's flag surface (EVA-44)**: the
CodeRabbit CLI self-updates, so its argument surface can drift between
waves (0.7.x dropped `--plain` and replaced `--type <kind>` with
`--committed`/`--uncommitted`, which killed every coderabbit leg at
argument parsing for six days — NE-236/238/252, EVA-41/42). The
leg's first act is `coderabbit review --help`: every
flag the REVIEW invocation is about to emit must appear there, and a
miss fails THAT LEG
up front with a version-drift message naming the missing flag — the
other reviewers proceed, and the round still reports `ok: false`. The
one carve-out is the auxiliary `--show-prompts` capture flag: its
absence only skips the prompt capture with a `.prompts-failed` note
while the review completes normally (EVA-31: capture can never veto a
completed review). The
manual-rerun templates consumer repos accumulated for the 0.7.x drift
(`rerun-manual.sh`, review-round caveats) are obsolete once this
library version is pulled.

**SonarQube scans are per-branch isolated (EVA-11)**: the reviewer
derives the checkout's branch at run time and scans into the ephemeral
project `<projectKey>-<branch>` (sanitized, hash-disambiguated when
sanitizing was lossy; auto-created on first scan), fetching its verdict
from that same project — the configured `projectKey` is only the BASE.
A sonar scan replaces the target project's snapshot, so this is what
makes concurrent waves' verdicts independent. The reviewer also WAITS
for the server's asynchronous compute task before reading issues
(scanner exit only means the report uploaded; fetching earlier returns
the PREVIOUS analysis — observed live in EVA-11's first gate round, and
the reason FINDINGS.md pins the compute-task id). Two consequences for
reconciliation: ephemeral projects start FRESH and do not inherit the
base board's issue resolutions, so expect resolved/Accepted items to
resurface — judge sonar findings against the goal's own diff, never
the project-wide OPEN count. Since EVA-57 the reviewer does that
partition itself: fetched issues (paged until the server-reported
total is collected, capped at the server's 10k `issues.search`
window — a truncated fetch says so in the summary line) are split
against the goal's diff base
(`stacked_on` ?? main, the wave's resolved base) into an
`## In this goal's diff (N)` section that leads FINDINGS.md and a
labeled `## Preexisting (not this goal) (M)` section — listed, never
dropped — with BOTH counts in the summary line, so a wave can never
silently hide a real regression. INDEX reconciliation triages only
the in-diff set; the preexisting list is the debt burn-down feed. Two
caveats the findings header also carries: rules anchored on an
unchanged line of a changed file (function-scoped rules like
cognitive complexity) sort as preexisting but are tagged
`[changed file; line outside this goal's hunks]` — look before
dismissing; and a dirty scanned tree prints a loud WARNING (the scan
reads the working tree, the partition reads commits). The sonar tool
dir records two extra round artifacts: `diff-context.json` (the
changed files + new-side hunk ranges the verdict used — replayable)
and `partition.mjs` (the generated, self-contained partition script) —
machine-local like the rest of the per-tool dir (EVA-59).
The ephemeral project is deleted at merge
cleanup (`deleteSonarBranchProject`, alongside
`removeMergedGoalWorktree`), and the merge's third companion step
refreshes the authoritative board with a fresh scan from the main
checkout — the base project is never scanned from a goal branch.

The **executing** session is the one that must know when reviews are
done — it's gating its own completion on this — not just the
orchestrator.

**Watching for a reviewer tab from OUTSIDE the driver** (an
orchestrator or a shell watcher): use `@evie-kit/herdr`'s
`waitForAgent(client, reviewerTabLabel(goalName, "codex"), { ceiling })`
(the `<KEY>-<slug>-cd-review` shape) — never a hand-rolled
`until herdr agent list | grep …; do sleep …; done` loop. Watchers are
NOT covered by the transition matchers — `waitForAgent` matches the
literal you pass — so watching a session launched before the EVA-48
deploy means waiting on its `legacyReviewerTabLabel(goalKey, tool)`
name explicitly.
Unbounded watchers spun for 29 minutes on a wedged spawn (EVA-20,
trellis TRLS-8: `agent list` answers in ~5ms, the agent was simply
absent). On the ceiling the helper returns an `absent` sentinel; treat
it as that reviewer's recorded failure and proceed, per the
never-absorbed rule.

## Failure and skip semantics (enabled-only, EVA-11)

A reviewer that crashes or stalls is **reported as a failure of that
wave**, never silently absorbed. Each reviewer gets a generous
backstop timeout (default 120m), but catch failures far earlier via
agent-state awareness — in particular a reviewer blocked waiting for
user input, a real failure mode for interactive tools that headless
ones don't share. Review prompts must instruct interactive reviewers to
never block on questions (`buildReviewerPrompt` does).

**Per-reviewer stall detection (EVA-16, from EVA-11's round-2 wedge —
CodeRabbit sat 40+ minutes with only the backstop watching)**: every
reviewer's screen/pane output is re-read each poll; output frozen past
the threshold (default 10 minutes, `review.stallTimeoutMinutes`)
records a loud per-tool `stalled` outcome while the wave continues
with the remaining tools. Thresholds are per-tool aware: settings
`tools.review.<tool>.stallTimeoutMinutes` beats the reviewer
implementation's own declared threshold beats the wave level.
CodeRabbitReviewer declares a 60-minute threshold — its piped
plain-text output (the CLI's default mode since 0.7.x) is legitimately
silent during remote analysis, and
manufacturing synthetic pane progress would defeat the detector
(EVA-16 round-2 blocker), so for that tool the backstop is the wedge
guard. A reviewer that ends `stalled`/`timeout`/`blocked` is STOPPED
at wave end regardless of `tabCleanup` — its process is still live,
and a late completion write would contradict the recorded outcome in
the wave artifacts (final screen is captured first).

**Prompt-parked reviewers are classified, and two prompts are
auto-answered (EVA-157)**. A FROZEN screen showing an interactive
prompt is a parked process, not a slow one. The completion loop
classifies it within two polls as a loud `stalled` outcome naming the
prompt. It is never an absent/unconfigured engine, and never a sleep
to the stall threshold or the wave ceiling. (Friction #11/#28/#10: a codex
reviewer sat hours at its trust dialog while the round read it as
roster-narrowed.) The classification runs BEFORE goal delivery too:
the review instruction is never typed into a boot menu. A TINY
HARDCODED allowlist is answered once and logged loudly into the round
record (`.prompt-answered` → an INDEX note). Its two shapes, grilled
and deliberately not settings-extensible: the codex self-updater →
Skip (keeps the pinned version), and the directory-trust dialog →
approve. The approval is legitimate only because the harness itself
created the worktree the reviewer runs in. Every other prompt — and a
prompt that persists after its one answer — surfaces as a stall
demanding intervention. Codex sessions additionally PRE-TRUST their
launch cwd: a marker-tagged `projects` entry in the codex config the
launch env resolves, pruned when the reviewer worktree is removed
(`preTrust: false` opts a session out). The trust dialog should
therefore not appear at all; the auto-answer is the backstop.
Interactive legs also write a durable `.failed` on any non-completed
end (the headless EXIT-trap twin). And a persistently unreadable agent
state fails fast as a dead process instead of resetting the debounce
streaks.

**Recovering a prompt-killed leg — stay in the pane.** When a leg
still dies at a prompt (a shape outside the allowlist, or a dead
process found at the ceiling), the recovery is INTERACTIVE. Close the
dead session's tab. Confirm the ephemeral checkout is pre-trusted, or
answer the dialog by hand in the relaunched pane. Then relaunch the
scoped reviewer as a herdr tab — a scoped re-run round
(`goals review --engines <tool>`) is the sanctioned spelling. The
multiplexer wave exists FOR the pane: the live transcript, the screen
capture, and steerability are the evidence chain. Headless
`codex exec` is at most a recorded LAST RESORT. It trades all three
away, and a round recovered that way must say so in its INDEX — the
LFW-1 workaround is the anti-pattern this rule records, per the goal
spec.

**The between-waves sweep tolerates vanished tabs (EVA-16, the EVA-12
TOCTOU)**: a tab that closes between `tabList` and `tabClose` is the
benign already-swept state; a LIVE tab that refuses to close fails
only that tool's reviewer (the wedged tab still holds its
server-global agent name) and the wave continues.

**Headless legs execute through the run-engine verb (EVA-157)**. The
per-engine generated `run.sh` (and its off-repo secrets env file) is
gone. Each headless reviewer's `run()` records the per-round state as
a `leg.json` DATA sidecar in the tool dir — machine-local like the
rest of the per-tool dir (EVA-59). It then types the verb into the
pane with ABSOLUTE paths:
`bun <checkout>/node_modules/@evie-kit/cli/src/evie-kit.ts goals
review run-engine --tool-dir <abs dir>`. That process resolves
credentials from the layered settings itself and anchors to the tool
dir, never the pane shell's wandering cwd (the EVA-16 rule kept). It
streams child output live and reports through the same
`.done`/`.failed` + completion-marker channel the wave has always
polled. Locked goals' committed `run.sh` files are historical
artifacts — never re-run them.

Which tools are in a wave is decided by DEFINITION, not a `required`
flag (that key is gone — its presence in any settings layer errors at
load, naming the file):

- A tool whose settings block is **defined** in some layer AND staged
  for `results` (its `stages` field; omitted = results-only, EVA-30)
  is part of waves and enabled — defining the block declares the
  machine has it. A tool staged `[goal]` only belongs to the
  pre-promotion critique loop (`goal-reviews.md`), never a wave.
- A defined-and-enabled tool that turns out **unavailable** on THIS
  machine — probe failed, binary missing, or ANY key knocked out by an
  unresolved `${ENV_VAR}` — is **skipped with its reason recorded**
  in the INDEX row (EVA-228), WHATEVER its declared stages: the wave
  runs the remaining reviewers, never runs the tool on a different
  model/scope/base than declared, and the skip still counts as missing
  against any gate that names the engine by roster (a four-engine
  gate is not met by three engines and a skip). ONE shape still
  refuses up front: a knockout inside `stages` itself, because the
  unresolved element is dropped and the tool leaves the round's roster
  with no row left to record the skip (`assertNoEnabledKnockouts`
  keeps that refusal and announces every other knockout as a skip
  before the round starts; the wave's own `unavailable` option carries
  the reason into the INDEX row). A wave whose every reviewer is
  unavailable still refuses to run — nothing ran, so nothing can pass.
- `enabled: false` on a defined block is the explicit temporary
  off-switch: a recorded, visible **`skipped`** outcome; the tool is
  never probed and its tab never spawns. This is the ONLY skip path
  a human chooses.
- The Sonar leg has one more recorded outcome (EVA-209, decision 10):
  **`temporarily-skipped`**, for an OUTAGE-class failure: server
  unreachable, auth endpoint down, a request timeout, or a compute-task
  WAIT timeout. At preflight or mid-leg, the leg drops `.outage`. It
  does NOT fail the round. It is retried on every subsequent round,
  including when the next round's preflight fails again, and the round's
  `ROUND.json` records it. It BLOCKS THE LOCK until valid `passed`
  evidence for the head or a recorded user waiver exists (`evie-kit lint
eligibility`). A terminal compute failure, a scanner or
  configuration error, a malformed or incomplete issue set, and real
  in-diff findings are NOT outages: `failed`, as before.
- An **undefined** (or results-unstaged) tool is simply not part of
  the wave. Drivers pass
  `definedTools` — the STAGE-SCOPED view,
  `definedReviewTools(settings, "results")` — and the wave ENFORCES
  coverage:
  every tool in it must have a reviewer (pass it even when
  `enabled: false` so the skip is recorded) — a driver cannot silently
  shrink the gate. INDEX.md then records absent tools as
  `not-configured` (provably no settings block staged for this
  round), or `not-in-wave`
  when the wave wasn't given `definedTools` (e.g. a deliberately
  scoped diagnostic wave like EVA-11's isolation demo).

The committed project layer defines the tools every contributor
running a gate wave is guaranteed to have; machines with more define
the rest in their personal machine-local layer — the generated
`.evie-kit/credentials.ts` on TS-native repos
(EVA-37, renamed in EVA-38), or the legacy `settings.local.yaml`
through its deprecation grace window.

## Tab lifecycle between waves

A completed wave's tabs stay open for reconciliation (scrollback
intact); the NEXT wave's setup sweeps them — interactive tabs closed
and recreated (never reused: blindness), headless tabs reusable in
place. `review.tabCleanup: keep | close | prompt` configures what
happens after a wave. Note that reviewer WORKTREES are removed at
wave end regardless of `tabCleanup` (EVA-16): a kept interactive tab
survives with its cwd deleted, so it is a scrollback/interrogation
transcript, not a live workspace — reconciliation evidence comes from
the wave dir (FINDINGS.md, screen.txt), never the reviewer's tree.
The codex reviewer additionally needs the goal's `reviews/` dir as a
sandbox `writableRoots` entry (see the driver): its `workspace-write`
sandbox is scoped to the ephemeral worktree, and without the extra
root it cannot write FINDINGS.md back into the executor tree (round-1
gate failure, EVA-16).

The sweep matches only THIS goal's labels: another goal's kept reviewer
tabs carry another key and are never touched — closing them could kill
a LIVE parallel wave. They are harmless clutter until that goal's
merge-time worktree removal. (History: before per-goal names — EVA-9 —
reviewer names were the shared `claude-code-review`/`codex-review`, and
a prior goal's kept tabs would `agent_name_taken`-kill the next round;
this bit EVA-6's first round and needed a manual preflight. Per-goal
keys make that collision structurally impossible.)

## Blindness contract

Reviewers are blind to each other **and** to the executing agent's own
narrative — they see the change and the goal spec, not `RESULT.md` or
another reviewer's findings. The ONE `results/` file reviewers DO read
is the gate-evidence receipts (`results/GATES.md`, EVA-79): factual
command receipts the reviewer prompt links with calibrated trust —
coherence checks, cheap spot-reruns only, never launching services —
deliberately shared because verifying that the goal's gates actually
ran is part of the review; the executor's narrative stays out of
sight. The carve-out is bounded to the ENTRY FIELDS — for a run:
command, exit code, headline, timestamp, tested commit; for a waiver:
gate name, status, evidence pointer. Prose an executor writes around
them is context, not evidence, and the prompt tells reviewers not to
let it shape the review — otherwise the one authorized channel becomes
a narrative back door. The sharpest edge of that rule: a receipts file
must never SUMMARIZE what an earlier round found (a pointer to the
round's INDEX is the whole answer), because reviewers are blind to
prior rounds and this is the one file inside `results/` they open.

**Only interactive reviewers audit gates.** The contract rides
`buildReviewerPrompt`, which Claude Code and Codex receive and the
headless engines never do — sonar and CodeRabbit scan code and have
no notion of `results/GATES.md`. A wave whose roster is headless-only
therefore proves nothing about whether the gates ran, and its INDEX
says exactly that (**NO GATE AUDIT IN THIS WAVE**) rather than asking
for a posture roll-up nobody could have produced. When gate evidence
needs auditing, the roster needs an interactive reviewer. Findings merge afterward into the wave's
`INDEX.md`, which the executing session reconciles by its own judgment
(no union-is-blocking, no vote threshold — the point of multi-tool
blind review is surfacing more candidate issues than one reviewer
alone would catch, not algorithmic consensus). Multiple waves are
supported — indexed `reviews/results-NNN/` folders (see Folder naming
below), per-reviewer
provenance recorded in each INDEX.md.

## Sonar close-out: every finding gets a disposition (EVA-111)

A wave that ends with Sonar findings merely _noted_ leaves them OPEN on
the server forever. Waves scope to each goal's own diff, so a
pre-existing issue never re-enters any later wave; round-capped waves
deliberately stop with surfaced-but-deprioritized findings unresolved;
and nothing else in the lifecycle ever touches the server. Those three
facts compound into a pool that only grows and that mixes real debt
with false positives — measured at 78 OPEN issues when EVA-111 burned
it down, of which 22 were a deliberate compile-time contract gate
nobody could tell apart from debt without reading the file.

**The rule, at INDEX reconciliation:** every Sonar finding the round
raised ends in exactly one of three states, and never in a fourth.

1. **Fixed** — the code changed; the next scan closes it. Always the
   preferred answer.
2. **Accepted** on the server (`accept` transition) — the finding is
   acknowledged and the code stays AS IT IS FOR NOW. Requires a comment
   carrying **this goal's key** and the reason. Acceptance covers two
   different situations, and the comment must say WHICH:
   - **deliberate** — the code is right and is not going to change; the
     reason is one the code itself already justifies (a linter
     suggestion that would change behavior, a complexity that IS the
     domain).
   - **tracked debt** — the finding is real but out of this goal's
     scope, and a follow-up issue now carries the fix. The comment
     names that issue key.

   Both are the same server state because Sonar HAS no other one: its
   resolutions are Fixed, False-positive, and Accepted, and there is no
   "deferred" transition to reach. So the tracker carries the SCHEDULE
   and the server carries the ACKNOWLEDGMENT — which is the honest
   division, as long as the comment distinguishes the two cases. What
   the state must never do is launder real debt as deliberate design:
   an acceptance with no key and no justification the code supports is
   the failure this rule exists to catch.

3. **False-positive** on the server (`falsepositive` transition) — the
   rule mis-read the code. Same comment requirement.

"Deprioritized", "noted", and "next time" are not dispositions.

**A real finding that is out of this goal's scope takes state 2's
tracked-debt form — it does not get a fourth state.** Open the follow-up
issue first, then mark the Sonar finding **Accepted** with a comment
naming that issue key ("deferred to ABC-42: <one line of why it is out
of this goal's scope>"), and record BOTH the key and the marking in the
round's INDEX. The work stays tracked where work is tracked, and the finding
stops being an OPEN issue that a later reader has to re-triage. A
deferred finding left OPEN is the exact shape that grew the pool this
rule exists to drain, and an INDEX line naming a follow-up without the
key is not a disposition either — nobody can find what it defers to.

**Prefer durable dispositions to per-issue ones.** A per-issue marking
lives in ONE Sonar project, and each goal branch scans into its own
(`<projectKey>-<branch>`), so a marking made during a wave does not
survive into the pool of record. In order:

- a **fix** travels with the code;
- a **rule-scoped exclusion** in `sonar-project.properties`
  (`sonar.issue.ignore.multicriteria`, rule + file — never a blanket
  file exclusion) travels with the repo and covers every future scan,
  which is the right shape when a whole class of finding on one file is
  by design;
- a **per-issue accept/FP marking** is the one-off, and because it is
  project-local its rationale is ALSO recorded in the round's INDEX, so
  the pool of record can be re-marked from the goal record after merge.

The API is two calls per issue, both `POST`, against
`<server>/api/issues` with the token as the basic-auth username:
`add_comment` (`issue`, `text`) then `do_transition` (`issue`,
`transition` = `accept` | `falsepositive`).

**Which server URL and token, exactly.** They are the ones the project's
`tools.review.sonarqube` block resolves — the same pair the reviewer
passes to the scanner. The two consumers spell them differently and BOTH
spellings are live: `sonar-scanner` reads `SONAR_HOST_URL` /
`SONAR_TOKEN` (what the reviewer's leg exec passes in the scanner's
child env and what
`sonar-project.properties` documents), while a repo's own shell profile
may export its own names — this checkout uses `SONARQUBE_URL` /
`SONARQUBE_TOKEN`. Read the settings block, or export the pair yourself,
rather than assuming a close-out shell already carries either name.
Never expand the token into anything that lands in a committed record —
GATES.md entries name the variable, not its value.

## Configurable mechanisms (settings surface)

Per-tool review config lives at **`tools.review.<tool>`** (EVA-19
reshape — everything under `tools.*` is a capability with an engine
behind it; the pre-reshape `review.tools.*` errors loudly at load,
naming the file): definition = availability declaration, `enabled`,
credentials, model, effort/reasoning, extra args, tool-specific keys
like sonar `projectKey` and codex `reasoningSummary` (EVA-58 —
`auto | concise | detailed | none`; setup scaffolds `detailed` so
reviewer panes show reasoning summaries, `none` turns them off), and
`stages` (EVA-30) — the review-round
kinds this engine participates in, e.g. `stages: [goal, results]`.
Omitted means **results-only** (existing configs keep gating exactly
the blind waves they always did; goal-round participation is an
explicit opt-in), an unknown stage fails the schema loudly, and the
results roster is the defined tools staged for `results`
(`definedReviewTools(settings, "results")` — a tool staged
`[goal]` only is not part of gate waves).

**Named engine instances (EVA-121).** `tools.review` map keys are
INSTANCE names: a block's `kind` names the implementation
(`claude-code | codex | sonarqube | coderabbit | impeccable-detect`),
defaulting to the key — the four historical entries never state it,
while `impeccable: { kind: "claude-code", prompt, model, effort }`
declares a SECOND claude-code-backed reviewer with its own lens. The
field is `kind`, not `engine` ("engine" stays the word for roster
entries — grill Q7). Instance names are letter-led lowercase kebab
(they become EVA-48 tab labels, `review.engines.*` entries, and
frontmatter keys). Per-instance keys beyond the kind's own: `prompt`
(engine-specific instructions appended to the generated blind-review
prompt — the invariant contract always wins a conflict), `env`
(extra session environment — flags and toggles, never secrets),
`skills` (the scope knob, generalizing EVA-20's codex scope-args:
codex defaults `none`, claude-code defaults `inherit`; `none` on a
claude-code instance denies the Skill tool), and `paths` — the
PATH-CONDITIONAL staging guard: a guarded instance auto-includes in
results rounds only when the goal's diff touches a matching path
(the strict `pathPatterns` glob subset; no `**`). An auto-exclusion
is a layer-accurate `paths` INDEX row plus a wave note. Only a
per-round `--engines` mention bypasses the guard; a frontmatter
engines list does NOT — a recorded plan's roster is the round's
default shape, not a guard bypass (`goals plan --accept` records
every staged instance, so treating frontmatter as explicit would
turn accepting a plan into permanently disabling every guard it
recorded). Every
finding, from every engine, targets the shared CORE shape (engine,
severity, location, summary, recommendation — `reviewFinding.ts`);
specialist richness rides a namespaced **Extensions:** label
reconciliation ignores and humans read. The impeccable lanes ride
this surface: `impeccable-detect` (its own deterministic engine row —
the vendored 59-rule detector over the diff's files, DEGRADED = a
FAILED scan, advisory-FLAG findings non-blocking) and an `impeccable`
claude-code instance whose canonical evaluate-only prompt ships as
`IMPECCABLE_AUDIT_PROMPT` (+ `IMPECCABLE_HERMETIC_ENV`) from
`@evie-kit/goals` — never patch the vendored
`.claude/skills/impeccable/` tree (`docs/vendored/impeccable/VENDOR.md`).

**The writing-style panel row (EVA-133).** The prose counterpart: a
`writing-style-panel` kind is the panel's DETERMINISTIC instruments
(sentence caps and rhythm, the humanizer lint, the protected-term loss
check against the merge base) over the diff's prose files. Findings
only, in the core shape, its own engine row like `impeccable-detect`.
Its keys: `rules` (a panel rules file, repo-relative), `protectedTerms`
(an additive instance override), `extensions` (default `.md`/`.mdx`/
`.markdown`), `nits`; `paths` scopes the scan. Protected terms UNION
across the instance block and the verb's `tools.writingStylePanel.
protectedTerms`; the settings.local layer is the home for client
identifiers, since a committed list would leak. The wave's
`tools.humanizer` calibration is pinned into the scan, so the row and
the verb count under the same rules. It runs under bun,
resolving `@evie-kit/writing-style-panel` from the checkout, so a
missing bun is a FAILED lane and no changed prose file is clean by
construction. Goal records (`goals/**`) are never scanned — internal
records are the calibration corpus, not a gate. The LLM flagger lane
is a claude-code instance carrying `WRITING_STYLE_PANEL_AUDIT_PROMPT`
from `@evie-kit/goals` (audit-not-critique: it flags, never rewrites
— there is no desk in a wave). The full panel (blind lanes, the human
merge desk, apply) is the standalone verb, `evie-kit
writing-style-panel run`, documented in the `writing-style-panel`
skill; the engine row stages the same `scan` core.

Wave DIRECTIVES stay in the `review:` block —
`review.tabCleanup`, `review.stallTimeoutMinutes` (per-reviewer stall
threshold, EVA-16; unset = 10 minutes), and the **round-budget policy**
(EVA-45): `review.rounds.{goal,results}.{soft,hard}` and
`review.engines.{goal,results}`. Defaults `results { soft: 4, hard: 8 }`
— today's waves are unchanged until round 5, where the soft advisory
prints (results waves DO earn 3–4 rounds, EVA-40; past the soft cap,
stop deliberately and record the stopping decision) — and round 9 is
the first refusal. The three-layer precedence chain is settings →
GOAL.md frontmatter (`review:` subtree mirroring this exact shape) →
CLI flags (`goals review --soft-cap N --hard-cap N --engines a,b`),
most specific wins per leaf; the hard cap's escapes are a committed
frontmatter edit or the explicit flag. The per-kind `engines` list
NARROWS the stages-derived roster (it selects among DEFINED tools
staged for the kind — it can never resurrect an undefined or unstaged
tool; both error loudly for explicit lists), and a roster narrowed by
frontmatter/CLI renders a **ROSTER NARROWED** banner in the round's
INDEX naming the excluded engines and the excluding layer — the gate
never shrinks silently. See `goal-reviews.md` ("Round budget") for the
goal-kind defaults and the full policy rationale. The ADHD axes
(`adhd.branchExecution: multiplexer` with `adhd.multiplexer: herdr` /
`adhd.layout: tabs | panes`, or `adhd.branchExecution:
local-subagents`) keep their own directive block. The same `tools.*`
namespace carries the grounding/research capabilities (`tools.memory.*`
recall sources, `tools.research.exa`, `tools.notion`,
`tools.tracker.{linear,github}`)
and `storage:`/`research:` directives — one layered settings surface,
mirroring Claude Code's own structure. **`tools.herdr`** (EVA-20)
carries the repo's herdr binding: `session` (which herdr session every
goals-machinery client binds; the literal `default` is the explicit
shared-socket opt-in), `agentStartTimeoutMs` (spawn-RPC bound,
default 60s) and `shellReadyTimeoutMs` (EVA-88 — how long a herdr
≥0.7.5 launch waits for the target pane's SHELL to finish initializing
before typing the agent into it, default 60s; raise it only for a tree
whose direnv/mise startup is genuinely slow, since expiry refuses by
NAMING what was still running; the bound spans the whole launch
INCLUDING the `agent_pane_busy` backoffs, so lowering it below a few
seconds disables those retries — values under 1s are refused). When
`session` is unset, the ambient chain falls to the herdr session the
caller is running in (`HERDR_SESSION`), and pane-touching verbs REFUSE
outside herdr entirely (EVA-120 — the repo-slug default is gone); the
default socket is never inherited by omission:

1. built-in defaults
2. `~/.evie-kit/settings.{ts,js,json,yaml}` (user)
3. `{repo}/.evie-kit/settings.*` (project, committed)
4. `{repo}/.evie-kit/settings.local.*` (personal, gitignored —
   credentials live here)

`json`/`yaml` interpolate `${ENV_VAR}` in string values (an unresolved
var inside a tool block marks that tool unavailable rather than
crashing); the canonical executable shape (EVA-55) is the settings
FUNCTION contract — `export const settings = (ctx) => ({...})` with
`ctx.env(...names)` for typed first-defined-wins env access, an
optional `envFiles` member listing dotenv files the runtime loads
(two-pass evaluation: the function must be side-effect-free), and
`settings explain` attributing env-sourced values to the winning name
and its source file. A legacy plain-object default export keeps
loading through a grace window with a loud `[settings_deprecated]`
notice; `evie-kit upgrade` wraps it mechanically.
Everything is zod-validated post-merge; nothing repo-specific
is baked into the skills or their backing packages — behavior must run
identically against any repo. Load order and schema:
`@evie-kit/goals`' `loadSettings`.

## The driver

`runReviewWave` (with `buildReviewerPrompt`, `CodexSession`,
`SonarReviewer`, `CodeRabbitReviewer`) is a library surface; each goal
runs it from a short `bun` driver committed in its own `results/`.
Copy-adapt the NEWEST prior committed driver in the project — then
make it STAGE-AWARE (EVA-30): compute the roster with
`definedReviewTools(settings, "results")`, gate each reviewer's
construction on membership, and pass that SAME stage-scoped list as
`definedTools` (the package README's driver example is the current
shape; every driver committed before EVA-30 predates `stages` and
would run a goal-only-staged tool inside a results round).
(`goals/*/results/run-review-wave.ts`; pre-EVA-21 goals committed
theirs as `run-review-round.ts` against the old `runReviewRound`
API — historical artifacts, like all locked drivers. In the
evie-kit repo, EVA-21's is the newest committed driver: indexed wave
folders plus everything EVA-20 hardened — stated-session client (now `herdrBindingFor(settings, <resolved session>)` —
EVA-120 moved resolution into `resolveVerbSession`/`launchSessionFacts`,
and the wave verb resolves the goal's own recorded binding itself),
workspace resolved against the
BOUND session, worktree-aware three-arg `buildPrompt`, codex
`writableRoots`, per-tool stall thresholds, post-wave tab-layout
assertion; older drivers' two-arg builders fail reviewer setup loudly
under the default isolation, and pre-EVA-20 drivers construct a bare
`new HerdrClient()`, which now THROWS the teaching error — that loud
failure is the fix working, not a bug in the old record): it loads
settings, derives the goal key for the per-goal reviewer
names, and builds a reviewer for every results-staged DEFINED tool
with per-tool
provenance (enabled-only semantics — no `required` flags). Drivers
from goals before EVA-11 pass `required:` options that no longer exist
and settings layers that no longer parse; drivers before EVA-9
additionally fail loudly on the one-arg `reviewerTabLabel`; EVA-21..29
drivers also import the removed `reviewWaveDirName`/
`nextReviewWaveIndex` helpers and fail loudly on import (EVA-30's
hard rename — see ADR 0004). Locked
goals' committed drivers are historical artifacts — never re-run them.

A follow-up wave's diff necessarily contains the PREVIOUS wave's
committed records; reviewers must not re-litigate them. Interactive
reviewers are told so in the driver's `changeSpec`; CodeRabbit reads
the raw diff and ignores prompts, so the repo-root `.coderabbit.yaml`
excludes `goals/**/reviews/**` via `reviews.path_filters` (EVA-9).

Run it from the worktree root. Since EVA-55, review credentials
resolve through the settings' committed `envFiles` chain (e.g.
`.envrc.local` as dotenv data) — no manual sourcing. A repo-local
dotenv file is not present in a fresh worktree until ticket 3's
provisioning; until then, keep credentials reachable via a chain entry
that exists there (`~/.evie-kit/.env`), or run from a checkout that
has the file:

```bash
bun goals/<ISSUE-KEY>-<slug>/results/run-review-wave.ts
```

Each reviewer writes to its own
`reviews/results-NNN/{claude-code,codex,sonarqube,coderabbit}/`
subfolder; the wave's `ok` is a process verdict only — the gate passes
when the reconciled INDEX.md says so.

The coderabbit tool dir additionally carries `PROMPTS.md` (EVA-31): the
per-finding AI prompts the CLI saved with the review, captured by a
second, time-bounded `coderabbit review --show-prompts` invocation the
leg exec runs after the review completes. They are RECORDED as
reconciliation aid — understanding why CodeRabbit flagged a finding,
tuning `--config` instructions — and never executed directly (the
autofix rule). Never put `--show-prompts` in
`tools.review.coderabbit.args`: it is a separate no-review mode that
would replace the wave's review with a dump of the previous review's
prompts, and the reviewer refuses the arg outright. Capture failure is
a loud wave note in INDEX.md plus a `.prompts-failed` note beside the
artifact — the completed review stands either way. That includes the
preflight's soft channel (EVA-44): when `--show-prompts` itself
vanishes from `review --help`, the capture is skipped with the same
`.prompts-failed` note rather than failing the leg.

## Folder naming (kinded rounds, EVA-30)

Review rounds carry a **kind axis** — `goal | results` — and round
folders are kind-prefixed: `reviews/results-NNN/` and
`reviews/goal-NNN/` (3-digit zero-pad, the adhd `session-NNN`
precedent). The kind determines the round's CONTRACT, and the
distinction stays loud: `results` is the blind post-execution gate
wave this document describes — its blind contract is unchanged;
`goal` is the pre-promotion, dialogic, spec-scoped review loop, whose
execution machinery and INDEX template land with the stacked
goal-critique-agent-loop goal (this layer only makes the round surface
kind-aware — `runReviewWave` writes results rounds only).

`NNN` is **ONE monotonic per-goal sequence across BOTH kinds** — the
goal's total review timeline — computed by the writer
(`reviewRoundDirName` + `nextReviewRoundIndex`) as
`max existing index + 1`, starting at 001. Legacy indexed `wave-NNN/`
folders (EVA-21..29) feed that same sequence: a goal with `wave-002`
history continues at `results-003`, never restarts.

Rounds were kindless `wave-NNN/` from EVA-21 and datestamped
`review-YYYYMMDD-HHmmSS/` before that. Locked goals keep those
folders — locked means immutable history — so READERS resolve every
form with kind attribution: `isReviewRoundDirName`,
`parseReviewRoundDirName`, and `listReviewRoundDirs` read both legacy
forms as **results-kind history**, and reconciliation across a goal's
historical rounds still works. Datestamped folders carry no index and
never feed the sequence; a goal with only datestamped history starts
its indexed sequence fresh at 001.
