---
agent: codex
model: gpt-6-astra
reasoning_effort: xhigh
round: 1
timestamp: 2026-09-24T05:26:40Z
verdict: not_ready
findings: 7
---

## Summary

The selected scope is coherent: establish three dedicated identities on each
required platform, validate the deferred Redis deployment boundary, and remove
the fixture while retaining its recipe and evidence. The proposed 48 exchanges
correctly cover directed account pairs and runtime combinations within each
platform; they need not repeat the historical cross-host matrix. Promotion
should wait for a fixed behavioral inventory, an explicit requirement to execute
the identified archives, and a complete provisioning/review/cleanup lifecycle.
The remaining issues are mostly engineering corrections. One owner decision
remains unclear: whether a discovered product bug may be fixed within this Chore.
This critique assumes the existing cooperative-store contract and the four
recorded owner choices remain fixed. No provisioning or tests were performed.

## Plan holes and risks

Paths beginning with `GOAL.md` below refer to this draft. SEM-2 citations refer
to the historical files at pinned commit
`d585cf9b8ff5ad521673d4ffd56af6705242aadb`; that goal is excluded from this
worktree by the checkout profile but remains readable through `git show`.

1. **High — Gate 3 has no settled behavioral inventory.**
   `GOAL.md:44–48` says to specify the matrix during refinement, while
   `GOAL.md:134–138` leaves the precise inventory until execution. The 48
   exchanges establish direct send/receive/ack coverage, but do not define what
   passes “required topics and lifetime behavior.” Subscription inactivity,
   message expiry, claim expiry and presence lifetime are different behaviors
   in `SPEC.md:550–565` and `SPEC.md:748–775`. The referenced topic suite runs
   clients within one process (`conformance/messaging/topics.mjs:9–23`), so
   invoking it under one fixture account does not create another cross-account
   exchange. Likewise, the ACL fixture tests warn/strict behavior when inspection
   is denied (`conformance/redis/messaging-acl.mjs:153–168`), whereas the participant
   fixture always requests strict startup
   (`conformance/redis/messaging-participant.mjs:9–15`).

   Before promotion, enumerate the required cases with assertions, account
   roles, runtimes and evidence identifiers. Distinguish new cross-account
   cases from retained behavioral evidence. Define which topic/lifetime cases
   and readiness outcomes are required, including whether strict success is
   new evidence or an explicitly retained result. This can be a bounded table;
   it does not require rerunning every historical suite or multiplying every
   lifetime case by all six account pairs. A list of suite filenames alone is
   insufficient because their present process and credential models differ.

2. **High — Recording archive hashes does not require executing those archives.**
   `GOAL.md:79–80` and `GOAL.md:139–143` require package/source identities, but
   never say that every participant must load installations made from one
   identified archive set. SEM-2's deferred criterion expressly requires the
   same identified archives
   (`goals/SEM-2-redis-messaging-release/references/deferred-os-account-validation.md:31–33`).
   The proposed reusable fixtures import checkout `dist` files directly:
   `conformance/redis/messaging-acl.mjs:8–9,47` and
   `conformance/redis/messaging-participant.mjs:3–8`. Hashing release archives
   beside a successful source-tree run would leave that debt criterion open.

   Require installation of the nominated messaging package set into accessible,
   read-only fixture paths, and record the participant's resolved package
   locations plus archive identities. Choose the existing SEM-2 archives with
   an explicit source comparison, or assemble one newly identified set; use
   the chosen bytes consistently across users/platforms/runtimes. The installed
   consumer pattern in `conformance/release/candidate.mjs:25–43,186–199` is
   available without importing that entire release suite into this goal.

3. **Medium — The private-file gate can pass without testing the configuration used by messaging.**
   Gate 2 permits a synthetic private file, and Gate 3 separately requires
   independent configurations (`GOAL.md:71–81`). Neither explicitly joins those
   facts. The current ACL fixture creates two configuration directories under
   one owner and inherits the parent's environment when spawning clients
   (`conformance/redis/messaging-acl.mjs:75–80,108–123`). Merely adding an identity
   switch and unrelated private-file probes could leave the real config,
   credential inputs or administrator environment shared.

   Require each messaging participant to consume its own synthetic fixture
   configuration and its own credential input, and apply the access-denial
   checks to those actual inputs. A missing path must not count as denied
   access: pair each denial with the owner's successful read and check the
   failure reason. Define the runner's HOME, working directory and allowed
   environment explicitly; do not inherit another participant's or the
   controller's credentials. Record/assert real and effective IDs and group
   memberships from the participant process, not only from the launcher.
   These checks substantiate private configuration and unprivileged execution;
   they add no per-message authorization claim.

