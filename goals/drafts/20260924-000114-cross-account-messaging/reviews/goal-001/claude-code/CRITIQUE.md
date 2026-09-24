---
agent: claude-code
model: claude-opus-5-5
reasoning_effort: high
round: 1
timestamp: 2026-09-24T00:27:00-05:00
verdict: not_ready
findings: 20
---

## Summary

The owner decisions are clear and the spec sets honest boundaries. It
separates same-host account proof from SEM-2's cross-host receipts. It
refuses to count same-UID subprocesses and puts the right fences around
the shared Linux host. The spec is not ready to promote because its core
completion gate refers to an "agreed matrix" that has not been agreed.
The conformance code it proposes to reuse also cannot produce
cross-account evidence without a new driver. Three more gaps need a
decision before an executor starts: which artifact the evidence
certifies, where Redis runs and who holds its admin credential, and
whether cleanup runs before or after the review wave. The cleanup
inventory also leaves out the most sensitive resource the Mac setup
creates, the identity-switching privilege grant. Most of these are
refinements, not a reason to redesign. Two or three are owner choices
(listed separately below). The rest the planner can settle in GOAL.md
without another interview.

## Plan holes and risks

1. **Gate 3's matrix is not agreed, and the reusable code does not
   cross UIDs.** Scope item 4 says "Specify the final test matrix during
   refinement", and Gate 3 depends on "the agreed cross-account Redis
   messaging matrix". Refinement is happening now, so the inventory has
   to be written into GOAL.md before promotion. Reuse is also shallower
   than the spec implies:
   - `conformance/redis/messaging-acl.mjs:77-83` starts every CLI
     participant with `spawn(process.execPath, …, { env: { ...process.env
     } })`. That is the same UID, the same environment and the same
     binary. Only the `account()` ACL helper (`:45-60`) and the
     assertions carry over. A new driver has to launch each participant
     through the identity switch.
   - `conformance/messaging/topics.mjs:9-22` runs every client in one
     process against the harness's unrestricted `redis.url`. Running it
     "under both runtimes on each platform" as a fixture user proves
     only that one UID can run it. That is not cross-account topic or
     lifetime behavior, and not behavior under restricted credentials.
     The spec needs to name which topic and lifetime scenarios cross the
     account boundary. Examples: a topic published by account A reaching
     subscribers in B and C, each with its own restricted credential; a
     temporary subscription's inactivity TTL expiring while its owner
     account is idle. It should label everything else as a
     per-UID regression rerun.
   - Warn/strict readiness (`messaging-acl.mjs:143-157`) does not depend
     on the OS account. Running it under each fixture UID is cheap and
     fine. The receipts should call it a rerun under a fixture identity,
     not cross-account evidence.

2. **Which artifact the evidence certifies is undecided.** The SEM-2
   debt record asks for "the same identified package archives". The
   spec says only "identify … package archive hashes" and "reuse the
   SEM-2 runtime line where compatible". The conformance modules import
   the source tree's `dist/` and the root `node_modules`
   (`conformance/redis/harness.mjs:9-13`, `messaging-acl.mjs:9-10,52`),
   and the checkout sits inside a personal home. Fixture accounts
   therefore cannot run the existing modules in place without opening
   that home. The executor has to either install a hash-pinned archive
   set into a shared read-only prefix or copy a built tree there. Those
   choices certify different things: SEM-2's candidate set at
   `800c8c5`, a fresh pack at the goal head, or published npm bytes.
   This is an owner choice (Q1). Related risk: the linux-x64 native
   binary in SEM-2's `ARTIFACTS.json` was built on a glibc host. A musl
   base image such as `*-alpine` would fail the core native load inside
   the fixture container. The container base has to match the binary's
   libc.

3. **Fixture store paths contradict private homes.** The last executor
   note says "All fixture store paths belong under an appropriate
   repository's `.tmp/`". The harness writes `.tmp/redis` relative to
   the cwd (`harness.mjs:82-83`, `messaging-acl.mjs:16-17`). A fixture
   participant's cwd and config have to live in its own private home or
   another path it can write, not in the checkout under a personal
   home. Reword the note so participant state lives under each
   account's home or an explicitly scoped fixture prefix. The driver's
   own logs stay in the repo's `.tmp/`.

4. **macOS default group membership opens personal homes to fixture
   accounts.** The primary-checkout preflight receipt records that
   personal homes are group-traversable by the default staff group, and
   new macOS accounts join that group by default. Once created with
   defaults, a fixture account can traverse both personal homes. That
   is the opposite of "without opening personal home directories". The
   spec should require fixture accounts to have a non-staff primary
   group. Gate 2 could add one negative check, safe for personal data:
   a fixture identity attempts a top-level listing of a personal home
   and is denied, and no file contents are read.

