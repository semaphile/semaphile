# Review results-005

Blind multi-tool review wave for `SEM-3-cross-account-messaging` (2026-10-03T00:25:25.067Z).
Each reviewer ran as a labeled tab in the executing session's own herdr
workspace. Model/effort/summary/args columns record per-reviewer
provenance (summary = codex `model_reasoning_summary`, EVA-58; effort =
`claude --effort`, codex reasoning, or pi's `--thinking` level, EVA-243);
`(default)` means nothing was passed and the harness kept its own default.
Per-tool output dirs are machine-local since EVA-59 (gitignored raw
dumps) — the FINDINGS.md links resolve only on the machine that ran the
wave, and only until the goal worktree is reaped; the committed record
is this INDEX and its merged findings, so reconcile BEFORE the record
outlives the raw output.

**ROSTER NARROWED** — this round ran with fewer engines than its configured baseline roster (claude-code, codex, sonarqube, coderabbit, fable, opus55-medium, opus55-xhigh, sonnet55-xhigh): claude-code (excluded by the cli engines override). A narrowed round is a recorded, visible act — never a silently shrunken gate.

Round purpose: **finding** — a defect-hunting round, counted against the results-round budget.

WAVE FAILED: codex (failed) — failures are reported, never silently absorbed; rerun or reconcile explicitly.
Advisory engines, OUTSIDE the gate (EVA-243): opus55-medium (completed), opus55-xhigh (completed), sonnet55-xhigh (completed) — their findings are scored in the advisory section below and never enter the verdict above.

Wave notes:

- no gate receipts at goals/SEM-3-cross-account-messaging/results/GATES.md — reviewers audit gate evidence from worktrees cut from HEAD, so this wave's gate audit has nothing to read (EVA-79). Write the receipts and COMMIT them before the wave; a gate that cannot be run mechanically still gets a waiver entry naming its status and evidence pointer, so the file itself is never the thing that is skipped.
- posture: opus55-medium: posture advisory — pinned by settings review.posture.opus55-medium
- posture: opus55-xhigh: posture advisory — pinned by settings review.posture.opus55-xhigh
- posture: sonnet55-xhigh: posture advisory — pinned by settings review.posture.sonnet55-xhigh
- home paths: conformance/accounts/macos/admin.sh:400:16 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/BRIEF.md:39:1 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:16:43 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:17:18 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:18:19 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:19:22 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:24:28 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:47:25 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/screen.txt:2:10 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/screen.txt:4:17 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/screen.txt:49:9 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:16:43 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:17:18 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:18:19 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:19:22 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:24:28 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:47:25 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:16:43 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:17:18 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:18:19 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: … 108 more (`evie-kit names home-paths --base main` lists them)
- SHORT round (EVA-273): codex never started reviewing, and nothing else failed — this round is recorded short in ROUND.json and does not consume the round budget (up to the hard ceiling of short rounds). Rerun the leg in place before committing anything, so it reviews the same HEAD: `evie-kit goals review retry-leg --tool codex`.


| Tool | Outcome | Findings | Model | Effort | Summary | Args | Detail |
|---|---|---|---|---|---|---|---|
| codex | failed | [FINDINGS.md](codex/FINDINGS.md) | gpt-6-astra | high | detailed |  | SEM-3-cross-account-messaging-cd-review launch refused before agent start (unsupported-version): codex-cli 0.153.2 is installed — the reviewer launch preflight supports codex-cli 0.159.3 only; install that version or run the review without the codex engine |
| sonarqube | completed | [FINDINGS.md](sonarqube/FINDINGS.md) | (default) | (default) | (default) |  |  |
| coderabbit | completed | [FINDINGS.md](coderabbit/FINDINGS.md) | (default) | (default) | (default) |  |  |
| fable | completed | [FINDINGS.md](fable/FINDINGS.md) | claude-fable-5-1 | high | (default) |  |  |
| opus55-medium | completed (advisory) | [FINDINGS.md](opus55-medium/FINDINGS.md) | claude-opus-5-5 | medium | (default) |  |  |
| opus55-xhigh | completed (advisory) | [FINDINGS.md](opus55-xhigh/FINDINGS.md) | claude-opus-5-5 | xhigh | (default) |  |  |
| sonnet55-xhigh | completed (advisory) | [FINDINGS.md](sonnet55-xhigh/FINDINGS.md) | claude-sonnet-5-5 | xhigh | (default) |  |  |
| claude-code | excluded | — | | | | | excluded by the cli engines override — see the roster banner |

## Merged findings

Reconciled by the executor on 2026-10-03 from the gating legs' FINDINGS.md:
fable, CodeRabbit and SonarQube. **codex did not run**: its launch was
refused before the agent started, because codex-cli 0.153.2 was installed
and the reviewer preflight supports only 0.159.3. The round is recorded
short (EVA-273). It was not retried in place: the orchestrator ran a
supplemental codex review outside this round and adjudicated it with the
others (see "Outside this round" below). The verification round launches
codex on 0.159.3 through the pinned reviewer path.

Fixes landed in `6891407`, `edc02f2`, `8ceb6de`, `3545680`, `37a914d` and
`b528b5c`. Severity is the executor's judgment; a claimed severity that
differs is noted.

| # | Severity | Category | Location | Finding | Raised by | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | major | footprint | `results/GATES.md` | No gate receipts existed at the round's head. | fable #1 | Accepted. Missing evidence, expected at an interim point; `GATES.md` is committed before the verification round. |
| 2 | major (fable: minor) | risk | `cloud/run.sh:149` | `destroy` demanded exactly six deletes, so a partial apply or a deadline-deleted VM had no reviewed cleanup. | fable #2 | Fixed `8ceb6de`: any non-empty subset of the six reviewed deletes; any other action refuses. Stub-tested with five deletes, an unreviewed update and an empty plan. |
| 3 | minor | footprint | `controller.mjs:119` | Receipts omitted the filter flags and the participant launch argv. | fable #3 | Fixed `3545680`, `edc02f2`: flags, `complete` and per-role argv recorded; `evidence` only for a complete pass; `host.sh controller` takes no extra flags. |
| 4 | minor | footprint | `lib/cases.mjs:660` | ACL and readiness opens did not assert or record the resolved `semaphile.json`. | fable #4 | Fixed `37a914d` (`openOwn`). |
| 5 | minor | risk | `lib/cases.mjs:719` | A6 restored EVAL and TIME only on the success path. | fable #5 | Fixed `37a914d`: restored in a `finally`. |
| 6 | minor (fable: nit) | risk | `lib/launch.mjs:74` | The hello handshake had no deadline. | fable #6 | Fixed `3545680`: 30 s deadline, then SIGKILL; `close()` escalates. Tested with a live process that never greets. |
| 7 | minor (fable: nit) | risk | `lib/checks.mjs:442` | A spawn failure counted as a refusal. | fable #7 | Fixed `37a914d`: each refusal must exit with the code of the party that must refuse (sudo 1 with a `sudo:` message, the runner 77 or 64). |
| 8 | minor (fable: nit) | footprint | `README.md:170` | The macOS procedure ran one controller pass. | fable #8 | Fixed `b528b5c`: two passes with distinct ids. |
| 9 | nit | footprint | `README.md:209` | No cost figure in the provisioning guide. | fable #9 | Fixed `b528b5c` and in the activation packet. |
| 10 | minor | risk | `cloud/run.sh:34` | The mode check failed with GNU `stat`, refusing every run directory on a Linux operator host. | CodeRabbit #1 | Fixed `8ceb6de`: GNU form first, BSD fallback. |
| 11 | n/a (Sonar: BLOCKER ×12) | tooling | `lib/checks.mjs:51-87` | S2970 read the local `expect(label, actual, expected)` helper as an incomplete test assertion. | SonarQube | False positive: the helper pushes to `problems`, which callers treat as INVALID or FAIL. Resolved in code by renaming the helper to `compare` (`37a914d`), so the issues close on the next scan; no server marking is needed. |

SonarQube's other 71 open issues are preexisting, all in `packages/*`, which
this change does not touch. Its scan covers almost none of this change: the
shell, Terraform and Ansible are outside `sonar.sources`. ShellCheck,
`terraform validate` and `ansible-lint` receipts cover them in `GATES.md`.

The fix batch also covers the advisory-sourced blockers and majors below
(C1, C2, C3, C5, C6), which no gating leg raised.

### Outside this round

The orchestrator adjudicated a union of this round's legs, a supplemental
codex run and two scanner outputs, blind, into 39 clusters (private record).
That was input to these dispositions, not a substitute for them:

| Clusters | Disposition |
| --- | --- |
| C1–C6 (2 blockers, 4 majors) | Fixed in the batch above; re-reviewed by the verification round. |
| C7–C32 | Fixed, except C33 below. |
| C33 (free-port probe race) | Not changed: the race fails closed ("Redis exited") and the run is retried. |
| C34–C36 | Fixed (`37a914d`). |
| C37 (duplicated state-log protocol in the two admin scripts) | Not changed: each admin script is one self-contained file the owner verifies by hash and runs as root; sharing code between them would add an import the owner must also review. |
| C38 | `GATES.md` committed before the verification round. |
| C39 | Same as #11. |

### Supplemental review, reconciled before the final freeze (October 3)

The orchestrator later adjudicated one more blind reviewer against this
round's head and supplied three clusters as input. They are recorded here, by
the executor's own judgment, because they concern code this round reviewed.
results-006 did not verify them. Each fix was checked with targeted
verification only.

| Cluster | Severity | Executor disposition |
| --- | --- | --- |
| C40 | rejected | Agreed. Linux teardown empties each identity's 0700 directories as their owner before root removes the prefix, and GNU `rm` removes an empty directory it cannot read, because `rmdir` needs only write and search on the root-owned parent. |
| C41 | major | Fixed `53300a2`. The macOS identity check allowed only groups 12 and 61, but every local account also inherits nested groups (100 and, on this host, 701 and 705–710), so every macOS case would have failed closed. The inherited set is now read at run time from three hidden reference accounts and recorded; privileged groups still fail. Verified against this host's `id -G` output for `nobody`, `daemon` and `_www`, and with synthetic identities. |
| C42 | nit | Fixed `ba44360`. Both rehearsals now also crash a setup after the tree and 0700 homes are installed, recover it, and check the prefix is clear. ShellCheck and syntax-checked; not run, because it needs root or the container. |

## Notes for the next agent

Each lane's observations about the codebase that did not become findings
(EVA-264), copied from its FINDINGS.md. At reconciliation, route the ones
that outlast this goal through the retrospective's "What I learned" table
(`evie-kit learnings add`), phrased as facts about the code, never as
what a reviewer said; the rest stay here as the round's record.

- **fable**: `MessageSubscription.receive()` touches the subscription once and returns; only `wait()` and `listen()` start the renewal loop (`subscription.ts:21-120` at the candidate). T5's idle retirement and T6's idle renewal both depend on that split.
- **fable**: `retire()` in `messaging-records.lua` keeps a subscription's `expiresAt` and sets `retiredAt`, which is why a retired subscription's `expiresAt` can be compared with the pre-publish deadline.
- **fable**: `openRedisMessaging({ inspect: true })` opens with `create: false`; the CLI `info` command therefore fails with STATE_LOST on a store nobody has created yet, so `message create` must precede `info` on a fresh store.
- **fable**: Permission failures inside Lua surface as `ERR ACL failure in script` and the client maps them, together with NOPERM, NOAUTH and WRONGPASS, to code `ACCESS` (`messaging-sockets.ts:68-71`).
- **fable**: `linux/container.sh listing` uses `sha256sum`, which this macOS provides at `/sbin/sha256sum` (an Apple binary, identifier `com.apple.md5sum`); the Linux bundle staged on the Mac relies on it being on `/sbin`.
- **fable**: Inside the fixture container every writable path is tmpfs, and tmpfs pages are charged to the container's 3 GiB memory cgroup together with Redis `maxmemory 256mb` and the runtimes; the overlay layer measured by `host.sh size` stays near zero by design.
- **fable**: Bun 1.4.2 prints emitted warnings to stderr as `(node:pid) [CODE] Warning: ...`; they land in `stderr.jsonl` and are not failures.
- **fable**: `data.google_compute_image` is pinned by exact name; Google deprecates and later removes public Ubuntu images, after which the plan fails at the precondition rather than drifting.
- **opus55-medium**: `conformance/accounts/linux/container.sh` runs under `/bin/sh` (dash in the Debian-based `redis` image). Its rehearsal invokes `setup` and `teardown` inside `if ( … )`, where POSIX disables `set -e`. Those paths rely on explicit `fail`/`exit` calls, not errexit. `macos/admin.sh` does the same.
- **opus55-medium**: The Linux `STAGED-FILES.txt` listing is generated on macOS (`stage.mjs` runs `linux/container.sh listing` with the host `sha256sum`, BSD `find` and `sort`) and compared byte-for-byte against a GNU-coreutils listing inside the container. Any toolchain difference in output format or `[ -x ]` semantics shows up as "unpacked tree differs from the reviewed listing", not as a content change.
- **opus55-medium**: The listing deliberately excludes `checkout/conformance/accounts/node_modules` on Linux, which installs inside the container. There, installed-package identity rests on `installedCandidateCheck` in the controller, not on the listing.
- **opus55-medium**: Container root has no `DAC_OVERRIDE`. Anything that must delete inside a participant's 0700 directory has to `setpriv` to the owner (`empty_owned_dirs`). A new private directory owned by a different non-root UID inside another one would defeat that.
- **opus55-medium**: `cloud/run.sh audit` matches by name regex `^sem3-<run>(-|$)`. Run ids that are prefixes of one another (`linux-a1` and `linux-a1-x`) cross-match, which errs toward reporting leftovers.
- **opus55-xhigh**: Container root in the Linux fixture holds no `DAC_OVERRIDE` or `DAC_READ_SEARCH`. The controller cannot read identity homes or the UID-999 Redis directory. Credential provisioning and purging go through the participant process. Service-file checks go through `setpriv` as 999.
- **opus55-xhigh**: The Linux listing (`linux/container.sh` `listing`) prunes `checkout/conformance/accounts/node_modules`, while the macOS listing (`macos/admin.sh` `listing`) includes it. On Linux the installed dependency tree is verified only by `npm ci` integrity plus `installedCandidateCheck`.
- **opus55-xhigh**: Participants self-report their identity. The only server-side corroboration is the `CLIENT LIST` name-to-user probe in `runCase`. The PID is recorded, not checked.
- **opus55-xhigh**: The post-case inventory looks only at the account home and its TMPDIR scratch. `node:sqlite` and `bun:sqlite` are built in, so the native-addon check alone does not rule out an SQLite file written elsewhere (`/tmp`, `/var/folders`).
- **opus55-xhigh**: Both admin scripts' `listing` functions report success with empty output when their `cd` fails, because the pipeline status is `sort`'s. This only ever fails closed, against a non-empty reviewed listing.
- **opus55-xhigh**: `stage.mjs` loads npm's internal `cacache` from the staged Node runtime. It requires every locked tarball to already be in the operator's local npm cache under its registry URL key. Nothing in the repository acquires a missing one.
- **opus55-xhigh**: `lib/tar.mjs` ignores pax `x` headers, so a member whose path lives only in a pax record would be compared under its truncated ustar name. That fails closed.
- **opus55-xhigh**: A6 restores the revoked command only on success. A failed instance leaves `<id>-acl-revoke` without `eval` or `time`, and the remaining A6 instances for that account then cascade-fail.
- **sonnet55-xhigh**: `macos/admin.sh` and `linux/container.sh` implement the same state-log, verify, teardown and rehearse logic twice. A fix to one usually belongs in the other.
- **sonnet55-xhigh**: The macOS state log is under `/var/db/semaphile-sem3`, the Linux one under `/var/lib/semaphile-sem3`.
- **sonnet55-xhigh**: Linux staging runs `linux/container.sh listing` on the operator's Mac through `/bin/sh` and relies on `sha256sum`. `/sbin/sha256sum` exists on this macOS 15 host; an older macOS would silently produce a listing without file hashes. `listing()` pipes into `while read` with no pipefail, so a failed hash tool is not detected there. The in-container comparison would still fail closed.
- **sonnet55-xhigh**: `listing()` prunes `checkout/conformance/accounts/node_modules`. The installed candidate is proven by `installedCandidateCheck` (archive files, lock, pins) in each controller run, not by the owner-checked listing hash.
- **sonnet55-xhigh**: `controller.mjs` is one top-level script. Anything thrown before the final cleanup block skips cleanup, so review new code there for throw paths.
- **sonnet55-xhigh**: Participant timestamps in T5, L1 and L2 use the participant process's `Date.now()` and Redis server time on the same host. A different host or a skewed clock would invalidate the window arithmetic.
- **sonnet55-xhigh**: The per-run credential corroboration (`probe`) opens a separate connection with `HELLO … SETNAME`. It proves the credential file maps to the expected Redis user. It does not tag the connections the messaging client itself uses.
- **sonnet55-xhigh**: `participant.mjs` runs the CLI with the participant's own `process.execPath`, so a Bun participant runs the CLI under Bun.
- **sonnet55-xhigh**: Dev mode (`--dev`, `SEM3_DEV_PREFIX`) runs participants as one UID. `run.json` and `summary.json` say `evidence: false`.
- **sonnet55-xhigh**: A `Participant` spawn error (for example a missing working directory) rejects both `hello` and `this.exited`, because `events.once` rejects on a child's `error` event. The `exited` rejection is never handled, so it is another way to crash the controller (see finding 1).
- **sonnet55-xhigh**: Containers reach Redis over container-internal loopback only (`--network none`). The VM has no service account and egress is limited to TCP 80 and 443.

## Reviewer observations

Judgments about past choices the diff cannot fix (EVA-284) — the model's
expense, whether the goal should have been inline — copied from each
lane's FINDINGS.md with a stable id. They are NOT findings: they stay out
of the merged findings and their totals, and out of advisory scoring. At
reconciliation, rewrite each Observation cell as a neutral one-line
summary (what was observed, never who is to blame) and keep every id;
the retrospective's "Observation responses" answers each one before the
lock, and answering one never opens another review round.

| Id | Raised by | Observation |
| --- | --- | --- |
| results-005/fable/1 | fable | GOAL.md has no risk-register section; risks are stated in prose and in the verification contract. |
| results-005/fable/2 | fable | One chore carries two provisioning paths, two root-run admin scripts, a cloud leg and a 100-case matrix per platform, by the owner's choice of one goal with checkpoints. |
| results-005/fable/3 | fable | The interim round used four review engines on root-run shell and Terraform code. |
| results-005/opus55-medium/1 | opus55-medium | The cloud amendment arrived after the harness and admin scripts were reviewed, and its lifecycle code had no rehearsal of partial apply or post-deadline destroy. |
| results-005/opus55-medium/2 | opus55-medium | Each accepted fix to trusted code requires an owner-assisted macOS reinstall; the cloud amendment could have been a separate goal. |
| results-005/opus55-xhigh/1 | opus55-xhigh | GOAL.md has no risk-register section to check mitigations against. |
| results-005/opus55-xhigh/2 | opus55-xhigh | The Sonar slot covers `packages/`, while this change is harness, shell, Terraform and Ansible. |
| results-005/opus55-xhigh/3 | opus55-xhigh | The VM deletion deadline (8 h default) and a multi-round review with reruns were not reconciled in the plan. |
| results-005/opus55-xhigh/4 | opus55-xhigh | The staged listing and its hash are both produced by the controller, so the reviewed content is anchored in the controller rather than an independent listing of the commit. |
| results-005/opus55-xhigh/5 | opus55-xhigh | Interim rounds review a large body of root, cloud and harness code that cannot run until owner checkpoints. |
| results-005/sonnet55-xhigh/1 | sonnet55-xhigh | GOAL.md has no risk-register section. |
| results-005/sonnet55-xhigh/2 | sonnet55-xhigh | The change is about 5,500 lines for a chore, and the two admin scripts duplicate recovery logic by design. |
| results-005/sonnet55-xhigh/3 | sonnet55-xhigh | Candidate pins, the consumer lock and staging's re-derivation are three cross-checked views of the same data. |
| results-005/sonnet55-xhigh/4 | sonnet55-xhigh | The Ansible layer mostly wraps `host.sh`; its value is the idempotence and checksum assertions. |
| results-005/sonnet55-xhigh/5 | sonnet55-xhigh | The case inventory is independent of the cloud layer, so the same scenario can later target the Colima aarch64 leg. |

## Advisory findings — scored, outside the gate

Scored by the executor. `shared` names the merged finding above that
raised the same defect; `C#` is the orchestrator's cluster id, for
cross-reference only.

### opus55-medium — claude-opus-5-5 @ medium

| # | Severity | Location | Finding | Match | Disposition |
|---|---|---|---|---|---|
| 1 | major | `cloud/run.sh:149-159` | `destroy` refuses anything but six deletes (C4) | shared (#2) | accepted, fixed `8ceb6de` |
| 2 | major | `cloud/run.sh:162-177` | `audit` reports clean when gcloud or terraform fails (C3) | unique | accepted, fixed `8ceb6de` |
| 3 | major | `controller.mjs:157-539` | A controller crash leaves Redis running on macOS (C5) | unique | accepted, fixed `3545680`, `6891407` |
| 4 | major | `results/GATES.md` | No gate receipts (C38) | shared (#1) | accepted, committed before the verification round |
| 5 | minor | `controller.mjs:483-539` | Exit 0 does not require a complete run (C8) | shared (#3) | accepted, fixed `3545680` |
| 6 | minor | `teardown.yml:34-40`, `run.sh:130` | Idempotence claimed, not asserted (C18) | unique | accepted, fixed `8ceb6de` |
| 7 | minor | `tasks/pass.yml:4-15` | An async timeout aborts before receipts are fetched (C17) | unique | accepted, fixed `8ceb6de` |
| 8 | minor | `cloud/run.sh:179-184` | No pre-apply validate step (C19) | unique | accepted, fixed `8ceb6de` |
| 9 | nit | `README.md:294-295` | Key and state deletion not implemented (C29) | unique | accepted, fixed `8ceb6de` (`forget`) |

| Metric | opus55-medium |
|---|---|
| scored | yes |
| findings | 9 |
| accepted | 9 |
| unique accepted | 6 |
| rejected (noise) | 0 |
| matched gating majors | 2 |
| missed gating majors | 0 |

### opus55-xhigh — claude-opus-5-5 @ xhigh

| # | Severity | Location | Finding | Match | Disposition |
|---|---|---|---|---|---|
| 1 | major (executor: blocker) | `macos/admin.sh:119` | Root follows controller links in receipts and staging (C1, C2) | unique | accepted, fixed `6891407` |
| 2 | major | `cloud/run.sh:69` | `check_plan` refuses partial and post-deadline states (C4) | shared (#2) | accepted, fixed `8ceb6de` |
| 3 | major | `results/` | No gate receipts (C38) | shared (#1) | accepted |
| 4 | minor | `controller.mjs:48` | Receipts omit argv and flags; filtered runs exit 0 (C8, C9) | shared (#3) | accepted, fixed `3545680` |
| 5 | minor | `controller.mjs:443` | Exited participants skipped; T4 accepts any refusal (C13) | unique | accepted, fixed `3545680`, `37a914d` |
| 6 | minor | `lib/checks.mjs:400` | sudo refusal checks accept any non-zero exit (C12) | shared (#7) | accepted, fixed `37a914d` |
| 7 | minor | `controller.mjs:157` | No try/finally; a crash leaves Redis running (C5) | unique | accepted, fixed `3545680` |
| 8 | minor | `macos/admin.sh:150` | No pre-setup inventory (C21) | unique | accepted, fixed `6891407` |
| 9 | minor | `cloud/ansible/host.yml:87` | Host driver installed from the working tree (C20) | unique | accepted, fixed `8ceb6de` |
| 10 | minor | `README.md:170` | One macOS pass and no audit command (C23, C24) | shared (#8) | accepted, fixed `b528b5c` |
| 11 | nit | `README.md:118` | PID and label claims overstate the checks (C30) | unique | accepted, fixed `37a914d`, `b528b5c` |
| 12 | nit | `cloud/run.sh:130` | Second host run not checked mechanically (C18) | unique | accepted, fixed `8ceb6de` |
| 13 | nit | `participant.mjs:220` | `--store=x` passes the selector guard (C26) | unique | accepted, fixed `37a914d` |
| 14 | nit | `lib/service.mjs:143` | Redis storage and log ownership not recorded (C22) | unique | accepted, fixed `3545680` |

| Metric | opus55-xhigh |
|---|---|
| scored | yes |
| findings | 14 |
| accepted | 14 |
| unique accepted | 9 |
| rejected (noise) | 0 |
| matched gating majors | 2 |
| missed gating majors | 0 |

### sonnet55-xhigh — claude-sonnet-5-5 @ xhigh

| # | Severity | Location | Finding | Match | Disposition |
|---|---|---|---|---|---|
| 1 | major | `controller.mjs`, `lib/launch.mjs:74-85` | No failure-path cleanup; two failed launches crash the controller (C5, C6) | unique | accepted, fixed `3545680` |
| 2 | major (executor: blocker) | `macos/admin.sh:114-125` | Root `export_receipts` follows planted links (C1) | unique | accepted, fixed `6891407` |
| 3 | major | `cloud/run.sh:162-177` | `audit` is fail-open (C3) | unique | accepted, fixed `8ceb6de`, `edc02f2` |
| 4 | major | `cloud/run.sh:68-82,149-159` | `destroy` refuses partial and post-deadline states (C4) | shared (#2) | accepted, fixed `8ceb6de` |
| 5 | minor | `macos/admin.sh:376-408`, `linux/container.sh:329-356` | Rehearsals run with errexit off and accept any failure (C14) | unique | accepted, fixed `6891407`, `edc02f2` |
| 6 | minor | `controller.mjs:62-66,483-539` | Exit status cannot tell a filtered run (C8) | shared (#3) | accepted, fixed `3545680` |
| 7 | minor | `participant.mjs:219-230` | `--store=…` passes the selector ban (C26) | unique | accepted, fixed `37a914d` |
| 8 | minor | `controller.mjs:165-169` | Redis storage and log ownership not recorded (C22) | unique | accepted, fixed `3545680` |
| 9 | minor | `results/` | No gate receipts (C38) | shared (#1) | accepted |
| 10 | nit | `cloud/.gitignore`, `cloud/run.sh:137-139` | Generated names not ignored; receipts dir created before the check (C27, C28) | unique | accepted, fixed `8ceb6de` |
| 11 | nit | `linux/container.sh:196` | `.tmp/redis` mode differs from the README (C31) | unique | accepted, README corrected `b528b5c` (0755 is required for UID 999 to reach its run directory) |
| 12 | nit | `README.md:162-180` | One macOS pass (C23) | shared (#8) | accepted, fixed `b528b5c` |

| Metric | sonnet55-xhigh |
|---|---|
| scored | yes |
| findings | 12 |
| accepted | 12 |
| unique accepted | 8 |
| rejected (noise) | 0 |
| matched gating majors | 2 |
| missed gating majors | 0 |

### Baseline — the gating interactive engines on this round

| Engine | findings | rejected (noise) |
|---|---|---|
| fable | 9 | 0 |

## Gate evidence

No receipts existed at the round's head (`498e5ad`), so no reviewer could
audit gate evidence, and the postures recorded were about an absent file. The
gap itself is this round's gate finding (#1). What the receipts should have
stated at that head: the fast tier, typecheck, docs check, ShellCheck,
`terraform fmt`/`validate` and the Ansible syntax and lint checks green (they
were run, under `.scratch/docs/receipts/sem3-cross-account/cloud/`, but not
recorded in `GATES.md`); gates 1–4 and 7 not yet run, because no fixture
existed; gate 6 in progress with this round. `results/GATES.md` now records
these and is committed before the verification round.