4. **Medium — Redis provisioning and the administrative test role are missing from the fixture plan.**
   The Linux constraints prohibit a privileged container and a Docker socket
   mount (`GOAL.md:144–150`). However, `server()` starts Docker on Linux unless
   an external endpoint is supplied (`conformance/redis/harness.mjs:81–109`);
   running the existing suites unchanged inside the fixture would therefore
   require a capability the plan excludes. The external-endpoint escape also
   delegates server lifetime and cleanup to someone else. The ACL fixture uses
   that endpoint for administrative `ACL SETUSER`/`DELUSER` operations
   (`conformance/redis/messaging-acl.mjs:21–23,48–61,218–226`), and its application
   credentials intentionally cannot inspect readiness settings
   (`docs/redis-messaging.md:232–237`).

   Add a required bootstrap-plan section naming the dedicated Redis service,
   pinned server version, owner, endpoint, readiness configurations and cleanup
   owner on each platform. Separate controller/admin connections from the
   restricted participant connections. Describe how the harness receives this
   service without nested Docker or permissions added to the test identities.
   A server inside the bounded container or a separately approved fixture
   service are implementation choices; the owner need not choose the command
   syntax. Include service storage/logs in the reviewed resource envelope and
   prevent accidental use of an unrelated endpoint.

5. **High — Cleanup does not define recovery from partial setup or revocation of fixture privileges.**
   `GOAL.md:49–54` names accounts, runtimes, containers, credentials and data;
   `GOAL.md:151–160` adds a runner, ownership checks and a resource manifest.
   The manifest rule says to remove only owned resources, but does not establish
   that every created resource is recorded before setup can fail, or that the
   runner's privilege grant and any fixture groups are teardown targets. A
   failed setup after account creation could leave resources that a subsequent
   collision-refusing setup cannot safely reuse. Successful deletion of homes
   and runtimes alone would not establish complete cleanup.

   Extend the lifecycle contract to interrupted/failed provisioning and failed
   tests. Require incremental ownership records, a safe resume-or-cleanup path,
   and refusal without deletion when recorded identities no longer match.
   Enumerate every resource class the chosen design creates, including runner
   authorization, shared groups, service processes, networks and fixture paths.
   Teardown must revoke fixture access, stop owned processes and verify the
   recorded resources are removed; repeated cleanup must be harmless. Keep
   mismatched resources reported for owner action. Exact commands can remain
   executor deliverables reviewed before activation, as already proposed.

6. **Medium — Removal, review reruns and durable evidence have no execution order.**
   The owner selected removal after validation (`GOAL.md:49–53`), Gate 6 requires
   fresh review (`GOAL.md:99–104`), and affected evidence must be rerun after
   source/package changes (`GOAL.md:139–143`). The draft does not say whether
   review occurs before destructive teardown. A review fix could otherwise
   require another owner-assisted bootstrap after the accounts and trusted
   runner are gone. Absolute log paths also do not by themselves tie each
   matrix cell to the particular installed harness and identity-switching
   procedure that produced it.

   State the sequence: approved setup, fixture checks, matrix, review and
   accepted-fix reruns, durable evidence capture, approved teardown, then
   cleanup audit and completion. Include a return to approved provisioning if
   an exercised change is accepted after teardown. Capture run/case IDs,
   harness and bootstrap identities, runtime/package identities, participant
   identities, commands, exit statuses and output before deleting resources.
   Give reviewers a documented read-only way to reconcile the retained matrix
   with those private receipts, without host access or reprovisioning. Historical
   receipt inspection must remain distinguishable from a fresh test run.

## Green-gate checkability

1. **Three unprivileged identities on each architecture:** Checkable after the
   approved setup. Require identity output from the processes doing the work,
   including effective IDs/groups and their actual runtime executable. Record
   host OS/architecture and the Linux container/image identity separately.
   Administrator assistance is a disclosed prerequisite, not a passing result.
   Finding 3 supplies the missing identity/environment linkage.

2. **Private and shared file access:** Checkable with three own-file successes
   and six directed cross-account denials per platform, using the actual
   fixture configuration/credential inputs described in finding 3. Record
   permission-denial errors rather than any generic failure. Two of the three
   accounts can belong to the sharing group and the third can be its outsider;
   this gate does not inherently require a fourth account.

