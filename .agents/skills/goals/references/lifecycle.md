# The lifecycle in detail

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

Contents — the eight steps: Draft; Ideation / refinement; Promotion
(the intake review gate, the pre-flight rebase); Review-on-the-issue;
Execution handoff (the git mistake guard, steering executor panes,
arming the lock-watch companion); Plan + execute; Green-gate review
(review waves, humanizer gates); Completion (stop at lock, post-lock
cleanup, the merge companion steps).

1. **Draft.** User describes an idea (to OpenClaw, or directly inside a
   Claude Code session — both are first-class). Create the draft via
   `@evie-kit/goals`' `startDraft` (invocation example:
   `invoking.md`): it
   creates `draft/<ts>-<slug>` from main directly into a worktree at
   `.worktrees/drafts/<ts>-<slug>/` (path collision → error) and
   scaffolds `goals/drafts/<ts>-<slug>/GOAL.md` inside it — the primary
   checkout must be on main and never switches off it. Whether the
   scaffold (and every later drafting edit) is also committed+pushed is
   the `goals.drafts.commit` policy (EVA-62, default `false`: local
   plain files until promotion; `--push`/`goals share` per-draft —
   see Directory conventions).
   (`createDraft`/`scaffoldGoalFolder` remain the pure-filesystem
   primitives underneath, adapting `@evie-kit/coding-agent`'s
   loop-folder shape to this directory layout.) The GOAL.md body that
   drafting fills in follows `references/templates.md`. All refinement
   (step 2) happens inside the draft's worktree.
2. **Ideation / refinement.** Any combination of: `grill-me` (one-question-
   at-a-time interview, domain-modeling folded in), **goal reviews**
   (the pre-promotion critique loop, EVA-32: persistent secondary
   coding agents — engines staged `goal` in `tools.review.<tool>.stages`
   — critique the draft spec, return grill fodder + wayfinder signal +
   promote-readiness verdicts, and stay open for follow-up rounds as
   answers land; OFFERED at the refinement seams, never automatic —
   read `references/goal-reviews.md` before running one; rounds land in
   `reviews/goal-NNN/`), `adhd` (parallel
   cognitive-frame branches, grounded in this goal's own `GOAL.md`/
   `references/` — ADHD never runs outside a goal's refinement phase, see
   `adhd/SKILL.md` pre-flight Step 0; execution mode — local subagents vs.
   real multiplexer panes/tabs — is project config, see
   `adhd.branchExecution` in `references/review-waves.md`'s settings
   surface, not a fixed choice), the `research` skill
   (`evie-kit research …` — draft-first, needs explicit go-ahead
   before executing; artifacts land at the project's configured
   `storage.research` destinations — local drafts under `docs/research/`,
   never the goal folder, plus the Notion mirror when configured —
   since research is usually reusable across goals), **Wayfinder mode**
   (`wayfinder.md` — if the goal
   turns out to be bigger than one execution session can hold), or direct
   user edits to `GOAL.md`. Each mode writes its own artifacts into the
   draft folder's corresponding subfolder (interview transcripts always go
   to `grilling/`, regardless of which skill produced them — `grill-me`,
   domain-modeling, or a wayfinder breadth-first pass all land here since
   they're all the same underlying interview mechanic).
