---
agent: claude-code
model: claude-opus-5-5
reasoning_effort: high
round: 2
timestamp: 2026-09-23T14:39:23-05:00
verdict: not_ready
findings: 12
---

## Summary

The revision resolves the four issues that blocked promotion in round 1.
Version 0.3.0 was reconfirmed after disclosure, and old refs and bytes are
preserved. Lint setup is in scope with a stop boundary. The shared
telemetry fix is named in the audit. Candidate evidence is now separate
from final-release evidence, without requiring fast-forward landing. I
accept the INDEX correction to my round-1 hole 4: a real merge keeps the
candidate commit as an ancestor. I also accept the correction to hole 6:
`--package-lock-only` does not prove unchanged resolution; only the
examined diff does. I do not reopen any owner decision.

Three new holes come from the owner's new choices meeting the actual
host:

- The native macOS two-account case needs an administrator the executor
  does not have.
- The Linux two-user container may end up on this Mac's arm64 colima VM
  instead of the Linux x64 target.
- Candidate archives and receipts written inside the goal worktree are
  gitignored, and goal cleanup deletes gitignored content.

There is also one contradiction. The stop clause tells the executor to
"split the deliverable", which conflicts with the owner's keep-one-goal
decision and with who owns goal creation. The planner can fix most of this
in GOAL.md text. Only macOS account provisioning, and possibly the Sonar
waiver posture, need owner input. Neither is a product decision.

## Plan holes and risks

**Status of round-1 findings (not counted again):**

| Round 1 | Status now |
| --- | --- |
| 1 version collision | Resolved: informed reconfirmation, refs and bytes preserved, separate candidate directory (GOAL.md:196-203). Where that directory lives is new hole 4 below. |
| 2 lint gate unachievable | Resolved in scope (GOAL.md:33-38, gate 5 deep-state rules). The remaining wording issue is hole 6. |
| 3 stranded shared fixes | Partly resolved: the invalid-baggage fix is named (GOAL.md:46-47). Disposition of the other ancestor fixes is hole 9. |
| 4 archive identity vs landing | Resolved (GOAL.md:205-213). My fast-forward claim was wrong for real merges. |
| 5 proxy residue in increment files | Resolved in scope (GOAL.md:48-49). The gate text still lags; see hole 7. |
| 6 lock drift | Resolved (GOAL.md:49-51), as the INDEX narrowed it. |
| 7-8 strict readiness / permission-denial behavior | Mostly resolved: gate 3 now lists allowed, denied and readiness-failure cases. The CONFIG GET posture is folded into "tested warn/strict readiness behavior"; the documented result is left to the executor. That is acceptable. |
| 9 cross-host infrastructure | Resolved by the preflight (GOAL.md:33). |
| 10 rerun rule | Resolved enough through the candidate/final split and "rerun affected… checks" (GOAL.md:209-211). |
| 11 native-free definition | Resolved (GOAL.md:57-59, gate 6). A wording conflict remains; see hole 8. |
| 12 SPEC numbering | Resolved ("preserved historical section references", INDEX). |
| 13 pilot 0.4.0 path | Resolved (gate 4). |
| 14 docs vs API | Partly resolved: gate 2 now disclaims link checks, but still names no comparison method (hole 10). |
| 15 review roster / push authority | Deferred to launch planning per the INDEX. Acceptable. |
| 16 size and stop bound | Not adopted. Low; I don't press it. |

**New or remaining holes:**

1. **The native macOS two-account case needs an administrator the executor
   lacks (new; pre-launch owner action).** On this host the session user is
   `uid=502(openclaw)` and is not in `admin`. `sudo -n true` returns
   "a password is required". The local accounts are `cedric` and `openclaw`
   only. `/Users/openclaw` is `drwxr-x---`, so other accounts cannot reach
   the worktree, `.tmp/bun-compat-latest`, or the mise Node installs under
   `/Users/openclaw/.local/share/mise`. The executor therefore cannot
   create the accounts, cannot run commands as them, and cannot give them
   the runtimes and archives from where they sit now. GOAL.md:69 says only
   "Preflight account access". It does not say that the owner provisions
   the accounts and the way to act as them. Options include localhost SSH
   keys, a narrowly scoped `NOPASSWD` sudoers rule, or owner-run steps from
   a script the executor prepares. It also does not say that runtimes and
   candidate archives go in a location both accounts can read that never
   holds their private configuration. The goal should also forbid the
   executor from attempting account creation or interactive privilege
   prompts. As written, a launched executor stops at step 1 every time.
