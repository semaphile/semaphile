---
agent: claude-code
model: claude-opus-5-5
reasoning_effort: high
round: 2
timestamp: 2026-09-24T01:34:00-05:00
verdict: not_ready
findings: 9
---

## Summary

The correction batch is substantial and mostly lands. Every round-1 item
from this critic is now resolved or deliberately handled; the follow-up
table at the end of the next section lists each one. The binding
contract has a fixed inventory: 24 + 16 + 6 + 36 + 18 = 100 cases per
platform, and the arithmetic is right. T1–T8 map one-to-one onto the
eight existing topic cases (`conformance/messaging/topics.mjs:46-142`),
and each is restated for distinct processes. The artifact choice, the
cleanup order, the privilege inventory and the evidence split are all
explicit.

I checked the contract against SPEC section 20 and the candidate source
it will exercise. Three points would still produce wrong or invalid
evidence as written:
1. The fixture Redis's unauthenticated `default` user is never ruled
   out, so the credential-isolation claims could be hollow.
2. The planned cwd layout means the installed CLI never discovers the
   config in the private home.
3. The expiry and retirement observations in T5, L1 and L3 can read
   state before it has been applied.

Each needs a sentence or two in the contract. None reopens an owner
choice. Two further precision items concern dependency identity and
store scoping. After those amendments I expect to return
`ready_to_promote`.

## Plan holes and risks

1. **The contract never rules out the unauthenticated Redis default
   user, which can void credential isolation.** The existing harness
   administers Redis through an unauthenticated connection:
   `createClient({ url: redis.url })` at
   `conformance/redis/messaging-acl.mjs:20` against the bare
   `redis://127.0.0.1:port` from `harness.mjs:151`. Redis's `default`
   user is `nopass` with all permissions unless configured otherwise.
   Under the contract's topology:
   - On Linux, the three participants share the container's loopback
     with Redis.
   - On the Mac, any local account can reach a loopback port.
   - Either way, a participant could connect with no credential and full
     rights.

   The ACL cases (A1–A6) would still pass, because they test what the
   restricted credential cannot do. But Gate 2's claim that one account
   cannot use another's access, and the whole restricted-credential
   story, would not hold for the fixture. "The controller owns
   administrative credentials" does not force a change from the
   harness default. **Amend:** the fixture Redis disables `default`
   (`user default off`, or a password known only to the controller)
   and administers through a named controller ACL user. Add a fixture
   check, per platform and per participant UID: an unauthenticated
   connection and an `AUTH default` attempt are both refused.

2. **R3's `CONFIG GET` grant can expose secrets.** The strict readiness
   probe needs `CONFIG GET appendonly appendfsync
   no-appendfsync-on-rewrite maxmemory-policy` and `INFO persistence`
   (`packages/redis/src/messaging-readiness.ts:12-21,47`). An ACL
   `+config|get` grant cannot be limited by parameter, so an
   inspection-capable participant can also read `requirepass`,
   `masterauth` and file paths such as `dir` and `aclfile`. The
   contract's "only the needed read-only INFO and CONFIG GET
   capabilities" is correct at the command level. It should add that
   the fixture Redis sets no `requirepass` or `masterauth`, which item 1
   covers if admin is ACL-user based. It should also say that R3's
   credential is a synthetic variant owned by the test UID (like
   A1–A6), never the participant's messaging credential.