5. **The spec never states the Redis topology or who holds the admin
   credential.** `harness.mjs:79-80` uses `SEMAPHILE_REDIS_TEST_URL`
   when it is set. Otherwise it starts Redis with `docker run` on Linux
   (`:89-107`), which cannot work inside a fixture container that
   correctly has no Docker socket, or with `redis-server` from PATH on
   macOS. `messaging-acl.mjs:20-22,45-56` needs an unrestricted admin
   client to create the restricted users. The spec should state:
   - where Redis runs on each platform (a labeled sidecar on the fixture
     network, or `redis-server` inside the container) and that it
     listens on loopback or the private fixture network only;
   - that the Redis version stays pinned at SEM-2's 8.4.0;
   - which identity holds the admin credential (the driver, never a
     participant account);
   - how each account's restricted credential gets into its private home
     at mode 0600. `sudo` resets the environment by default, so
     env-passing through `sudo -u` needs an explicit design. Putting
     credentials in argv exposes them to `ps` for other users on the
     host.

6. **The Mac identity-switching grant is missing from cleanup, and the
   fixture accounts may be able to log in.** The preflight's candidate
   is a sudoers.d rule that lets the orchestrator account run commands
   as the fixture users. Scope 5 and Gate 4 list only "dedicated Mac
   test accounts and fixture runtime installation" as cleanup targets.
   Cleanup also has to cover the sudoers.d file (validated with
   `visudo -c` after removal), the shared fixture group, any Redis
   binary installed for the fixture, and hidden-user attributes.
   Separately:
   - If the rule's target directory is writable by the orchestrator
     account, the rule means "run anything as a fixture user". That may
     be acceptable, since those users hold nothing of value, but the
     ownership model should say so explicitly.
   - The preflight shows sshd loaded on this Mac. Fixture accounts
     created with a usable password may be reachable over Remote
     Login. The setup contract should require that the accounts cannot
     log in: no usable password, no Remote Login access group membership,
     hidden from the login window. The verification step should check
     this.

