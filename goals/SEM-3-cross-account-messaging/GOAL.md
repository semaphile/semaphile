---
status: promoted
created: 2026-09-24T00:01:14-05:00
type: chore
identity:
  schema: 1
  key: SEM-3
  folder: SEM-3-cross-account-messaging
  branch: "SEM-3-cross-account-messaging"
  workspace: SEM-3-cross-account-messaging
promoted: 2026-09-24T01:47:21-05:00
issue_url: https://github.com/semaphile/semaphile/issues/3
---

# Test Redis Messaging Across OS Accounts

## Problem

SEM-2, Add Redis Messaging to the Release Line, verified Redis permissions
under one OS account per host and explicitly deferred separate OS-user,
private-home and configuration-isolation evidence. A future durable range
registry also needs a reusable account fixture, but registry implementation
and its cross-account contract have not been selected.

The owner selected **Fixture plus messaging** during intake on September 24:
prepare the reusable fixture and complete the deferred Redis messaging
validation in this Chore. The original planning request is preserved in
`references/intake.md`; this scope extension is recorded in the grill.

The orchestrator's preflight found neither target environment ready. An
isolated Linux ARM64 container proved basic account/file-permission mechanics,
not native macOS arm64 or Linux x64 messaging. Current environment constraints
and their private evidence location are summarized in `references/baseline.md`.

## Execution shape

After goal-review 001, the owner chose to keep one goal with explicit setup,
test, review, accepted-fix rerun and teardown checkpoints. A planning map or
separate fixture/messaging goals was not chosen. Finish the main review and
any needed test reruns before destructive teardown, then audit cleanup before
completion. The engineering corrections from goal-review 001 are specified below and in
the binding verification contract. A follow-up critique must assess this revision
before any new consensus is reported.

## Scope

1. Establish a repeatable fixture on native macOS arm64 and Linux x64 with
   three distinct unprivileged test accounts, private homes/configurations and
   Node/Bun runtimes accessible without opening personal home directories.
   Linux uses an isolated, resource-limited container on the existing x64
   cloud test host. The three Linux users live inside the container; no host
   accounts are created. The exact resource limits, storage, networking and
   cleanup commands must be reviewed before execution. macOS uses the reviewed administrator
   checkpoints below.
2. Provide bounded automated identity and file-access checks. Verify allowed
   access, cross-account private-file denial and explicitly shared fixture
   access; record real process UID/GID and architecture for each test.
3. Run Redis send, receive and acknowledgment across the distinct OS users
   with separate restricted Redis credentials and independent configurations.
   Use no shared local SQLite store. Preserve the existing shared-store trust
   model: Redis credentials do not authenticate arbitrary message fields.
4. Cover Node and Bun on both platforms, Redis key/channel permission denial,
   and the topic/lifetime and warn/strict readiness behavior required by the
   deferred validation record. The binding inventory is `references/verification-contract.md`.
   Reuse `conformance/redis/messaging-acl.mjs` and related fixtures where useful,
   but do not count their same-UID subprocesses as cross-account evidence.
5. Record reproducible provisioning, test and cleanup procedures. The owner
   chose removal after validation: delete only the dedicated Mac test accounts
   and fixture runtime installation created by this goal, and remove Linux
   fixture containers. Remove per-run credentials and test data. Retain setup
   scripts and sanitized evidence, not a permanently provisioned fixture.
   The complete target list in `references/verification-contract.md`, Manifest,
   recovery and cleanup, also includes grants/groups, services, networks, volumes,
   introduced images/cache and all recorded fixture paths. Existing accounts,
   runtimes and unrelated containers are never cleanup targets. Link final
   evidence back to SEM-2 without rewriting its locked historical goal or
   relabeling the original single-account receipts as multi-account results.
   Fixture readiness alone cannot retire the messaging debt.

This is fixture and conformance work, not a new messaging contract. A discovered
product defect is reported with a reproducer and an explicit scope assessment;
unforeseen requirements do not silently become part of this Chore.

## Package build selected by the owner

Validate the exact retained SEM-2 0.3.0 candidate archives from commit
`800c8c53b8548250da6bf4a684bf796f1e9e1a73`, stored under
`releases/candidates/redis-messaging/0.3.0/800c8c53b8548250da6bf4a684bf796f1e9e1a73/`.
Verify all four archives against the retained SHA256SUMS before installation.
Participants must execute packages installed from those archives; receipts
must establish actual loaded package paths and identity. Recording archive
hashes while running checkout builds does not satisfy this contract.
A product bug blocks validation and returns for a separate fix decision.
Do not silently rebuild or substitute candidate packages. Fixture and harness
changes remain in scope without changing the package bytes under test.

## Green gates

These gates describe the proposed completion contract for goal review.