3. **The planned cwd prevents the CLI from discovering the home
   config.** The installed CLI finds `semaphile.json` by searching from
   the cwd upward and stops at the first file (SPEC section 16,
   "Configuration and retention"; help text at
   `packages/messaging/src/cli-options.ts:26`). Under Service and
   filesystem layout, participant cwd and scratch paths are private
   per-UID subdirectories inside the fixture checkout's `.tmp/`, while
   "private homes contain actual config and credential files". An
   upward search from inside the fixture checkout never reaches
   `$HOME`. D1's installed-CLI exchanges would then either fail or be
   driven by explicit selectors (`--redis-url-env`, `--namespace`,
   `--messaging-store`). The selectors bypass the file, so Gate 2's
   "actual configuration" consumption would not happen. **Amend:**
   - Put each participant's cwd, or its config root, under its private
     home, and keep only the controller-side work and Redis state in the
     fixture checkout's `.tmp/`.
   - Forbid selector flags for D1.
   - Require each D1 receipt to show which config file was loaded
     (for example the CLI's `info` output run by that identity), so
     reviewers can see the home config was used.

   The credential stays an environment reference by design (SPEC
   section 20, "Credentials are environment references"). The
   participant-side wrapper reads the 0600 file inside the identity and
   exports it only to the CLI child. That matches the contract's "load
   the participant's credential only within its identity"; state it so
   the executor does not route it through the runner's arguments.

4. **Third-party dependency identity and acquisition are unpinned.**
   The four Semaphile archives are pinned, but `@semaphile/redis`
   depends on `@redis/client` 6.2.1 and its transitive dependencies
   (`packages/redis/package.json`). The SEM-2 install path is
   `npm install --offline` (`conformance/release/candidate.mjs:40-41`),
   which resolves them from the invoking account's npm cache. That cache
   does not exist in the Linux container or for a Mac fixture prefix.
   "Record installed dependency identities" records whatever resolved;
   it does not pin it. SEM-2 Gate 1 recorded third-party
   version/resolved/integrity triples as unchanged against pinned main.
   **Amend:** install the consumer prefix from dependencies whose
   integrity matches the repository lockfiles
   (`packages/redis/package-lock.json`,
   `packages/messaging/package-lock.json`) at the candidate commit. Name
   the acquisition route: either a pre-verified offline cache copied in
   by the driver, or bounded bootstrap-time registry egress reviewed
   with the Linux plan. Any integrity mismatch blocks the run. The same
   question applies to the Node 22.23.0 / Bun 1.4.2 tarballs for the
   container: checksum-verified, by whichever route the reviewed
   bootstrap names.

5. **Store partitioning and credential scope are left implicit, and
   both evidence gates depend on them.** Several cases need store-level
   settings that are fixed at creation and checked for mismatch:
   - T2 needs `maxPendingPerRecipient: 1` (`topics.mjs:66`);
   - T8 needs a short `claimTtlMs` (`topics.mjs:127`);
   - L2 needs a short claim TTL and the retry delay.

   So the inventory implies several stores per platform. Each account
   then needs matching config files, or config entries, and a restricted
   credential whose key and channel grants cover exactly those stores.
   The store root is `messagingKey(namespace, store)`
   (`packages/redis/src/messaging.ts:30-39`). A broad namespace pattern
   would blur A1's "out-of-store" meaning. This is legitimately an
   executor deliverable, but the contract should require the
   pre-provisioning package to declare the case → store → config-file
   → ACL-grant mapping. Gate 2's own-read and denial checks should then
   run over every config and credential file in that mapping, not one
   representative file.

6. **Expiry, retirement and presence-offline are applied lazily, so
   T5, L1 and L3 can observe stale state.** In the candidate, message
   and claim expiry, subscription inactivity retirement and presence
   expiry are applied in `cleanup()`
   (`packages/redis/src/messaging-records.lua:183-196`). That function
   runs inside store operations; nothing applies them the moment a
   deadline passes. Read-only inspection must not mutate (SPEC section
   16: info reports "without participant registration or logical
   mutations"). So "C sees retirement" (T5), "C observes expired
   terminal state" (L1) and "A's broadcast excludes B" (L3) are only
   defined after an operation that runs cleanup.

   The contract's "wait a computed bound, then assert" rule does not
   cover this. A C-side history read immediately after the bound could
   legitimately still show `pending` or `active`. Under the owner's new
   rule that a product bug blocks the goal, a false failure here would
   halt the run as a "product defect". **Amend:** every
   expiry-observation step asserts only after a defined triggering
   operation. L1 and L3 already sequence one: B's claim attempt, A's
   broadcast. Pin the equivalent for T5, where C's observation follows
   an operation on that store. Describe the probe as observing applied
   state, not a timer.

   The same logic sharpens T5's "publishing alone must not refresh
   inactivity". A's publish also runs cleanup. Once the subscription has
   retired, the publish is REFUSED when there are zero matches (SPEC
   section 20). The assertion therefore needs A's publishes to land
   inside the idle window, before the deadline, with retirement still
   observed after the deadline.

7. **The immutable Mac harness brings the owner back for every review
   fix.** The contract makes the runner and every loaded script
   root-owned and immutable ("Driver/harness changes require
   reinstallation through the reviewed checkpoint"). The sequence also
   puts accepted harness fixes and reruns before teardown. So every
   accepted finding that touches the driver costs an owner admin
   session on the Mac before its rerun. The contract says this, but the
   plan's L (8) and the managed pause protocol should expect several
   such rounds, not one.

   One engineering option can be decided without a new owner question:
   keep the runner and interpreter paths root-owned, and have the runner
   accept only a harness bundle whose hash appears in a root-owned
   allowlist. That still needs owner action per change, so it only
   shrinks the reviewed surface. The real trade-off: the controller can
   already become any fixture identity, so immutability protects runner
   and interpreter integrity, not fixture secrets. If the planner judges
   that controller-deployed harness content under a root-owned runner is
   acceptable, the checkpoint count drops sharply. That would change
   the narrow-switching design the dispositions settled, so it goes back
   through the planner rather than being re-asked here.

8. **Defect triage has no rule separating a harness bug from a product
   bug.** The owner chose to stop on a product bug. The new cross-UID
   driver is large, and it will produce failures that look like product
   failures, especially in the lifetime and expiry cases (item 6).
   Harness fixes are in scope and product fixes stop the goal, so the
   executor needs a stated test for the difference. Suggested
   criterion: a failure counts as a product defect only when a minimal
   reproducer against the installed candidate archives shows a SPEC
   violation with the fixture removed. Single-UID is acceptable where
   the behavior is UID-independent. Everything else is a harness defect,
   fixed with a focused rerun. This protects the owner's rule from
   being triggered by harness noise.

9. **Scope item 5 still lists the narrow cleanup set.** It says "delete
   only the dedicated Mac test accounts and fixture runtime installation
   … and remove Linux fixture containers". The binding contract's
   inventory is much broader: groups, login attributes, runner and
   sudoers grant, Redis state and ACL users, networks, volumes, images
   and caches. A reader of GOAL.md alone gets the round-1 list. Point
   scope item 5 at the contract's "Manifest, recovery and cleanup"
   section as the authoritative target list.

**Follow-up on round-1 items.** Resolved: 1 (fixed inventory, no
same-process substitution), 2 (exact SEM-2 archives by owner choice;
dependency pinning remains as item 4), 4 (non-staff groups plus the
personal-home boundary check), 6 (runner/sudoers grant, no login, and
sudoers validation), 7 (image, network and cache ownership; owner
review of the Linux bootstrap), 8 (order and no lock before verified
cleanup), 9 (receipts, nonces, repo-relative results), 10 (actual
config files, EACCES/EPERM not ENOENT), 11 (A/B share, C outsider), 12
(docs updated after pass, tracker via orchestrator), 13
(`sem2-debt.md` verbatim with lineage; the diff against the pinned
commit shows only the provenance comment), 14 (sudo timestamp
invalidated, no TTY or stdin) and 15 ("demonstrate", with honest
labelling of simulated failure paths). Round-1 item 3 is replaced by
the more specific cwd and discovery issue in item 3 above. Round-1
item 5 is resolved except for the default user (item 1 above).

## Green-gate checkability

- **Gate 1:** checkable. The contract's self-report fields and the
  no-TTY/no-stdin demonstration after timestamp invalidation make
  "unattended" mechanical.
- **Gate 2:** checkable, pending item 5: enumerate every
  config/credential file in scope. Add the unauthenticated/default-user
  refusal from item 1 here or under the fixture checks. The EACCES/EPERM
  requirement, the owner-read pairing and the A/B/C group design are
  sharp.
- **Gate 3:** now checkable. The inventory has fixed counts and roles,
  and 200 cases can be reconciled to receipts. Items 3 and 6 are needed
  so a green D1/T5/L1/L3 means what it claims. "Package/source
  identity" is concrete for Semaphile bytes; add third-party integrity
  (item 4).
- **Gate 4:** checkable. It now names actual cleanup, the final
  read-only audit, privilege revocation, partial-setup recovery and
  repeated teardown. The contract's before/after checks per resource
  class give it a mechanical form. Update the scope wording (item 9).
- **Gate 5:** checkable. Fixture code under `conformance/` falls in the
  oxlint roots. The ShellCheck requirement for delivered shell is now
  explicit. `sonar-project.properties:4` scopes Sonar to `packages`, so
  a change set that leaves `packages/` untouched yields a validated
  `not applicable`. That is consistent with "fixed package bytes".
- **Gate 6:** checkable. Absolute private locations are confined to the
  private index, and results use repo-relative references.
- **Gate 7:** checkable against `references/sem2-debt.md`. "All six
  satisfied, residual debt does not pass" removes the escape hatch.
  "Decide provisioning ownership" maps to the owner-run Mac admin
  checkpoints and the owner-reviewed Linux bootstrap.
- **Stop clause:** clear. The owner-absence pause is explicit. Item 8
  refines what counts as a product-defect stop.

## Sizing sanity

The declared L (8) is plausible for the engineering but optimistic for
the whole goal. The main cost drivers:
- a new cross-UID participant driver with IPC barriers across 100
  cases × 2 platforms;
- two provisioning paths with incremental manifests and simulated
  partial-failure recovery;
- two verification passes;
- the owner-reinstall loop from item 7;
- teardown, then an audit that can trigger a focused review.

13 is the more honest point estimate if the review wave yields more
than one harness fix. The owner chose one goal with checkpoints; the
orchestrator owns the launch budget, and the goal already says to
report rather than drop cases. So this is a calibration note, not a
blocker.

## Open questions and grill suggestions

None. The items above are contract amendments the planner can make
within existing owner decisions. Item 7's trade-off touches the settled
narrow-switching design. Per the goal-001 dispositions it goes back
through the planner and is not re-asked of the owner here.

## Wayfinder signal

`none`. The goal is bounded and the fog is gone: fixed inventory, fixed
artifacts, fixed order. What remains is precision in a few contract
sentences. The owner chose one goal with checkpoints.

## Promote-readiness verdict

`not_ready`, narrowly. Three amendments are needed so the evidence
means what it claims:
- item 1: disable the unauthenticated Redis `default` user and add a
  refusal check;
- item 3: make participants discover their home config, with proof of
  the loaded file;
- item 6: define expiry and retirement observations after a triggering
  operation.

Items 2, 4 and 5 should be folded in at the same time: no secret-bearing
Redis config under a `CONFIG GET` grant, lockfile-pinned third-party
dependencies, and a declared case/store/credential map. Items 7–9 are
calibration and wording. None of these reopens an owner decision.

CRITIQUE COMPLETE