2. **The Linux two-user container may run on the wrong architecture
   (new).** Local Docker is colima (`docker context ls` shows
   `unix:///Users/openclaw/.colima/default/docker.sock`), a Linux arm64 VM
   on this Mac. The platform target is Linux x64 (GOAL.md:118). Gate 3
   says "pass on macOS and Linux" and GOAL.md:68 allows "a disposable
   container". An executor could produce Linux arm64 evidence and count it
   as the Linux case. Require the two-user container to run on the Linux
   x64 host, record its architecture, and run tests as the unprivileged
   users, not container root.
3. **The stop clause contradicts the one-goal decision (new).** GOAL.md:215-217
   says "If the second review remains as large as the first, split the
   deliverable per AGENTS.md." The owner chose Keep one goal (grilling Q4),
   and creating goals belongs to the planner and owner, not the executor.
   Reword it to: stop, record the review-size evidence, and return a split
   proposal to the owner.
4. **Candidate archives and receipts inside the goal worktree get deleted
   (new).** `.gitignore:9` ignores `releases/`, and `.gitignore:19`
   ignores `.scratch/*`. Evie-kit's reap treats gitignored content as
   "build residue" that "the removal's rm-fallback deletes"
   (`packages/goals/src/reapSafety.ts:13-20`), and this worktree already
   holds its own copied `releases/` and `.scratch/`. A "distinct
   source-identified directory" under the goal worktree's `releases/`,
   or receipts in its `.scratch/docs`, would disappear at cleanup after
   landing. That is exactly the tested hash set and raw evidence the
   final-release handoff depends on. GOAL.md:198-203 and 245-247 should
   name a durable location outside the goal worktree, for example the
   primary checkout's `releases/` and `.scratch/docs/`, and say that
   gate 6 proof includes that path.
5. **Sonar's zero-finding bar on a never-scanned increment is a likely
   pause point (new risk).** `passed` requires zero open in-diff findings
   of any severity (`packages/goals/src/lintDeepOutcome.ts:127-135`). All
   of the increment's ~4.4k added lines are in-diff relative to main. I
   find no Sonar receipt for the Redis messaging increment. Earlier
   deliverables needed dedicated Sonar remediation passes
   (`.scratch/docs/PROGRESS.md:11-13`, "Sonar complexity refactor"). The
   likely outcomes are refactors inside reviewed §20 code, which must keep
   the contract and trigger reruns, or a pause for a waiver. The interview
   says no waiver was requested (GOAL.md:95-96), while gate 5 accepts one.
   The goal does not say which way to go (open question 2).
6. **Gate 5's fast-tier wording does not match this repo (remaining).**
   Gate 5 still reads "(`bun run lint`: every `tools.lint` root green…)".
   Here `bun run lint` is the npm per-package chain (`package.json:10`),
   and the same gate separately requires "Existing repository lint… also
   pass". The oxlint adapter resolves only `node_modules/.bin/oxlint` at
   the root or on PATH (`packages/lint/src/linters.ts:122-125`), and the
   root has no oxlint. The supported routes are the `command` adapter
   wrapping the per-package binaries, or a new root devDependency, which
   would be a dependency change. State that the proof is the receipt's
   `fast.configured: true, ok: true`, and that the meaning of the existing
   `lint` script does not change. Also, committing `tools.review.sonarqube`
   to `settings.ts` makes Sonar mandatory for every contributor under
   enabled-only semantics (`.evie-kit/settings.ts:12-16`). Record whether
   the Sonar connection stays machine-local.
7. **The proxy-residue gate lags behind the step text (remaining).** Step
   2 now covers scripts, help, runners, specs, docs and locks. Gate 4
   still says "no proxy exports, commands or peers", and gate 1 only
   "features absent". Make the proof a candidate-wide
   `git grep -n -i -E 'proxy|http-policy'` inventory with every hit
   dispositioned. Some hits are legitimate: the TCP fault injector in
   `conformance/redis/proxy.mjs` and the local `proxy` server variable in
   `conformance/redis/messaging-faults.mjs`. Add a lockfile check with no
   `@semaphile/proxy` entries, and the third-party lock diff promised at
   GOAL.md:49-51.
8. **Step 5 wording conflicts with the native-free definition
   (remaining, minor).** GOAL.md:75 says "a Redis-only installation
   without SQLite/native components". Step 3 and gate 6 say the archives
   may contain native bytes and removal happens only in an installed copy.
   Align step 5 with them.