1. Both required host architectures run three unprivileged
   identities unattended after the separately approved bootstrap. Receipts
   show OS, architecture, UID/GID, home, runtime versions and the exact commands.
   Linux ARM64 or one UID with several Redis users does not satisfy this gate.
2. The fixture's private-home/configuration tests pass for every participating
   account pair. Each user can read its own actual fixture configuration and credential inputs and cannot
   read another user's (permission denial, not missing-file errors); explicitly shared fixture data remains usable by its
   intended group, with an outsider denied. Evidence comes from actual access
   attempts, not permission-bit inspection alone.
3. The fixed matrix in `references/verification-contract.md` passes on macOS arm64 and
   Linux x64 under Node and Bun, with send/receive/acknowledgment, independent
   restricted credentials, denied out-of-scope keys/channels, required topics
   and lifetime behavior, and warn/strict readiness checks. Package/source
   identity and runtime/OS identities accompany the receipts. Failed, skipped
   or unavailable scenarios cannot count as passed.
4. The delivered fixture documents and demonstrates setup, verification and cleanup without
   changing unrelated accounts or workloads. Cleanup identifies only resources
   created by this fixture; credentials and private host inventory are absent
   from tracked scripts, fixtures and public records. Runtime and harness paths
   used for unattended identity switching have a reviewed ownership model.
   Actual cleanup and a final read-only audit pass before completion, including
   privilege revocation, partial-setup recovery and harmless repeated teardown.
5. Workspace typecheck passes AND the fast tier passes (`bun run lint`:
   every `tools.lint` root green, no network) AND the deep requirement is
   satisfied — exactly one of valid `passed` Sonar evidence for this
   head, a validated `not applicable` (the change set touches nothing in
   the effective Sonar scope; fast tier only, no deep coverage claimed),
   or a recorded user waiver (`evie-kit lint waive`, disclosed, never
   green). `evie-kit lint gate` runs the whole formula and writes the
   receipt (exit 0 green, 3 waived — a fast-tier failure is never cured
   by a Sonar waiver; an outage is 4, temporarily skipped, and blocks
   the lock); `evie-kit lint eligibility` decides whether the head being
   locked is still covered (descent plus nothing exercised changed, not
   sha equality).
6. Fresh blind review is complete, including the repository-required Codex
   review, and all accepted findings have recorded dispositions. Raw command
   output and review records remain under the primary checkout's private
   `.scratch/docs/` tree, outside the disposable goal worktree. Results contain
   a sanitized matrix and repository-relative evidence references. The private
   evidence index records absolute locations without publishing personal paths. Completion follows
   AGENTS.md, including its progress marker and final handoff.
7. The final result maps actual evidence to every criterion of SEM-2's deferred
   OS-account validation record, with all six required criteria satisfied. Any unmet criterion blocks completion;
   listing it as residual debt does not pass the gate.
   No result claims registry allocation correctness, shared SQLite support,
   failover guarantees or package publication.

Stop clause: execution stops at an unavailable administrator capability,
unapproved host mutation, or discovered requirement that changes the agreed
contract. It reports the exact unmet prerequisite through the orchestrator.
It does not relax home permissions or weaken a test to obtain a green result.
The orchestrator sets the execution and review budget at launch.

## Open questions (for grilling)

No owner choice currently blocks refinement or its verification review. The owner chose
fixture plus messaging, three accounts per platform, the isolated cloud Linux
container, removal after validation and exact SEM-2 candidate archives.
Reviewer findings may expose another
owner decision; the technical proposals below are not separate owner answers.

## Proposed verification and execution details

These are planner-proposed engineering details for review, not claims of
completed work or permission to activate an unreviewed administrator script.

- Exercise all six directed sender/receiver pairs among the three accounts on
  each platform. For each pair run Node-to-Node, Node-to-Bun, Bun-to-Node and
  Bun-to-Bun send/receive/ack exchanges: 24 exchanges per host, 48 in total.
  Check distinct real UIDs for each exchange. This matrix tests each platform
  independently; it does not claim new cross-host evidence. Existing SEM-2
  cross-host receipts remain historical evidence at their recorded source.
- Run private-file positive/negative checks for all three owners and all six
  cross-account pairs on each platform. Run the required ACL, topic/lifetime
  and warn/strict readiness groups under both runtimes on each platform,
  identifying which participants use each UID. Use the fixed scenario
  inventory in `references/verification-contract.md`; no substitution with
  same-process suites is allowed.
- Identify the exact supported Node/Bun versions, source commit and package
  archive hashes before the matrix. Reuse the SEM-2 runtime line where
  compatible. No silent runtime-major upgrade, registry publication or
  unrelated package version bump is required. Rerun affected evidence if the
  exercised fixture or harness changes. Candidate package bytes remain fixed;
  changing them requires a separate owner decision.