3. **Promotion.** User explicitly triggers this (not a heuristic) — but the
   agent MAY proactively suggest promotion readiness (e.g. no new open
   questions surfaced in recent interview turns, all fog resolved) and offer
   to draft the issue; the promotion action itself only ever fires on
   explicit user confirmation. Draft an issue on the active tracker whose body mirrors
   `GOAL.md` (format: `references/templates.md`), with subsections linking
   out to `references/` files as **git
   permalinks with the commit hash baked in** (plus plain URLs where
   relevant), rendered as inline Markdown links. Push the goal branch
   before drafting the issue so those permalinks resolve.

   **The intake review gate (EVA-62).** Promotion is where a draft kept
   local under the default `goals.drafts.commit: false` enters shared
   history — the whole folder as ONE promotion-capture commit
   (`promoteGoal` makes it automatically when the folder has uncommitted
   content). BEFORE that commit puts `references/intake.md` in front of
   everyone with repo access, the agent MUST run the gate: scan the
   verbatim intake for ASR/dictation artifacts ("ums", "no wait,
   actually…") and for sensitive content not meant for everyone with
   repo access, present the SPECIFIC candidates to the user for
   cleanup/redaction approval (an `AskUserQuestion` per the seam rules —
   with a briefing quoting each candidate), apply what they approve,
   and only then attest with `intakeReviewed: true`
   (CLI: `--intake-reviewed`). `promoteGoal` mechanically REFUSES to
   commit an uncommitted/modified intake.md without the attestation.
   Verbatim capture stays the DRAFTING-phase rule; what enters shared
   history gets user sign-off. The gate is PUBLICATION-STATE based: it
   asks whether the intake's current content is already on the remote
   draft branch, never whether the tree is clean — a share whose push
   failed, or a plain local commit, still gates. An intake provably
   shared (commit mode, a gated share, pre-EVA-62 history) never
   re-gates. `goals share` sits behind the SAME gate with the same
   `--intake-reviewed` attestation — sharing is equally an
   everyone-with-repo-access moment; run the same scan first.

   **The confidentiality lint (EVA-139, EVA-129's prevention half)**
   rides every one of these publication seams: promote (the CLI and
   the `promoteGoal` library API), `goals share`, `draft --push`, and
   `adopt-draft`, each keyed on the RESOLVED commit policy. The
   research-to-Notion mirror pushes carry the same gate. Unlike the
   human gate it is NEVER attestation-skippable — `--intake-reviewed`
   covers the review above, not this mechanical scan. Its config is
   the confidentiality file pair, the first member of the
   `.evie-kit/conventions/` family: `confidentiality.md` (tracked —
   generic `deny_patterns` and prose rules) + `confidentiality.local.md`
   (gitignored — the real `deny_tokens`/patterns, each token optionally
   naming its sanctioned alias). Deny tokens match across separators,
   so hard-wrapped and slugified spellings match too. The scan covers
   the folder's PUBLISHABLE surface: file contents, path names, and
   symlink targets, with gitignored machine-local content (adhd/,
   handoffs/) filtered out. The push seams also scan every commit not
   yet on a remote — a leak committed and then removed still publishes
   with the branch. A refusal names rule + file + line, REDACTS the
   match, and suggests the alias spelling when the token declares one.
   Locality is enforced three ways, each a loud refusal. `deny_tokens`
   in the tracked half refuse at load. A tracked half whose required
   local half is missing refuses the gates (`require_local: false` is
   the recorded opt-out). And a local half that git TRACKS — or that
   no ignore rule covers — refuses too. Projects with neither file are
   untouched. Acceptance runs against live services use the fixture
   registry instead of any client document: `requireFixture(settings,
name)` reads machine-local `fixtures.<name>` and throws a teaching
   error when unregistered. Committed fixture values refuse at
   settings load.

   **The naming-conventions lint (EVA-140, the conventions family's
   third member).** `goals draft` checks the title (and slug) at
   capture — cheap feedback where the name is chosen — and `goals
promote` re-checks the GOAL.md H1 and the branch slug before the
   issue is created, pre-mutation on both the CLI and `promoteGoal`
   library paths. Armed per check by the tracked conventions FILE's
   presence (`.evie-kit/conventions/issue-naming.md` for titles,
   `branch-naming.md` for the slug — no file, no regime, the
   confidentiality precedent); the countable RULES live in settings
   with EVA-convention defaults (`conventions.issueTitle`:
   `softMin`/`softMax` 35–50 warn-band, `hardMax` 60 refusal, `verbs`
   the verb-prefix vocabulary, empty list = grammar off;
   `conventions.branch.slugSoftMax` 30). Since EVA-145 the title
   grammar is dispatched BY GOAL TYPE: the record's `type:` (set at
   draft, default `feat`) picks `verb-first` (feat/docs/research/chore)
   or `symptom` (bug — the title states the observed defect and an
   opening vocabulary verb REFUSES); a project's `conventions.goalTypes`
   override names each type's grammar and tracker label, and an
   off-vocabulary type refuses where it is typed. Every naming refusal
   prints the expected pattern for the goal's type, a derivable
   rewrite, and the escape flag. The slug GRAMMAR is a fixed
   hard check since EVA-142: lowercase alphanumeric words joined by
   single hyphens. Its waivable band is the path-SAFE deviations only
   — a doubled hyphen waives; uppercase, underscores, and edge hyphens
   are the non-waivable path-safety floor. Soft caps
   WARN flag-free. Hard-cap and grammar violations REFUSE without the
   NAMED convention's waiver — `--ignore-issue-naming '<reason>'` /
   `--ignore-branch-naming '<reason>'` — and refusals CITE the
   conventions file: the error teaches. EVA-142 retired the blanket
   `--convention-override`, which now throws a teaching error (a
   blanket flag could waive a violation the user never saw).
   Confidentiality scans the title, slug, and waiver reasons before a
   refusal or a waiver recording can render them. A deny token
   therefore surfaces as the redacted confidentiality refusal, never
   an echo. A warning-ONLY outcome neither refuses nor records: its
   warnings print redacted and drafting proceeds — denied content
   stays locally legal until a publication seam, per EVA-139.
   The attestation is per seam (a draft-time waiver does not carry to
   promote). A CONSUMED waiver's reason is recorded twice. In the goal
   record it is the `conventions.ignore.<name>` frontmatter key
   (quoted-value frontmatter, so a `#` in the reason survives); the
   promotion commit body carries a matching line. Since EVA-145 a
   symptom-shaped bug title is LEGAL on a `bug`-typed goal and needs
   no waiver; the waiver is for real deviations — a vocabulary verb
   used as a noun (`Test Runner Hangs on Exit`), or a bug title kept
   deliberately verb-first. Commit-message shape enforcement is a
   recorded follow-up riding EVA-130's fence-hook chaining shim; the
   goal-type label stamp (EVA-145) is the one machine-written label
   family, armed by the tracked `labels.md`.

   **Pre-flight — rebase onto the base first.** The draft branched from
   its base (main — or, for a stacked goal, its `stacked_on` parent; see
   Stacked goals) at draft time; by promotion the base has usually moved
   on. Rebase the draft onto its latest base **before** promoting
   (`rebaseGoalOntoBase`, which resolves the base from the draft's own
   `stacked_on` frontmatter — main when absent; make sure local main is
   current first): promotion is the last moment history may change,
   because the issue's permalinks pin commit hashes. On conflicts the
   rebase is left in progress in the draft's worktree — the agent
   resolves them there (`git rebase --continue`), then re-runs the
   helper, which force-pushes with lease. `promoteGoal` enforces this
   with a hard behind-base guard: behind-main for ordinary drafts,
   behind-parent for stacked ones — a stacked draft is deliberately
   behind main until its parent merges, and promotion must not demand
   otherwise.

   Then promote. Run it from inside the draft's worktree, or from the
   primary checkout with `--worktree .worktrees/drafts/<ts>-<slug>` —
   the always-works form; `promoteGoal` handles the order either way.
   Promotion moves the draft folder to `goals/ABC-NNN-{slug}/`
   (using the real issue key) via `git mv`, renames the branch to match,
   and commits and pushes. It then **moves the worktree to
   `.worktrees/ABC-NNN-{slug}/`**
   (`git worktree move`, preserving the path-mirror invariant — the
   returned `worktreePath` is the folder's new home; the old path is
   stale). Frontmatter
   gets `status: promoted`, `promoted`, `issue_url`. Which tracker (and
   destination) a goal promotes into comes from the layered `.evie-kit`
   settings' `tools.tracker.*` block (EVA-26): the ACTIVE tracker is the
   one defined sub-block — `tools.tracker.linear` (team/project) or
   `tools.tracker.github` (repo/keyPrefix; issue keys become
   `<prefix>-<number>`, default `gh`) — committed per project;
   `evie-kit setup` scaffolds it; the legacy `tools.linear` and
   pre-EVA-19 top-level `linear:` keys error loudly at load. Skill text
   never hardcodes a team, because every project promotes somewhere
   different.
   If the block is unset, ask the user where goals promote and offer to
   record the answer in the committed `.evie-kit/settings.ts`. A team may keep a
   separate sandbox project for throwaway/dogfood goals used to exercise
   this workflow itself, never for real feature work. A stacked draft's
   promotion additionally records the tracker blocked-by relation to its
   parent's issue — see `stacked-goals.md`.

   **Promotion dismisses the goal critics**: if the draft ran goal-review
   rounds (`references/goal-reviews.md`), close the persistent critic
   tabs right after promoting — `evie-kit goals goal-review dismiss` —
   the committed round artifacts are the durable record; post-promotion
   spec edits wanting fresh critique start a new round, which respawns
   critics from those artifacts.

4. **Review-on-the-issue.** Once promoted, the primary review surface shifts
   to Linear: comments, direct edits, or messages to the agent — same
   three-channel feedback loop as drafting, but now user-driven rather than
   agent-driven. Advantage over local-filesystem iteration: a URL reachable
   from anywhere, shareable with a colleague, a durable team-visible record.
5. **Execution handoff.** User says the goal has solid
   footing. Before the launch, size the lifecycle (EVA-90): `evie-kit
goals plan <KEY>` recommends the shape from the goal's own spec —
   executor model, whether a blind wave runs at all, finding-round
   budgets, engine rosters, and each interactive reviewer's model under
   the capability-floor rule — and PRINTS it with the signals and
   excerpts it read. The user confirms at the launch seam; `--accept`
   records exactly those keys in GOAL.md frontmatter (mirroring the
   settings shape) with a `plan_accepted` stamp, which the launch and
   round verbs then resolve between the settings and any CLI flag. The
   seam is optional — a goal launched without it simply carries no
   plan — but a plan is never applied unconfirmed, and a malformed
   `review:`/`execution:` block REFUSES the launch rather than
   degrading to defaults nobody agreed to. Full rules:
   `right-sizing.md`. The
   handoff itself **adopts the goal's existing worktree** (created at draft
   time, moved at promotion) when it's at the expected path on the goal
   branch with a clean tracked state — one worktree per goal across its
   whole life. Dirty fails loud (commit or stash first); a fresh worktree
   is created only when absent. Launch a Claude Code session against it
   via `@evie-kit/herdr` + `@evie-kit/claude-code`
   (`AgentSession.start()` + `.sendGoal(...)`) — packaged as
   `@evie-kit/goals`'
   `startGoalExecution`, which also handles the worktree, the
   `started` transition, the **environment build** (the project's
   committed `settings.ts` `buildWorktree` member's `setUp()` runs
   after worktree adoption and its env vars are injected into the
   executor, then `envUp()` when defined — the launch seam (EVA-51;
   contract v3.0 casing, EVA-53) — EVA-35 folded the standalone `.evie-kit/
buildEnvironment.ts` hook into this settings-hosted factory; a leftover
   hook file is a loud error, never a silent fallback),
   the **unisolated-launch check** (a project whose factory does not
   assert worktree isolation refuses to launch while another goal is
   executing — see `concurrent-goals.md`; `overrideUnisolatedLaunch: true`
   — CLI: `--override-unisolated-launch` (EVA-46) —
   is the explicit accept-the-risk lever), and the **git mistake guard**
   (EVA-33): a launch-scoped `pre-push` fence riding the executor's
   process environment, refusing any push that would update `main` or a
   stacked goal's parent ref on the goal repo's protected remote — from
   ANY cwd, under any remote NAME; the refusal keys on the remote's
   URL, so an unrelated repo's `main` (e.g. a hermetic test fixture's
   scratch remote) stays pushable. The guard
   is a mistake guard, not a capability boundary: `--no-verify`,
   guard-config removal, git plumbing, forge-API merges, and the same
   destination under a different URL spelling bypass it,
   openly (documented exclusions — ADR 0011). The delivered goal is a
   **generated handoff instruction** carrying the GOAL.md path alongside
   the guard notice and the stop-at-lock contract — never the raw
   prompt file alone, since an arbitrary goal spec cannot be assumed to
   restate either. `GOAL.md` must still be
   self-sufficient: it should let the
   executing session navigate everything else it needs, in both the project
   and the goal folder, without additional hand-holding. Frontmatter gets
   `status: started`, `started` — and the `started` tracker transition
   fires with them, inside that same commit (Tracker lifecycle sync,
   SKILL.md; a launch that then fails rewinds the commit AND walks the
   tracker back to `promoted`).

   **Steering an executor pane — orchestrator note (EVA-56)**: raw
   `herdr agent send` (and `pane send-text`) TYPES BUT NEVER SUBMITS —
   the text sits in Claude Code's input box until someone presses
   Enter, which is how two weeks of manual `/rc` sends and steers
   silently went nowhere. Anything sent to an executor pane goes
   through a submitting channel: `evie-kit herdr send <pane> <text>`
   (the CLI mouth), `HerdrClient.typeAndSubmit`, or a session's own
   `sendInput`. What `typeAndSubmit` does under the hood is
   version-gated (EVA-91): PLAIN text becomes one `herdr agent prompt`
   on herdr ≥0.8.0, which types and presses Enter server-side, while
   SLASH COMMANDS keep the client-side text → settle → Enter sequence
   at every version (500ms settle so CC's autocomplete attaches —
   a live 0.8.0 run lost a `/status` to an open autocomplete menu, and
   `/goal`, `/rc` and `/compact` all ride that same window). Call sites
   are unchanged either way. All are
   single-line by design — a typed newline submits early. The standing
   `/rc`-at-launch preference is machinery now:
   `execution.remoteControl: true` in the layered settings makes
   `startGoalExecution` send `/rc` through the session's own
   submitting input at launch, right BEFORE the goal handoff (the
   pane is provably prompt-ready there; right after the handoff the
   executor is mid-turn, where a typed slash command can be swallowed)
   — exactly once per launch, never re-sent on the compact/continue
   path (`/rc` is a toggle; a second send would silently turn remote
   control OFF). Absent key = off. The toggle opens CC's **Remote
   Control confirmation modal**, which PARKS the pane's composer —
   the turn continues behind it, but every later typed send (a
   `goals compact` /compact, a self-compact continuation, an
   orchestrator nudge) lands in the dialog instead of the composer —
   so the same directive dismisses it (EVA-80): wait for the dialog
   (bounded), send one Escape, then re-poll until the marker is GONE,
   a dismissal reported only once OBSERVED. Two asymmetric outcomes,
   both surfaced as `rc` in the `goals execute` report: a dialog that
   never rendered is a WARNING the launch proceeds past — **the
   orchestrator reads `rc.warning` after every launch** and Escapes
   the pane manually if the dialog turns up late — while a dialog
   that rendered and could not be closed REFUSES the launch,
   retryably, rather than typing the goal handoff into it. Its
   settings sibling
   `execution.outputStyle: "<name>"` (EVA-75) launches executors
   under a Claude Code output style (the distributed `House Style`
   style supplies the situational prose register): the launch validates the name
   against the worktree's installed styles (a typo refuses loudly —
   CC would silently fall back to the default), stages a settings
   file in the worktree's PRIVATE git dir (the EVA-33 guard
   precedent — never a worktree file, which cleanup would refuse to
   reap), and passes it as a `--settings <path>` launch argument.
   Absent key = default style; the style itself must be installed
   (`evie-kit setup` places it).

   **The executor's permission mode (EVA-82)**:
   `execution.permissionMode` picks what an executor launches under —
   `bypassPermissions` (the DEFAULT, and what absence means:
   `--dangerously-skip-permissions`) or `auto`, Claude Code's auto
   mode. The default is deliberate and stays: an AFK lane must never
   park on a permission prompt waiting for a human who isn't there,
   and under auto mode a classifier denial does exactly that — CC
   falls back to prompting after 3 consecutive or 20 total blocks.
   Bypass mode has ONE dialog it does not skip (EVA-216): Claude
   Code's own safety check on an `rm` whose path is built from a
   shell variable or glob ("Dangerous rm operation on possibly-empty
   variable path … Do you want to proceed?"). It parks the executor
   `blocked` until a human answers. The watch reads that pane and
   escalates it once (`api-retry-escalated`, playbook entry
   `safety-prompt`, the human-gate route), the compaction handshake
   never Escapes it (Escape there cancels the tool call on the
   human's behalf), and the executor contract tells executors to
   delete by literal path or `find … -delete` so it never fires.
   Auto-mode executors are an explicit per-project opt-in that accepts
   that risk; `goals execute --mode auto|autonomous` is the per-launch
   escape in both directions, and the launch REPORTS the resolved mode
   with its risk note. The classifier's context rides
   `execution.autoMode.environment` — prose entries that must include
   the literal `"$defaults"` (omitting it discards CC's built-in
   entries; the loader refuses) — staged as inline `--settings` JSON,
   because the classifier deliberately ignores project settings files.
   Only `environment` is settable there: `allow`/`soft_deny`/
   `hard_deny` rewrite the classifier's own rules, and a committed repo
   file must not stage those into an unattended session — per-machine
   rule overrides stay a USER-layer `~/.claude/settings.json`
   decision, which `evie-kit setup`'s auto-mode question writes (it
   templates entries from facts the project states, verifies with
   `claude auto-mode config`, and needs Claude Code 2.1.195+). Under
   auto mode the launch settings file carries BOTH directives — one
   `--settings` document, since repeating the flag is not a supported
   way to layer two. Consequently `permissions.ask` push-checkpoint
   recipes are for HUMAN sessions only; the executor-side push guard
   stays the EVA-33 environment-armed pre-push fence, which refuses
   without asking anyone.

   **Arm the lock-watch companion (EVA-68; SELF-ARMED since EVA-130)**:
   `goals execute` now spawns `evie-kit goals watch <KEY>` itself as a
   detached child logging to `.evie-kit/runs/watch-<KEY>.jsonl` (EVA-128's
   second half — two launches forgot the manual arm and the executor's
   markers had no consumer; the launch report's `watch` field carries the
   pid + log path, or the skip reason; `--no-watch` opts out for an
   orchestrator that manages its own). The watch's pid claim keeps
   double-arming safe: whichever side arrives second gets the
   one-watcher-per-goal refusal in its own log. Arming by hand remains
   exactly what it was — the per-goal monitor that fires
   `goals compact` when the executor signals readiness, reports a
   dead executor, and (EVA-93) reports a legal pause with the citation
   the executor recorded, so an executor blocked on the user does not
   sit unnoticed; it runs until the goal locks. Since EVA-105 it also
   ACTS on one more observation: a completed compaction — it types the
   resume pointer and re-issues the launch's recorded `/goal` contract
   (`auto-continue`), or says loudly that it could not
   (`nudge-failed`). Since EVA-112 that failure is not the end of the
   story: the watch RETRIES the re-arm at each idle-without-lock window
   until the contract binds, and when the goal locks it delivers a LOCK
   REPORT into the orchestrator's own pane — so a lock reaches whoever
   is driving regardless of how the watch was launched (EVA-106's lock
   went unnoticed for hours because the exit reached a log file nobody
   was tailing). Since EVA-218 that pane is the RECORDED
   orchestrator's (`goals spawn orchestrator` or `goals bind
orchestrator` writes the record — EVA-222; the watch binds its client
   to the record's session and refuses an unrecorded target, naming
   those verbs then `goals resume <KEY>
--rearm-only` as the recovery — a running watch picks a record up on
   its next tick); `--report-to <herdr agent>` confirms that agent
   explicitly and is rejected when stale or when it names a live pane
   that is not the orchestrator. Without the watcher the
   executor's readiness markers have no consumer, the watchdog's
   nudges degrade into repeated handoff mining until the uncontrolled
   auto-compact lands anyway, and the session that comes out of that
   compaction has nothing driving it (the EVA-99 stall — the
   PostCompact hook's own one-shot is the fallback, not the primary).
   One watcher per goal (it claims a pid
   file in the goal worktree; a second refuses).

   **Give the reports a sink, and read it.** The watcher emits one JSON
   object per line on stdout, so a detached shell that drops stdout
   drops every report with it — including `executor-paused`, whose
   entire purpose is reaching the human being waited on (EVA-93
   results-003 cc #3: the pause's abuse guard is only as good as the
   reader who can refute a hollow citation). Redirect it —

   ```bash
   evie-kit goals watch EVA-93 > .evie-kit/runs/watch-EVA-93.jsonl 2>&1 &
   ```

   — and treat surfacing `executor-paused` and `pause-marker-invalid`
   to the user as the ORCHESTRATOR's job. Nothing pushes them today;
   wiring the pause events to a push channel is follow-up work.

6. **Plan + execute.** The executing Claude Code session (now "the agent" in
   the sense of "the one doing the work" — see `SKILL.md`, "Roles, not
   products") builds its own
   plan and executes it, writing detailed narrative output to
   `results/RESULT.md` (format: `references/templates.md`).

   **Confidentiality — the agent-judgment half (EVA-139).** Before
   committing goal records or documentation, read BOTH halves of the
   confidentiality pair, when the project carries them
   (`.evie-kit/conventions/confidentiality.md` +
   `confidentiality.local.md`). The prose bodies state the rules no
   regex can carry. No client or client-individual names — use the
   local file's alias spellings. No direct quotes from private
   meetings. No live client documents as test/acceptance targets —
   the fixture registry is the sanctioned path. The deterministic
   lint at the publication gates (step 3) backstops only the
   frontmatter-expressible subset. The prose rules bind the agent
   everywhere the lint cannot see — commits inside the goal worktree,
   tracker comments, handoffs.

   **Legal pauses — blocked on a human (EVA-93).** An executing session
   has TWO legal end-states: the lock (step 8), and a recorded pause on
   a decision the goal spec reserves for a human. The second one exists
   because of what actually judges an executor's goal: Claude Code's
   NATIVE `/goal` evaluator, fed by `sendGoal`, reading the generated
   launch instruction. While that instruction said only "continue until
   locked", the evaluator read a session parked at a designed approval
   gate as not-done and re-drove it — "Goal not yet met… continuing" —
   nine consecutive times, until CC's stop-hook block cap force-ended
   the loop (CED-20, consumer repo `time-tracking`, 2026-08-05). No
   hook of ours was involved; the defect was the instruction text, and
   that is where the fix lives.

   The instruction now carries the pause contract on EVERY launch
   (`buildExecutionHandoffInstruction` →
   `pauseContractSentence`), and the pause is a verifiable artifact
   rather than a claim:

   - **The receipt**: `.evie-kit/handoffs/paused.json`, written by the
     executor — runtime state in the same runtime-managed handoff
     directory as `compact-ready.json` (gitignored, copy-excluded, dies
     with the worktree). Deliberately NOT frontmatter: `started` →
     `completed` is the lock ladder, and frontmatter edits on a started
     goal carry contract weight a transient pause must not borrow.
     Required string fields — `goal` (issue key), `gate` (the GOAL.md
     gate/ask it is blocked on), `ask` (the question a human must
     answer, in full), `written` (ISO 8601). The executor states the
     same thing in its final message and STOPS.
   - **Cite the gate (the abuse guard)**: `gate` and `ask` are required
     by the strict predicate, and `evie-kit goals watch <KEY>` emits
     them verbatim as an `executor-paused` event — to the very person
     the pause claims to wait on, who is the one reader able to refute a
     hollow citation. A marker missing either is reported as
     `pause-marker-invalid` (loud, never accepted as a legal pause);
     the clearing is reported as `executor-resumed`. Reporting is
     edge-triggered, so a standing pause does not narrate itself every
     poll, and it never gates the watch's other jobs — a paused
     executor still gets its readiness marker compacted.
   - **The resume**: the pane is the substrate. The human answers there
     (typed, `/rc`, or an orchestrator send), and the EXECUTOR deletes
     its own marker and continues — the only actor that can honestly
     say the answer was observed. `evie-kit goals resume <KEY>
"<answer>"` is the wrapper for answering remotely: it types
     one submitted line through the same channel `/rc` and
     `goals compact` ride, reports whether a cited pause was on disk,
     and never clears the marker (a marker cleared by the verb would
     fake a resume a swallowed send never made).
   - **RE-ARM the goal when you answer.** A legal pause is judged MET by
     CC's `/goal` evaluator, and a met goal CLEARS — so an answered
     executor keeps working with nothing driving it to the lock, which
     is the unattended property `goals execute` exists to buy. `goals
resume` therefore delivers the answer, WAITS for the executor to delete
     its own marker, and only then types `/goal [<file>]` — the bracket
     form (EVA-112), whose file carries the launch's own recorded
     instruction verbatim. Re-arming over a STANDING pause would
     install a contract that pause already satisfies, so the evaluator
     could judge it met and clear it again at the end of that very turn.
     A marker that never clears is a reported skip, and a re-arm typed
     into a busy pane is reported too. The instruction is
     read verbatim from `.evie-kit/handoffs/goal-instruction.txt`,
     which the launch writes after delivering it — never reconstructed,
     because a partial contract is worse than none (the EVA-33 lesson).
     `--no-rearm` opts out; a skip is always printed. **Answering in the
     PANE does not re-arm** — nothing inside the session can type its
     own slash command — so for an executor nobody is watching, answer
     through the verb, or re-issue `/goal` by hand afterwards.
     `--rearm-only` covers the in-between case the skips leave open: a
     session that WAS answered (in the pane, or by a run whose re-arm
     was swallowed or skipped) and now runs undriven. It re-issues the
     recorded contract and types no answer, and it refuses while a cited
     pause is still standing, since that state wants the answer instead.
   - **Across compaction**: `goals compact` AND `goals self-compact`
     (the unwatched executor's path) append a stay-paused clause to
     their instructions and continuation when a cited marker is on disk,
     so the
     compacted session does not read "continue toward its green gates"
     as permission to walk through the gate it stopped at; an UNCITED
     marker gets a cite-it-or-delete-it clause instead, so the executor's
     belief and the instructions never contradict each other. The pause
     does NOT quiet the context watchdog: a session pausing at 800k
     tokens should still mine its handoff before going quiet, since the
     human may answer hours later.
   - **Consumer rollout**: the fix lives in this repo's instruction
     generator, so a consumer repo's currently-running executors hold a
     **stale instruction** until that repo pulls and relaunches. For an
     executor paused right now under the old contract, the transitional
     move is to answer it in the pane — not to hand-write a marker its
     instruction never taught it to read.
   - **A DEAD executor — paused or not — restarts through `evie-kit
goals restart <KEY>` (EVA-150).** The lifecycle still runs one way
     (`goals execute` starts only a `promoted` goal); restart is the
     recovery verb for a `started` one, owning the full sequence the
     manual recipe used to be: a LIVENESS PREFLIGHT (process truth via
     `evie-kit goals liveness <KEY>` — pgrep + lsof for a live agent
     process cwd'd to the worktree, never herdr registry presence,
     which drops live executors: the CED-24 incident spawned a
     duplicate off a registry-keyed "dead" verdict), the pane + agent
     rebuild with the environment re-injected and the legal derived
     agent name, fresh generation and bracket-form delivery of the
     `/goal` contract, commit-fence rotation with the authorship base
     preserved, and the lock-watch re-armed. A LIVE verdict refuses
     the restart (steer the surviving session instead — `evie-kit
herdr panes --processes` finds it); an UNANSWERABLE probe refuses too
     (restart acts on death and fails closed). A stale pause marker
     belonging to the dead session is cleared with its citation
     reported — the fresh executor re-reaches the same gate and
     records its own pause. Never rewind `status:` by hand to sneak a
     started goal past the execute gate — the frontmatter ladder is
     what the lock rests on.

7. **Green-gate review.** Green gates are **authored in `GOAL.md` during
   drafting**: whoever writes the goal defines what "done" must prove,
   dependent on the goal's objectives. A blind, multi-tool code review is
   the _default_ gate for coding goals; non-code goals define their own.
   Since EVA-90 that default is also a per-goal DECISION: a confirmed
   waveless plan (`review.wave: false` — legal for low-tier goals, the
   default for docs/skill-text ones) means the executor's own green
   gates plus the committed `results/GATES.md` receipts ARE the gate,
   and the executor must not spawn a wave "to be safe"; a wave-carrying
   plan names the agreed engines and finding-round budget, with
   verification rounds declaring themselves (`--purpose verification`)
   instead of consuming that budget. See `right-sizing.md`.
   For the code-review gate, the **executing session itself** spawns the
   reviewers — packaged as `@evie-kit/goals`' `runReviewWave` — as
   labeled tabs in its own herdr workspace (never a new workspace, never
   pane splits). Four tools are live: **Claude Code and Codex**
   (interactive TUIs) plus **SonarQube and CodeRabbit** (headless, wired
   in EVA-3). Reviews run **concurrently and blind** — sequential
   reviewing would let the second reviewer anchor on the first's
   findings, and reviewers see the change and the goal spec, never
   `RESULT.md` or another reviewer's findings. A reviewer that crashes
   or stalls is **reported as a failure of that wave**, never silently
   absorbed. Which tools run comes from the layered settings under
   **enabled-only semantics** (EVA-11): a tool whose settings block is
   DEFINED is part of waves — defining it declares the project uses
   it — and a defined tool THIS MACHINE cannot run (a failed
   availability probe, a settings key knocked out by an unresolved
   variable) is **skipped with its reason recorded** in the INDEX row
   (EVA-228): the wave runs the rest, and the skip still counts as
   missing against any gate that names the engine by roster; a wave
   whose every reviewer is unavailable still refuses to run.
   `enabled: false` is the explicit off-switch (the same recorded,
   visible `skipped` outcome, a different reason); an undefined tool is
   simply not part of the wave (INDEX.md records absent tools with terse
   `not-configured` rows, and the wave enforces that a driver covers
   every defined tool — the gate cannot silently shrink). A wave is a
   **results-kind review round** (EVA-30: rounds carry a kind axis,
   `goal | results` — the kind determines the contract; `goal`-kind
   rounds are the pre-promotion critique loop, EVA-32 —
   `references/goal-reviews.md`). A tool joins a round kind via the
   `stages` field on its `tools.review.<tool>` block (default:
   results-only). Each wave
   writes `reviews/results-NNN/` (3-digit zero-padded index — ONE
   monotonic per-goal sequence across both kinds; legacy `wave-NNN/`
   and datestamped `review-<ts>/` folders in locked goals stay
   readable as results-kind history) with per-tool
   subfolders and an `INDEX.md` (format: `references/templates.md`)
   whose "Merged findings" section the executing session fills by its
   own judgment — no mechanical union-is-blocking or vote-threshold
   rule; multi-tool blind review exists to surface more candidate
   issues than one reviewer alone would, not to reach algorithmic
   consensus. Multiple waves are supported (indexed folders,
   per-reviewer provenance in each INDEX.md).

   **Reconciling a round ends by posting it (EVA-113).** Once the
   round's merged findings are written, they go on the issue:
   `evie-kit goals tracker comment --event review-round` (the wave
   verb prints the exact command with the round pinned). The comment
   carries the CONSOLIDATED FINDINGS, not a count — a reader of the
   issue should learn what the round found without a checkout. It
   cannot fire from `goals review` itself: at that moment the merge
   judgment the comment exists to carry has not been made yet.

   **Gate receipts — `results/GATES.md` (EVA-79).** Before spawning
   the wave, the executor records a receipt for every green gate it
   has already run into `results/GATES.md` (format:
   `references/templates.md`) and COMMITS it — interactive reviewers
   review ephemeral worktrees cut from HEAD, so an uncommitted
   receipts file is invisible to them, and a missing one is itself a
   reviewable finding (`goals review` warns up front, in the console
   and in the wave's INDEX, whenever the receipts are missing from
   HEAD — uncommitted and ignored both count, since a reviewer
   worktree carries only what HEAD has — but it never refuses). The
   file itself is never what gets skipped: a goal whose gates are all
   non-mechanical still writes `GATES.md`, carrying a waiver entry per
   gate.
   Per gate the receipt carries the command, its exit code, headline
   counts, an ISO timestamp, and the TESTED COMMIT it ran against.
   Two rules keep receipts honest. **Never commit a secret**: the file
   is durable and reviewer-visible, so inline credentials, tokens, and
   signed URLs are recorded as the environment variable names that
   supply them, never as expanded values. **Tested commit, not
   receipt commit**: committing the receipts moves the head past what
   they record, so reviewers check ANCESTRY (the tested commit is the
   reviewed head or an ancestor whose delta touches nothing that gate
   exercises), never equality — an equality rule would be
   unsatisfiable by construction.

   Reviewer prompts link the file with CALIBRATED
   trust: coherence checks always (commands match the goal's stated
   gates, tested commits reachable and gate-irrelevant in their delta,
   counts plausible against the
   diff), spot-reruns only for cheap gates (a typecheck, one scoped
   package's tests) and only when the diff touches that gate's subject
   or the evidence looks off. Reviewers NEVER launch services
   (databases, compose stacks, supabase) — the shared docker daemon
   and ports mean a reviewer-started stack can disrupt concurrent
   executors and other reviewers — so service-dependent gates get
   evidence review only. A gate the executor could not run
   mechanically — the wave itself, in flight while reviewers read, or
   a user-waived gate — is a WAIVER entry rather than a missing
   receipt: it names the gate, its status, and where the evidence
   lands. When the goal spec declares no gates at all, reviewers audit
   against the repo's standard checks and record that they did.
   Reviewer findings record a per-gate posture — `re-verified` vs
   `accepted on evidence` — which the executor rolls up into the
   wave INDEX's own `## Gate evidence` section during reconciliation,
   since per-tool findings files are machine-local and die with the
   worktree.

   Read `references/review-waves.md` **before running a wave**: the
   operational mechanics (tab lifecycle and sweep rules, completion
   detection per tool kind, timeout/backstop and blocked-reviewer
   handling), the layered `.evie-kit/settings.*` configuration
   surface, the stale-reviewer gotcha, and the verified driver example
   all live there.

   **Humanizer green gates (content-heavy goals, EVA-67).** A goal
   whose deliverables are PROSE may declare a humanizer gate alongside
   (or instead of) the code-review wave: the deterministic lint
   companion (`evie-kit humanizer lint`, the `humanizer` skill) has
   stable rule IDs, a `--fail-on <severity>` threshold, JSON output,
   and an exit-code contract built to be cited by a gate. Gate
   OUTBOUND-facing docs (research reports, Notion/Linear bodies,
   published pages); internal records (GOAL.md, RESULT.md, handoffs)
   are the calibration corpus — lint them on request, don't gate them.
   The gate is GOAL-DECLARED and EXECUTOR-RUN, never a review engine.
   Worked example, as green-gate text in a GOAL.md:

   ```markdown
   - `evie-kit humanizer lint docs/research/<category>/<slug>.md` exits 0
     (humanizer gate at the default --fail-on warn; rule IDs and
     thresholds per skills/humanizer/references/lint.md).
   ```

   Per-repo/per-user thresholds live in the layered settings as
   `tools.humanizer` (EVA-74: a `strict | house | lenient` profile
   plus per-rule overrides; a loosening machine-local layer —
   `settings.local.*` or the user layer — prints a per-run
   `[humanizer_local]` notice); an
   ADVISORY LLM-judge pass (the humanizer skill reading the deliverable
   for register fit) may ride on top when the goal asks — it never
   replaces the deterministic gate.

8. **Completion.** Once the goal's green gates pass, the executing session
   runs the completion sequence — FIRST the authorship check
   (EVA-130 ws3): `evie-kit goals authorship <KEY>` from the worktree
   verifies every commit since launch is executor- or override-covered
   (the two ledgers the commit fence writes); an UNVERIFIED verdict
   means a foreign process wrote into the worktree (the EVA-124
   forged-lock shape) — investigate and resolve before locking, and
   record what was found in RESULT.md. One carve-out (EVA-157):
   mainline history the branch absorbed — a sibling goal's merge
   commit after a rebase or merge of main — classifies as `inherited`,
   never foreign. Such commits are reachable from the goal's base
   branch and are not descendants of the fence base. They are innocent
   by construction, and the verdict lists them separately. NEXT the lint
   gate's lock-eligibility check (EVA-209). Run `evie-kit lint
eligibility` from the worktree. It verifies that the recorded lint
   receipt and Sonar evidence are still valid for the head being locked:
   the head descends from the tested commit and nothing exercised
   changed. A receipt, results, or completion commit is exempt. Any
   change under a lint root, inside the effective Sonar scope, or to the
   lint or Sonar configuration invalidates. It also verifies that the
   deep requirement is met by `passed` evidence, a validated `not
applicable`, or a recorded user waiver. An INELIGIBLE verdict with a
   deep-tier ask is a legal pause: `--pause-if-blocked` writes the
   EVA-93 marker with the waive-or-wait question. Every
   temporarily-skipped round and any waiver are DISCLOSED in GATES.md,
   RESULT.md, and the lock report. Then finalize the gate receipts in
   `results/GATES.md`. Every gate now carries either a receipt or an
   explicit waiver entry naming its status and evidence pointer. The
   review wave's own row cites the reconciled `INDEX.md`, and any gate
   re-run after review fixes gets a fresh receipt against the commit
   it actually tested. Then
   finalize `results/RESULT.md` (a quick `evie-kit humanizer lint`
   pass over it is a good finalization habit — advisory leads, not a
   gate, unless the goal declared one),
   set `status: completed` and the `completed` timestamp in `GOAL.md`'s
   frontmatter, commit, push the goal branch, **stop**. This is
   the terminal, locking event, and the sequence ENDS there (ADR 0011,
   the EVA-25 deviation): the executor must NOT merge to main, push any
   protected ref, or clean up its own session — the launch-scoped
   **git mistake guard** (EVA-33, lifecycle step 5) mechanically
   refuses the protected-ref pushes, and post-lock session cleanup is
   the ORCHESTRATOR's follow-up: `evie-kit goals cleanup <KEY>`
   closes the locked goal's executor/reviewer sessions, acts on its
   built environment (EVA-50, MERGE-GATED; contract v3.0 vocabulary,
   EVA-53: the descriptor's `envStop()` — suspend, delete nothing —
   while the branch is unmerged, since an open PR can still be sent
   back; the destroy — `envDown()` then `tearDown()`, each
   loud-but-non-fatal — only once the branch is provably an ancestor
   of main; skipped entirely when a session close went unconfirmed;
   loud but non-fatal on failure), REFUSES while a merged goal's
   SHARED-environment drift is unacknowledged (the post-merge
   reconcile step — see below), reports the `completed` transition
   to the tracker (EVA-83 — this verb is where the lock is PROVEN
   durable, and its row never drives the exit code), PLANS the
   tracker back-fill for that goal and prints what still disagrees
   (EVA-113's plan-first companion — stderr, scoped to this goal,
   never applied), and reaps
   their ephemeral reviewer worktrees
   (the EVA-23 "last wave has no successor
   to sweep it" gap) — strictly, per-resource, and only once the lock
   is DURABLE (committed at HEAD, clean tree, remote goal ref equal to
   local HEAD). Cleanup never touches the goal worktree, branch,
   or Sonar project — those remain the merge companion
   steps below (the environment is EVA-50's deliberate, narrow
   reversal of that rule: a locked goal's running stack is dead
   weight, and a forgotten manual teardown leaked one compose stack
   per merged goal). What happens to the branch/PR afterward —
   merge, further human review, abandonment — is the **user's decision**,
   outside the goal's lifecycle; anything the user surfaces
   post-completion becomes a new goal loop referencing this one. How
   the orchestrator carries the lock report to that decision without
   running anything first, and without displacing the user's live
   conversation, is the lock-report arrival seam (`SKILL.md`,
   Lifecycle seams; EVA-217). When
   the branch IS merged (real merge commit with a descriptive
   `merge: …` subject, per the directory-conventions section), the
   merge has FIVE companion steps, in order. **The landing itself is a
   verb since EVA-117**: `evie-kit goals merge <KEY>` takes the
   repository's LANDING LOCK and performs the merge commit, the
   project's own `onMerge` catch-up, and the reconcile check inside it —
   one at a time across operators, fail-fast when another landing holds
   it (`--wait` queues). On a repo armed for the versioning regime
   (EVA-160: the tracked `.evie-kit/conventions/versioning.md` — no
   file, no regime) the landing is also a RELEASE. The preflight
   refuses a fresh landing whose branch stages no RESULT.md
   `## Changelog entry` section — the no-entry-no-merge check; the
   executor drafts the entry, the driver lands it. The post-merge half
   then appends that entry to CHANGELOG.md under a
   `## <version> — <date>` section, stamps every workspace
   package.json, commits, and tags the point `v<YYYY.M.N>`. The
   version is CalVer off the merge commit's committer date with a
   same-month ordinal (ADR 0018), and `--push` pushes the tag with the
   branch. The release step rides the
   same incomplete-landing fence as `onMerge`, so a failed one is
   re-driven by `--catch-up`, idempotently. `evie-kit changelog check`
   holds the whole first-parent merge history covered, and
   `evie-kit changelog delta` renders what a consumer's stamp is
   missing. The publish workflow (`evie-kit release publish`) is
   manual-trigger while the registry scope question stands (see the
   workflow file's header). It is more than `git merge` and its scope stops
   at the merge window: `cleanup` and `reap` stay separate verbs, run
   whenever. Landing by hand still works and still owes every companion
   step below; the verb is the spelling that cannot forget one, and the
   only one that closes the window against a second operator. **FIRST,
   the post-merge reconcile check** (EVA-87, results-002 finding 5):
   `evie-kit goals reconcile <KEY>`, whose HOLDING exit blocks the
   merge-complete declaration until a human clears the drift — `goals
merge` ORDERS this step inside its lock rather than replacing it, so a
   landing through the verb has already run it. It is first, and it is
   mandatory, because the normal ordering otherwise bypasses the hold
   entirely — `goals cleanup` runs at LOCK time, when the branch is
   still unmerged and reconcile answers the non-holding `not-merged`,
   and nothing afterwards would ever read the merged diff. (A cleanup
   RERUN after the merge reaches the same hold, and is idempotent; the
   verb is the cheaper spelling.) Then: tearing down the goal's
   built environment (the `envDownGoalEnvironment` +
   `tearDownGoalEnvironment` pair — the descriptor's `envDown()` then
   `tearDown()` (contract v3.0, EVA-53); BEFORE the worktree removal,
   since the hook and its overlays live in the worktree; a no-op on
   projects without a hook; `goals cleanup` at lock time only SUSPENDS
   an unmerged goal's environment via `envStop()` (EVA-50), so this
   companion step is the real destroy — an idempotent no-op only when
   a cleanup re-run after the merge already tore it down),
   removing the goal's worktree (`removeMergedGoalWorktree`,
   guarded by the remove-on-merge rule under `goal-records.md`'s
   Worktree layout section — it also reports the `merged` transition
   to the tracker on its way through, per Tracker lifecycle sync in
   SKILL.md; since EVA-103 the canonical spelling of this step and the
   environment destroy above is one verb, `evie-kit goals reap <KEY>`,
   which runs both plus the branch delete and the workspace close under
   its own gates — see "The estate reap" below),
   deleting the branch's ephemeral SonarQube project
   (`deleteSonarBranchProject` — `absent` is fine, the goal's waves
   may never have run sonar; all keyed by the merged branch), and
   refreshing the authoritative sonar board with a fresh scan from the
   main checkout (waves never scan the base project, so nothing else
   updates it). Merges themselves are SERIALIZED by the
   orchestrator — see `concurrent-goals.md` — and a stack of goals lands
   parent-first, each child then retargeting its PR to main with no
   rebase — see `stacked-goals.md`.

   **The post-merge reconcile step (EVA-87).** Worktree isolation made
   main the shared environment everybody reads from, which opened a gap
   nothing else covers: a goal develops migrations/ETL/seeds against
   its OWN environment and merges — main's code moves, main's database
   does not. A project declares the answer as `reconcile` detectors on
   its `worktrees()` config (`{ name, paths, command, reason? }`,
   `concurrent-goals.md`); the step matches them against the MERGE
   COMMIT's own diff and reports what main now needs. Three properties
   are load-bearing: it NEVER writes to the shared environment
   (detect-and-tell — the report names the command, a human runs it);
   it cannot gate the merge, so what unacknowledged drift holds is
   `goals cleanup`, the merge-complete DECLARATION, with the merge
   commit and the environment untouched; and every non-drift outcome
   proceeds, failures included, because a hold with no commands to name
   is obstruction. The one-step clear is
   `evie-kit goals reconcile <KEY> --acknowledge ran | deferred`
   (recorded per goal AND merge commit in the common git dir, so a
   later merge is never silently covered) — cleanup's refusal names it,
   along with the exact commands. Run the bare verb
   (`evie-kit goals reconcile <KEY>`) any time after a merge to see
   the report; `reconcile.hold: false` in settings makes it advisory,
   and `reconcile.mode: "execute"` refuses at load — executing against
   main's database is a later increment. Rationale:
   `docs/adr/0016-reconcile-detect-and-tell.md`.

   **The estate reap (EVA-103).** Execution creates a per-goal ESTATE —
   worktree, local branch, per-worktree service stack with its NAMED
   VOLUMES, herdr workspace — and until this verb, completion and merge
   tore down none of it. The evidence: a consumer devbox hit 99–100%
   root disk twice in one week, and the cleanup pass found 21
   worktrees, a fully RUNNING orphaned stack for a goal merged four
   days earlier, and 12 idle workspaces — with worktrees at ~30G on a
   roomy 1TB volume while the docker VOLUMES were 56G on the 248G root
   disk. The component nobody thinks about is the one that fills the
   disk, which is why the summary is per estate component and the
   volume rows are sized.

   `evie-kit goals reap <KEY>` is the destructive second act, kept
   SEPARATE from `cleanup` (which stays bookkeeping) because
   destruction earns its own safety posture. Five gates run before
   anything is touched, and a refusal has touched nothing: the goal is
   **locked** at HEAD; its branch is **provably merged** (the same
   `proveMerged` gate cleanup's destroy rides — unprovable is refused
   exactly like unmerged, so a squash-merged branch stays a by-hand
   job); the **EVA-87 shared-environment hold** is clear (the same hold
   cleanup runs, cleared by `evie-kit goals reconcile <KEY>` with
   `--acknowledge …` — reap needs it MORE than cleanup does, because it
   deletes the branch ref the reconcile report resolves the merge from,
   so an unheld reap does not skip the drift report, it ends the
   ability to produce one); its latest **review round is reconciled** —
   checked at HEAD, so an uncommitted INDEX that merely looks
   reconciled does not clear it (the per-tool output
   is machine-local since EVA-59 and dies with the worktree, so reaping
   an unreconciled round would destroy the findings and freeze a record
   saying nobody read them); and the worktree holds **no content beyond
   gitignored residue** — that refusal names EVERY file and prints the
   `--rescue-to <dir>` rerun, which copies the content out and then
   reaps. The two rescue hazards this gate exists for are real: a
   local-mode draft whose entire record is untracked, and a merged
   goal's worktree holding operator-dictated notes written after the
   final commit.

   Past the gates it runs the descriptor's `envDown()` + `tearDown()`
   (through cleanup's own hardened environment step, EVA-77 contract
   degrade included), closes the herdr workspace, removes the worktree
   with a `rm` fallback for the gitignored residue git chokes on
   (root-owned docker-build residue is REPORTED as unremovable, never
   sudo'd), and deletes the local branch with `-d`, NEVER `-D` — a
   branch git will not delete is kept and reported with the `-D`
   command. Remote refs are untouched: they are what Linear permalinks
   resolve against.

   `--all-merged` sweeps every merged goal worktree and SKIPS a
   refusing one instead of stalling — one dirty worktree must not stop
   a twenty-worktree sweep. The sweep also carries the ORPHAN report:
   containers and named volumes attributable to a goal whose worktree
   is already gone (matched by the derived stack key or compose's own
   working-dir provenance), listed with sizes and removal commands and
   deleted ONLY via an explicit `--remove-orphan-container` /
   `--remove-orphan-volume` flag — EVA-49 fail-closed, because volume
   data is database data. Any docker failure is fail-closed into a
   note; "docker did not answer" never renders as "nothing found".
   `reap --all-merged --dry-run` is the sized report, and it is what
   the unreaped-estate advisory — a COUNT, printed by `goals cleanup`
   at the merge moment and by the `/goals` door's `list`/`context` —
   points at.