7. **Linux cleanup and approval authority are incomplete.** The
   preflight states that pulling images onto the shared cloud host's
   Docker daemon needs the owner's explicit approval. Q3's answer ("ok
   that sounds good") approved a design, not image pulls. Gate 1 says
   "separately approved bootstrap" without naming the approver. Cleanup
   lists containers but not the base and Redis images the goal pulls,
   the fixture network, volumes or build cache. Removing an image
   another workload also uses would breach "unrelated workloads", so the
   manifest should record image digests as present or absent before
   setup and remove only the ones this goal introduced. Driving Docker
   from the host is root-equivalent. The spec should say that only the
   driver uses the Docker socket, that participants never do, and that
   the container runs without `--privileged` and with dropped
   capabilities (already partly stated).

8. **Cleanup order against the review wave is undefined.** The owner
   chose to remove the fixture after validation. Gate 6 requires a
   fresh blind review with accepted findings dispositioned. If cleanup
   runs before the wave, any accepted finding that needs new evidence
   forces the owner to repeat the Mac admin setup and teardown. If
   cleanup runs after the wave, the cleanup itself goes unreviewed.
   Neither order is written down. No gate requires cleanup-completion
   evidence either: Gate 4 speaks of reproducing cleanup, and the
   checkpoint prose says "Missing cleanup is not a completed cleanup
   gate", but that gate does not exist. An owner-dependent teardown
   step also means the lock can stall on owner availability. See Q2.

9. **Reviewers need self-proving receipts because they cannot recreate
   the fixture.** After removal, blind reviewers can audit only
   records. The spec should specify evidence that holds up without
   rerunning:
   - each participant self-reports `getuid/geteuid/getgid/getgroups`,
     home, `os.arch()`, the realpath of `process.execPath`, the runtime
     version, and the SHA-256 of the installed archive it loaded;
   - each exchange carries a nonce logged by both sender and receiver;
   - a driver-side Redis `CLIENT LIST` or `ACL LOG` snapshot shows the
     distinct restricted usernames connected during the run;
   - pre-cleanup and post-cleanup resource manifests exist, with the
     private host inventory kept in the primary checkout's `.scratch`
     and only counts and hashes in tracked results.

   Gate 6's "absolute private evidence paths" in results will embed a
   personal home path, and with it an account name, in a tracked file.
   SEM-2 did the same. That is at odds with "private host inventory
   absent from public records". Decide whether a repo-relative
   reference to the primary checkout's `.scratch/docs/` is enough.

10. **Gate 2 tests a synthetic config, but the debt asks for the real
    one.** The debt record says "Confirm neither test user can read the
    other's private configuration". Gate 2 tests "synthetic private
    config". The stronger and simpler check is to run the denial
    against the actual `semaphile.json` and credential file each account
    uses in the messaging run, contents never logged.

11. **Share-group composition is unspecified.** Three accounts plus
    "intended group" plus "outsider denied" needs a membership decision.
    If all three share, the outsider is a fourth identity such as
    `nobody`, whose semantics differ on macOS and Linux. The cleaner
    plan is two members with the third fixture account as the outsider.
    That is an executor detail, but the gate should name it so the
    check is identical on both platforms.

12. **Public docs and the debt tracker are not addressed.**
    `docs/redis-messaging.md:173-176` and `docs/releases.md:25` state the
    single-OS-account boundary and link GitHub issue 2 as the deferred
    record. The spec says to "link final evidence back to SEM-2" without
    saying how. It does not say whether this goal updates those public
    statements (which then need `npm run check:docs`) or closes or
    comments on issue 2. Changing the public verification boundary is an
    outbound claim, so it is Q4 below.

13. **The SEM-2 references are not materialized for the executor.** The
    References list cites
    `goals/SEM-2-redis-messaging-release/references/deferred-os-account-validation.md`
    and `results/GATES.md`. `goals/EXCLUDED.md` shows that folder is
    excluded from this checkout profile, and the executor worktree will
    have the same profile. Gate 7 maps against the debt record, so copy
    it, and the relevant `GATES.md`/`ARTIFACTS.json` excerpts, into
    this goal's `references/` with lineage (path plus `d585cf9`).

14. **"Unattended" is not defined for the Mac path.** Gate 1 requires
    unattended runs after bootstrap. It should state the mechanical test:
    every identity switch uses `sudo -n` (or BatchMode SSH), no TTY, and
    the matrix completes with no prompt. A cached sudo timestamp from
    the owner's setup session must not count.

15. **Reproducibility is claimed from a single setup run.** With
    removal after validation, "reproducible provisioning" rests on the
    scripts working again later. The fixture is built once, so
    reproducibility is unproven. A cheap partial proof: rerun setup
    against the live fixture and show it refuses on collision, then run
    verification twice. Otherwise, reword Gate 4 to "documented and
    executed once" and do not claim reproducibility.

**Owner choices versus executor details.** Owner choices: Q1 artifact
identity, Q2 cleanup ordering and lock, Q3 Mac switching mechanism,
Q4 docs/issue boundary, Q5 Linux approval authority. Executor details
the planner can settle in GOAL.md: items 1 (inventory), 3, 4, 5, 9, 10,
11, 13, 14 and 15.

## Green-gate checkability

- **Gate 1 (three identities, unattended, receipts):** checkable once
  "unattended" is mechanical (item 14) and receipts carry process
  self-reports (item 9). The Linux ARM64 and one-UID exclusions are
  sharp. Add "fixture accounts cannot log in interactively or remotely"
  (item 6) and "primary group is not the default staff group"
  (item 4).
- **Gate 2 (private home and config access):** checkable through real
  access attempts. Sharpen the target to the real config and credential
  files (item 10), name the share-group membership and outsider (item
  11), and optionally add the personal-home traverse denial (item 4).
- **Gate 3 (messaging matrix):** not checkable as written. "The agreed
  … matrix" has no referent. Put the scenario inventory in GOAL.md:
  pairs × runtime pairings, the named topic and lifetime scenarios that
  cross accounts, the ACL denial set, and readiness reruns. Give
  expected counts per host so "N/N passed" is verifiable. Replace
  "package/source identity" with the artifact choice from Q1.
- **Gate 4 (reproducible, scoped cleanup, ownership model):** partly
  checkable. "Without changing unrelated accounts or workloads" can
  only be shown by a before/after manifest diff kept privately, with
  counts published. "Reviewed ownership model" needs a named reviewer
  (owner or orchestrator) and a recorded location. Cleanup completion
  needs its own evidence clause (item 8). The resource list needs the
  sudoers grant, group, images and network (items 6 and 7).
- **Gate 5 (typecheck and lint formula):** checkable. Fixture scripts
  under `conformance/` or `tools/` fall inside the `npm run lint` oxlint
  roots. Shell scripts do not, so say whether setup and teardown shell
  scripts need `shellcheck` or are exempt. If nothing lands under
  `packages/`, expect Sonar `not applicable`.
- **Gate 6 (blind review, private evidence, AGENTS.md):** checkable,
  apart from the ordering against cleanup (item 8) and the question of
  absolute paths in tracked results (item 9).
- **Gate 7 (debt mapping):** checkable if the debt record is copied into
  references (item 13). The mapping should list all six debt bullets,
  including "Decide provisioning ownership", which this goal answers
  with owner-run admin setup and teardown. "No result claims…" is a
  review-judged negative, which is acceptable.
- **Stop clause:** clear. One addition: an owner who is unavailable at
  the teardown checkpoint is an "unavailable administrator capability".
  State whether that pauses the goal before lock or allows a lock with
  residual debt (Q2).

## Sizing sanity

GOAL.md declares no size. Its frontmatter carries only `status`,
`created` and `type`. Estimated scope:

- two platforms;
- a new cross-UID driver, since reuse is limited to ACL helpers and
  assertions;
- a shared read-only runtime and package install on each platform;
- Redis topology and credential delivery;
- 48 exchanges plus file-access, ACL, topic/lifetime and readiness
  groups on each host;
- setup and teardown scripts with manifests;
- at least two owner admin checkpoints on the Mac, plus a Linux approval;
- a blind review wave.

That is L or XL (8–13 Fibonacci) of engineering, with much longer wall
time because of the owner pauses. One execution session can hold it if
the matrix, artifact and topology decisions are fixed before launch.
Without those decisions it grows. The planner should record a size.

## Open questions and grill suggestions

1. **Which package bytes should the cross-account evidence certify?**
   (a) SEM-2's exact 0.3.0 candidate archives from `800c8c5`,
   hash-pinned. This matches the debt's "same identified package
   archives" and closes the debt against the release candidate.
   (b) A fresh pack at this goal's head. This certifies newer bytes but
   no longer describes the SEM-2 candidate. (c) Published npm bytes,
   which applies only if 0.3.0 has been published. Consequence: (a)
   needs transferring and verifying the durable archive set on both
   hosts. (b) means the SEM-2 candidate's own debt stays formally open.
2. **When does teardown happen relative to the blind review and the
   lock?** (a) After the review wave and all reruns, before lock. Lock
   waits on an owner admin session, and cleanup evidence is reviewed
   only by the orchestrator. (b) Before the review wave. The review
   sees cleanup evidence, but any evidence-changing finding costs a
   full owner re-provision. (c) Lock first, with teardown as a tracked
   follow-up. This contradicts the chosen "remove after validation"
   unless it is time-boxed.
3. **How should the orchestrator account switch into the Mac fixture
   identities?** (a) A sudoers.d rule scoped to "run as the fixture
   users, never root, only the fixture runner path", removed at
   teardown. (b) Per-account SSH keys over localhost, which requires
   granting the fixture accounts Remote Login. (c) The owner attends
   every run, so nothing is unattended. Consequence: (a) is a temporary
   standing privilege on the owner's machine, and (b) opens a network
   login path.
4. **Should this goal change the public verification boundary?**
   `docs/redis-messaging.md` and `docs/releases.md` say separate OS
   accounts remain unverified and link GitHub issue 2. Options:
   (a) update both docs and close or comment on issue 2 when green;
   (b) leave the docs and only comment on the issue; (c) touch neither
   and link from goal records only. Consequence: without (a), the docs
   stay accurate but stale. With (a), the goal gains a public docs
   change and a docs check.
5. **Who approves the Linux bootstrap on the shared cloud host,
   including pulling a base image and a Redis image onto a Docker daemon
   another project uses: the owner or the orchestrator?** Should
   teardown remove those images when nothing else references them?

## Wayfinder signal

`none`. The work is large but not foggy once Q1–Q3 and the matrix
inventory are fixed. Splitting fixture and messaging into separate
goals would fight the owner's remove-after-validation choice: the Mac
fixture would have to persist between goals, which doubles the admin
checkpoints or leaves standing accounts. A single goal with explicit
phase checkpoints fits: fixture verified, then matrix, then review, then
teardown. Revisit if the Mac identity switch proves infeasible without
broader privilege.

## Promote-readiness verdict

`not_ready`. Gate 3 has no agreed matrix, and the reused conformance
code cannot produce cross-account topic or lifetime evidence as it
stands. The artifact under test, the Redis topology and admin
credential custody, and the cleanup-versus-review ordering are
undecided. The cleanup inventory omits the Mac privilege grant and the
Linux images. The SEM-2 debt record the final mapping depends on is not
materialized for the executor. Each of these can be fixed in one more
refinement pass plus the five owner questions above.

CRITIQUE COMPLETE