9. **Other ancestor fixes still need a written disposition (remaining,
   minor).** The INDEX says "unrelated ancestor fixes need individual
   disposition", but GOAL.md does not require the record. Gate 1's
   "selected-change record" should list all 17 commits in
   `67ed8cc..baa06dc` (for example `1b56123`, `780406a`, `c9ac5cc`), each
   marked included, excluded or rewritten, with the reason.
10. **Gate 2's "contract comparison" still has no method (remaining).**
    Name the artifact: a table mapping each DECIDED clause of §20 to the
    test or receipt that covers it, plus an export-map diff of each package
    against the feature minus proxy and `http-policy`. Otherwise gate 2
    stays a judgment call.

## Green-gate checkability

1. **Extraction and baseline preserved.** Checkable once the
   selected-change record lists all 17 excluded-range commits (hole 9) and
   the residue inventory exists (hole 7).
2. **SPEC §20 and docs/exports.** The disclaimer is right, but the method
   is missing (hole 10).
3. **Two-account deployment and ACL recipe.** The cases are now concrete
   and checkable, but the gate cannot be met without owner-provisioned
   macOS accounts (hole 1). The Linux architecture is unpinned (hole 2).
4. **Regressions, cross-host, real 0.2.0 fixture.** Checkable. A real 0.2.0
   fixture is feasible from local archives: `releases/0.2.0/` holds
   `release.json`, `SHA256SUMS` and all four tarballs. Record the fixture's
   creating archive hash. The proxy-leak wording is narrow (hole 7).
5. **Typecheck, fast and deep tiers.** The receipt-state rules are strict
   and checkable ("not-configured does not satisfy"). Fix the `bun run lint`
   wording (hole 6). Expect a Sonar remediation or waiver decision (hole 5).
6. **One exact four-archive set.** Checkable, provided the archives
   persist (hole 4). Native source is unchanged since `v0.2.0` (no diff
   under `packages/core/native` in `67ed8cc..5b565ac`, checked in round
   1), so the binary identity rule is satisfiable.
7. **Fresh review and configured gate.** Deferring the roster to launch
   planning is acceptable.
8. **No publication, merge or out-of-scope work.** Checkable. Fine.

## Sizing sanity

Still no declared size. The INDEX calls that acceptable, and I don't press
it. The owner's choices increased the scope since round 1:

- a two-account exchange on 2 platforms × 2 runtimes,
- host provisioning coordination,
- lint and Sonar setup, plus probable Sonar remediation.

My estimate moves from L/13 to "L, upper end". This is not a reason to
reopen the one-goal decision. It is a reason to fix the stop clause (hole
3) so a size overrun comes back to the owner.

## Open questions and grill suggestions

1. The native macOS two-account check needs two unprivileged local
   accounts, and a way for the non-admin `openclaw` session to run commands
   as them. Today `sudo` needs a password and `openclaw`'s home is closed
   to other users. Which way should it go?
   - You (an admin) create the accounts and install localhost SSH keys or
     a narrowly scoped passwordless sudo rule for them (recommended).
   - You run the macOS account steps yourself from a script the executor
     prepares.
   - Keep it as a preflight stop until you provision later.
2. Sonar has never scanned the Redis messaging increment. The goal needs
   zero open findings in the whole new diff. If Sonar reports findings
   whose fixes would mean refactoring already-reviewed messaging code,
   what should the executor do?
   - Refactor to zero, keeping the contract and rerunning the affected
     suites (recommended).
   - Stop and ask you for a disclosed waiver of those specific findings.

## Wayfinder signal

`none`. The owner chose one goal with full information, and the work
isn't foggy. The size risk is handled by fixing the stop clause (hole 3),
not by a map.

## Promote-readiness verdict

`not_ready`. The round-1 blockers are resolved. Four new holes are cheap
to fix, but a pre-promotion critique should catch them:

- the macOS account gate cannot be met without an owner action the goal
  does not name (hole 1),
- the Linux container case can produce evidence on the wrong architecture
  (hole 2),
- the stop clause tells the executor to split the goal, against the
  owner's decision and seat ownership (hole 3),
- candidate archives and receipts written in the goal worktree are deleted
  at cleanup (hole 4).

No new product decision is needed. Holes 2-4 and 6-10 are planner text
amendments. Hole 1 needs the owner to confirm the macOS provisioning route
(open question 1). The Sonar posture (question 2) could instead be settled
as "refactor to zero, stop only if a fix would change §20 behavior" without
asking. Once those are folded in, a narrow check of the amended lines
should be enough; a full review round would not be needed.

CRITIQUE COMPLETE
