# SEM-3 Result: Test Redis Messaging Across OS Accounts

In progress. This record is written as the work happens; the gate sections
are added once their evidence exists. No gate is claimed yet.

## What changed

### Fixture and harness (September 24)

- `8cf2b13` adds the cross-account harness under `conformance/accounts/`: a
  controller, a fixed JSON-lines participant each identity runs, the fixed
  100-case inventory per platform, and a consumer that installs the four
  unchanged SEM-2 0.3.0 candidate archives. Its lock matches the candidate
  commit's own locks entry for entry (18 of 18 third-party packages).
- `a198aae` adds the root-owned runner, the macOS administrator script and
  the in-container Linux scripts. Each records a resource as intended before
  creating it and as observed right after, refuses collisions before any
  change, and deletes nothing when a recorded identity differs.
- `cc22320`, `2156636`, `416e623` add and repair controller-side staging. An
  offline `npm ci` needs each tarball's request-cache index entry under
  `<cache>/_cacache`, not content copied by digest alone.
- `91144bb` documents the procedure; `7c61d50` makes macOS setup compare the
  installed tree against a root-owned copy of the reviewed listing, closing a
  window in which the controller-owned listing could be swapped.

A same-UID development run, which is not evidence, passed 100 of 100 cases.
The fixture checks that need distinct identities fail in that mode, as they
must.

### Linux leg moved to a disposable cloud VM (September 26)

The owner replaced the shared Linux host with a disposable Google Cloud VM,
provisioned with Terraform and configured with Ansible
(`references/repeatable-cloud-provisioning.md`).

- `d70fcaa` commits the planner's four amendments unchanged, as the
  orchestrator asked.
- `e4d4e39` fixes four defects found by tracing the Linux container path
  under its narrow capability set, none of which had run yet: `setpriv`
  cannot clear a child's bounding set without `CAP_SETPCAP`; container root
  has no `DAC_OVERRIDE`, so teardown now empties the identities' 0700
  directories as their owners; the pinned `redis:8.4.0` image has no procps,
  so `pkill`/`pgrep` were silently absent and the survivor check always
  passed (a `/proc` scan replaces them); and the world-writable guard matched
  the sticky tmpfs `/tmp`, so setup could never start. Teardown also removed
  its own script, so a repeat had nothing to run; the verified script now
  runs from a root-only copy outside the prefix.
- `1cff9ce` adds `conformance/accounts/cloud/`: Terraform for six run-owned
  resources, Ansible for idempotent host configuration and the reviewed
  `host.sh` sequence, and `run.sh` as the single entry point.

### Interim review round and fix batch (October 2–3)

The orchestrator ran interim round `results-005` against `498e5ad` before any
activation. Its gating legs were fable, CodeRabbit and SonarQube; codex never
started (codex-cli 0.153.2 installed, the reviewer preflight requires
0.159.3). Three advisory legs ran and were scored. The orchestrator then
adjudicated all legs, a supplemental codex run and the scanners blind into 39
clusters, which it handed over as input. The owner withheld both activations
until the blockers were fixed. The reconciled record is
`reviews/results-005/INDEX.md`.

Fixes, by commit:

- `6891407` (macOS admin script): receipts are written as the controller with
  noclobber, so a planted link reaches only what the controller could already
  write (C1); staging links are refused, the listing is hashed from a
  root-private copy, and the prefix stays 0700 until the copy matches (C2).
  Teardown stops a controller Redis left in a run directory, found by its
  working directory because Redis rewrites its argv, and refuses on any other
  process in the prefix (C5). Rehearsal steps run as fresh processes with
  exact exit codes, setup's own collision refusal is rehearsed (C14), and
  setup and teardown record and compare the account, group and sudoers
  inventory (C21).
- `edc02f2` (Linux fixture): every Docker presence query fails closed (C3);
  teardown finds an unrecorded container by its labels (C16); the controller
  entry takes no extra flags (C8).
- `8ceb6de` (cloud leg): audit fails when its queries fail (C3); destroy
  accepts any non-empty subset of the six reviewed deletes (C4); an empty
  access token and a failed `terraform show` now fail rather than fall back or
  read as empty; plus C16–C20, C25 and C27–C29.
- `3545680` (controller): one cleanup path on completion, error and signal
  (C5); participant launch failures cannot crash the controller (C6); hello
  deadline and close escalation (C7); invocation, completeness and argv in the
  receipts (C8, C9); unexpected exits fail a case (C13); Redis file ownership
  recorded (C22).
- `37a914d` (cases and checks): C10–C13, C26, C30, C34–C36 and C39.
- `b528b5c` (README): C23, C24 and C29–C32.

Each fix was exercised where it can be without provisioning: stub `gcloud`,
`terraform` and `docker` binaries for the fail-closed audits and destroy
subsets; a planted-link test of the noclobber writer; three participant launch
failures (exit before hello, spawn ENOENT, no hello) with two participants;
SIGTERM and a forced fatal error in a dev-mode controller run, both leaving no
Redis, credential or ACL user behind; and a full same-UID dev run of all 100
cases. None of this is gate evidence. C33 (a free-port race that fails closed)
and C37 (duplicated logic across the two self-contained admin scripts) were
left unchanged, for the reasons in the INDEX.