3. **Cross-account messaging matrix:** Not yet a fixed pass/fail contract.
   Resolve findings 1–4, then count the 48 direct exchanges separately from the
   named ACL/topic/lifetime/readiness groups. Each result needs a case ID,
   assertion outcome and actual participant/artifact identities. Keep historical
   cross-host receipts outside the new cross-account totals. Unavailable and
   failed cases remain non-passes.

4. **Reproducible setup, verification and cleanup:** Partly checkable as written.
   Findings 5–6 supply the failure/retry lifecycle and teardown assertions.
   Provide checks for collisions, ownership mismatch, partial provisioning and
   repeated cleanup, plus receipts for the real successful lifecycle. Audit the
   chosen runner's ownership and invocation boundaries before activation; a
   statement that its model was reviewed is insufficient without the reviewed
   procedure and its checks. Secret exclusion should cover retained command
   output as well as tracked files.

5. **Typecheck and lint formula:** Checkable as written. Retain the explicit
   typecheck result, formula receipt and final eligibility decision. A validated
   Sonar non-applicability result is plausible for fixture-only changes but must
   be computed from the actual diff; a product change can alter that scope.
   Preserve the distinction between passed, waived and unavailable outcomes.

6. **Fresh reviews and private records:** Checkable with the ordering and
   evidence index in finding 6. Preserve findings and dispositions, verify that
   their private paths remain readable outside the disposable worktree, and
   record the reviewed source/harness version. Reviewers should audit existing
   hardware/account receipts; launching accounts or remote tests is a separate
   authorized execution step. Apply the repository's two-round limit.

7. **SEM-2 debt mapping:** Checkable once the inventory is fixed. Map each of the
   deferred record's six acceptance bullets to exact evidence, explicitly
   including its identified-archives requirement. Required debt criteria that
   remain unmet block completion; “residual debt retained” cannot turn an
   incomplete required gate into a pass. Keep unrelated registry/failover and
   historical cross-host claims outside this mapping. Add the follow-up result
   link without editing the locked SEM-2 record.

## Sizing sanity

No t-shirt or Fibonacci estimate is declared; `chore` is a change category,
not a size. The 48 exchanges are a small automated matrix. Most effort lies in
two provisioning models, adapting the harness, collecting usable evidence,
recovering from partial setup and allowing review-driven reruns before removal.
This can remain one goal with planned owner checkpoints and a bounded scenario
inventory. Estimate it after that inventory and the Redis service plan exist,
and reserve launch budget for the two permitted reviews and teardown. An
unbounded product-fix allowance would change that assessment.

## Open questions and grill suggestions

7. **If the cross-account tests expose an existing messaging bug that prevents
   the required matrix from passing, should this Chore stop for a separate fix
   decision, or may it include a bounded fix that preserves SPEC?**
   `GOAL.md:59–61` requires a reproducer and scope assessment, while the stop
   clause at `GOAL.md:110–114` expressly covers changed contracts but leaves
   contract-preserving product fixes unclear. Suggested choices: **Stop for a
   separate fix decision (Recommended)**, which keeps this deliverable focused
   on fixture/conformance work and leaves the gate blocked; **Allow bounded
   contract-preserving fixes**, which permits product edits plus affected
   package builds, tests and reviews within a stated budget; **Go deeper —
   explain more before I decide**. Either choice retains the agreed messaging
   contract and prohibits claiming the failed scenario as green.

The other findings can be resolved by the planner/executor as engineering
details. They do not justify re-asking the account count, platforms, selected
Linux host model, removal choice or messaging scope.

## Wayfinder signal

none — The purpose, platforms and product boundary are already narrow. The
identified holes need a scenario table and a complete operational lifecycle,
not a new product discovery exercise. Planned administrator pauses are
compatible with one goal. Reconsider sizing if the fixed inventory or an
authorized product repair exceeds the launch budget.

## Promote-readiness verdict

not_ready — Finalize the required cases, require execution of the nominated
archives, join configuration isolation to the actual participant processes,
and specify the Redis control role and complete teardown/review sequence.
Resolve the product-fix boundary before launch. These changes make the existing
scope verifiable without adding registry work, new cross-host guarantees or
unrelated historical suite runs.

CRITIQUE COMPLETE