- The Linux execution plan must enumerate CPU, memory, PID, writable-storage
  and log limits after checking available capacity. It may use only its own
  labeled fixture container/network and explicitly scoped fixture paths, with
  no privileged container, host networking, host Docker socket mount, personal
  home mount or unrelated volume. Do not publish Redis publicly or change
  unrelated workloads. A resource shortfall is a reported prerequisite, not
  permission to claim unbounded shared-host resources.
- The Mac setup plan must provide dedicated test identities, private homes,
  shared read-only runtimes, and a narrowly scoped runner for unattended tests
  as those identities. The owner performs the reviewed administrator setup;
  no blanket root delegation is needed. Exact commands and permission checks
  are executor deliverables reviewed before activation, not improvised from
  the preflight's example sudoers wildcard.
- Setup refuses collisions with pre-existing account names or installation
  paths. Cleanup uses a recorded fixture resource manifest, refuses mismatched
  identities/ownership, removes only resources created by this run, and records
  successful removal. No automatic broad Docker prune or personal-home edits.

## References

- `references/intake.md`: verbatim orchestrator planning-request subject.
- `references/baseline.md`: sanitized preflight findings and intake decisions.
- `references/sem2-debt.md`: complete commit-pinned acceptance criteria.
- `references/sem2-baseline.md`: candidate hashes, runtimes and exact historical reads.
- `references/verification-contract.md`: required case inventory and lifecycle.
- `SPEC.md`, sections 16 and 20: existing messaging contract.
- `conformance/redis/messaging-acl.mjs`, `messaging-topics.mjs`,
  `messaging-faults.mjs`, `messaging-participant.mjs` and `harness.mjs`.

## Provisioning and cleanup checkpoints

The Mac currently requires owner-assisted administrator authentication for
account setup. Because the owner selected removal, cleanup also needs a
reviewed administrator step. The executor first produces exact setup,
identity-switching and teardown procedures, with collision detection and
resource ownership checks, for the orchestrator/owner to review. Passwords
must never be requested in chat or stored in goal records.

These are planned interactive checkpoints, not an assertion that the whole
goal can run AFK from launch. The orchestrator follows the managed pause/resume
protocol while waiting for owner action. Tests can proceed unattended once the
fixture is verified. Missing cleanup is not a completed cleanup gate.

## Executor notes (self-sufficiency)

Review-wave diff base: `main`. This goal stacks on no unmerged goal.
The draft starts at `d585cf9b8ff5ad521673d4ffd56af6705242aadb`.
No provisioning or executor launch follows from this unfinished draft.
The planner owns scope; the orchestrator owns launch and landing. Promotion
requires the owner's separate instruction. No new paid service, package
publication or mutation of unrelated users is part of this goal.

The exact private host preflight is
`.scratch/docs/receipts/account-fixture-preflight-20260923.md` in the primary
checkout. It contains candidate setup commands, not an approved bootstrap.
Read it in place; do not copy the host inventory into tracked goal files.
All conformance store paths remain under a repository's `.tmp/`, never a
shared `/tmp`. On each target, establish an isolated fixture checkout beneath
the reviewed installation prefix; its `.tmp/` holds the Redis state and
participant-private non-home scratch as needed. Dedicated account homes contain
their private configuration/credential inputs and CLI working directories so
nearest-file discovery loads the intended config. No participant needs access to the
owner's personal checkout. Export receipts to the primary checkout before teardown.


## Engineering contract and executor checklist

`references/verification-contract.md` is binding scope and acceptance detail,
not optional advice. It specifies 100 messaging case instances per platform,
with fixture checks counted separately, actual package/configuration loading,
Redis topology, safe identity switching and complete cleanup. These are planner
engineering decisions resolving the review, not additional claimed owner answers.

The executor must produce concrete commands, path/account names, image digests,
resource limits and the manifest schema before provisioning. The owner reviews
and performs the Mac administrator steps. The orchestrator presents the bounded
Linux bootstrap (including any required image pulls) to the owner before running
it on the shared host. The existing design choice is not approval of an unseen
privileged script. A need for broader authority returns to the owner.

Update `docs/redis-messaging.md` and `docs/releases.md` only after the required
matrix passes, with the tested candidate, platforms and three-account boundary.
Run `npm run check:docs`. Keep historical SEM-2 receipts and its locked record
unchanged. Prepare a follow-up evidence summary for the orchestrator to attach to
SEM-2; the planner/executor do not change that issue's lifecycle themselves.

Planning estimate: L (8–13), driven by two provisioning paths and retained evidence,
not by the number of generated matrix rows. Allow for repeated owner-assisted
harness installations when review fixes change trusted code. This is a planning estimate only;
the orchestrator chooses execution sizing and budget. If the bounded fixture
cannot fit that launch budget, report the concrete blocker rather than dropping
cases or adding a product-fix allowance. No second full provisioning cycle is
claimed: demonstrate one real lifecycle, two verification passes, collision and
recovery tests, then state exactly what was exercised.