`results/GATES.md` was committed before the verification round. The round's
outcome summary was posted to the issue as outcome prose only: no paths, no
file inventory and no private identity.

### Verification round results-006 and its fixes (October 3)

`goals review --purpose verification --verifying 'C1-C6 fix batch'` ran
against `d9ce1e4`, with the pinned codex-cli 0.159.3 first on `PATH`. fable,
CodeRabbit and SonarQube completed. codex stalled at its startup updater: the
harness's allowlisted answer was typed into codex's composer as text, and the
agent asked which option was meant. An in-place `retry-leg` on the same head
completed. No reviewer found a C1–C6 fix missing. The reconciled record is
`reviews/results-006/INDEX.md`.

The round raised seven new findings; all were accepted and fixed after it:

- `51ffef1`: the pinned image's `login.defs` sets `USERGROUPS_ENAB yes`, so
  `userdel` removes each user's private group and the following `groupdel`
  exited 6, stopping Linux teardown and the rehearsal's recovery step. Groups
  are now reconciled after their users go, on both platforms.
- `eb6943f`: a signal during Redis startup bypassed the stop. The child is now
  reported at spawn, a signal cancels the run, and cleanup waits for any
  in-flight provisioning. Tested by interrupting a dev run during readiness.
- `809e5d9`, `c6ba294`, `a365b5d`: Linux service-file ownership is stat-ed as
  the service; listings refuse a missing hash tool; the switch check reuses
  the launcher's argv.
- `144cb6b`: home-folder paths removed from the planner's goal-review records
  (the guard now reports none).
- `7481cbe`: gate receipts refreshed at `144cb6b` and pending gates relabelled
  PENDING.

These post-round fixes have not been reviewed yet. A planning request to split
the remaining review into admin-script, cloud and harness units is with the
planner, and the orchestrator asked that no second finding round start before
it is decided. A full same-UID dev run after the fixes passed 100 of 100
cases with a clean cleanup receipt. That is not gate evidence.

### Review split, supplemental findings and final-round preparation (October 3)

The orchestrator again withheld both activations: the post-verification fixes
were unreviewed, and a supplemental blind review had confirmed a new major.

- `640efda` applies the owner-accepted planner amendment: its paragraph is
  appended verbatim to gate 6, its contract is
  `references/final-review-scopes.md`, and GOAL.md names it. results-006 keeps
  its verification purpose and does not claim to have verified anything below.
- `53300a2` fixes C41 (major): the macOS identity check allowed only groups 12
  and 61, but every local account also inherits nested groups (100, and on
  this host 701 and 705–710), so every macOS identity check and case would
  have failed closed. The inherited set is now read at run time from three
  hidden reference accounts, refused if they disagree, recorded in `run.json`,
  and privileged groups still fail. A targeted check against this host's
  `id -G` output and synthetic identities passed.
- `ba44360` fixes C42 (nit): both rehearsals now also crash a setup after the
  tree and 0700 homes are installed and recover it. On Linux the tree is
  copied rather than moved and teardown keeps the transfer area, so the real
  setup still has its bundle. ShellCheck and syntax checks only; it needs root
  or the container to run.
- C40, a claimed Linux teardown failure on empty owner-only directories, was
  rejected: teardown empties them as their owner first, and GNU `rm` removes
  an empty directory it cannot read. All three are recorded in
  `reviews/results-005/INDEX.md`.
- The retrospective is written and committed before the final round, with
  five learnings under `.evie-kit/learnings/`.
- The merged-findings tables of both rounds were renumbered with plain
  integers so the retrospective's reviewer counts can read them; no content
  changed.

The final finding round has not run. Its coverage manifest and unit prompts
are in `references/final-review/`; the orchestrator runs it after the owner's
reviewer-roster decision.

## Execution notes

- **Re-arm without a position record.** On September 26 the goal contract
  was re-issued (`goal-rearm-20260926-200653.md`) and reported that no
  position record could be found. The session was the same executor with its
  context intact. Its handoffs are kept under the primary checkout's private
  `.scratch/docs/handoffs/`, as AGENTS.md directs, rather than where the
  re-arm looked. No history was reconstructed.
- **Pause marker already gone.** When the orchestrator's answer arrived,
  `.evie-kit/handoffs/paused.json` had already been removed by another
  process. The answer asked the executor to delete it; there was nothing
  left to delete.
- **Orchestrator commit on the branch.** `2949ab1` (the orchestrator, under
  an audit-logged override) lowered the results review budget to soft 2,
  hard 2, per AGENTS.md. The executor follows it.
- **Superseded shared-host bootstrap.** The September 24 Linux section B was
  never run. No account, container or image was created on the shared host.
- **Second re-arm.** On October 3 the contract was re-armed again
  (`goal-rearm-20261003-181530.md`). This time it found the session's own
  context intact and asked it to continue from the answer, which it did.
- **Marker removed twice by another process.** On October 3 the pause marker
  was again gone before the executor could delete it.
- **Retrospective deferred.** The verification round after this fix batch is
  not the goal's last: a planning request to split the remaining review into
  admin-script, cloud and harness units is pending with the planner. The
  retrospective will be written before the final round.
- **Tracker comment duplicate check.** With `--body-file`, `goals tracker
  comment --event review-round` stamps a marker without the round id, so the
  results-006 post was refused as a duplicate of results-005 and needed
  `--force`.
