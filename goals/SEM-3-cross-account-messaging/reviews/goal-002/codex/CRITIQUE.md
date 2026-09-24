---
agent: codex
model: gpt-6-astra
reasoning_effort: xhigh
round: 2
timestamp: 2026-09-24T06:31:54Z
verdict: ready_to_promote
findings: 0
---

## Summary

The revision resolves my seven first-round findings. The binding contract fixes
the inventory at 100 messaging cases per platform, requires execution of the
retained candidate archives, connects file isolation to the inputs actually
consumed, and specifies Redis ownership, interrupted setup recovery, privilege
revocation and review-before-teardown ordering. I checked the named cases
against the candidate's APIs and found no required behavior that needs a package
change. The owner's product-fix decision is now explicit. Exact commands,
resource limits and installation paths can remain reviewed executor deliverables.
This is promotion readiness of the plan; no provisioning, test execution or
fresh platform evidence is claimed by this review.

## Plan holes and risks

None.

References to `GOAL.md` and `references/` below are relative to this draft.
The first-round findings are resolved as follows:

| Prior finding | Resolution checked |
| --- | --- |
| 1. Unfixed behavioral inventory | `references/verification-contract.md:36–113` fixes D1, T1–T8, L1–L3, A1–A6 and R1–R3, their account/runtime assignments and assertions. Historical unsafe-setting and timer-injection evidence is explicitly outside the new totals. |
| 2. Hashes without installed execution | `GOAL.md:73–84` selects the exact SEM-2 archives. `references/verification-contract.md:20–28` requires transfer/install hashes, comparison of installed files with archive contents, dependency identities and resolved entrypoints, and excludes checkout imports and substituted packages. The four recorded hashes agree with the pinned historical ARTIFACTS record. |
| 3. Private probes disconnected from real inputs | `references/verification-contract.md:11–34,117–127` requires actual configuration and credential consumption under the target identity, clean environments, effective IDs/groups, owner-positive reads and specific cross-account permission failures. |
| 4. Missing Redis service/controller plan | `references/verification-contract.md:144–176` pins Redis and runtimes, places Linux Redis inside the fixture container, separates controller privileges, injects the endpoint and prohibits nested Docker and personal mounts. |
| 5. Incomplete cleanup and partial recovery | `references/verification-contract.md:138–142,178–200` covers incremental intent/observed ownership records, interrupted creation, identity mismatch, privilege grants, processes, groups, data and container resources, plus repeated teardown and explicit handling of objects that become shared. |
| 6. Review and removal ordering | `GOAL.md:27–35` and `references/verification-contract.md:202–221` put review/fixes/reruns before destructive cleanup, preserve durable evidence, require a final cleanup audit and return to approved provisioning for later exercised changes. |
| 7. Product-fix authority unclear | `GOAL.md:75–84` now requires reporting a product bug and returning for a separate fix decision. Harness fixes remain in scope; the candidate bytes stay fixed. |

The candidate API check supports the new inventory. There is no diff from
candidate source `800c8c53b8548250da6bf4a684bf796f1e9e1a73` to this checkout's
HEAD in the inspected package and Redis/messaging conformance trees. In
particular:

- D1 can inspect acknowledged delivery state and repeat a successful ack:
  `packages/redis/src/messaging-delivery.lua:98–115,120–143` supplies both.
- T1–T4 match the existing fanout/dedupe, reserved-recipient and retirement
  behavior at `packages/redis/src/messaging-delivery.lua:1–35` and
  `packages/redis/src/messaging-records.lua:164–179`.
- T5 retirement can be observed through subscription listing without renewing
  activity (`packages/redis/src/messaging-actions.lua:98–116`). T6 can use an
  idle subscription listener: both waiting and listening use the activity
  renewal machinery in `packages/messaging/src/subscription.ts:40–75,121–129,190–208`.
  T8's graceful-close renewal is supported by the existing close allowance for
  subscription activity and claim renewal
  (`packages/messaging/src/shared-transport.ts:106–119`), with an existing
  analogous case at `conformance/messaging/topics.mjs:126–142`.
- T7's specified error codes are supported by
  `packages/redis/src/messaging-actions.lua:83–87` and
  `packages/redis/src/messaging-input.ts:32–42`.
- L1 can inspect an expired delivery through history; history performs cleanup
  before reading state (`packages/redis/src/messaging-transport.ts:182–186`;
  `packages/redis/src/messaging-records.lua:155–162`). L2's replacement claim
  and stale receipt correspond to the existing case at
  `conformance/redis/messaging.mjs:58–67`. L3's expired-presence exclusion and
  durable direct recipient are compatible with
  `packages/redis/src/messaging-delivery.lua:21–35` and
  `packages/redis/src/messaging-records.lua:193–197`.
- A4–A6 and R1–R2 preserve the historical assertions at
  `conformance/redis/messaging-acl.mjs:153–210`. R3 supplies the inspection
  permissions and safe service settings needed by
  `packages/redis/src/messaging-readiness.ts:12–59`; it does not expand the
  durability guarantee.

The controller/runner implementation still needs the specified inspection
before activation. That is an explicit execution checkpoint, not an unresolved
request for broader privilege or a missing product decision.

## Green-gate checkability

1. **Architectures and three unprivileged identities:** Checkable. The
   participant report and manifest comparison identify real/effective IDs,
   groups, runtime executable and architecture. The noninteractive Mac switch
   must work without a cached sudo timestamp
   (`references/verification-contract.md:30–34,129–136`). This evidence cannot
   be replaced by a launcher identity or Redis username.

2. **Private configuration and intentional sharing:** Checkable. The contract
   names the actual inputs, positive owner reads, all six directed denials per
   platform/runtime and acceptable error classes. A/B provide the permitted
   sharing pair and C the outsider. Write-denial checks cover trusted code and
   runtimes (`references/verification-contract.md:115–127`). No extra account
   or access to personal file contents is required.

3. **Messaging matrix:** Checkable. Per platform the arithmetic is
   `24 + (8 × 2) + (3 × 2) + (6 × 3 × 2) + (3 × 3 × 2) = 100`.
   Across both platforms, 48 direct cases plus 44 topic/lifetime cases are new
   cross-account evidence; 72 ACL and 36 readiness cases are explicitly
   per-identity reruns. These sum to 200. Fixture checks and repeated fixture
   verification are separate. The case definitions have compatible API
   assertions, fixed runtime assignments and an explicit prohibition on
   substituting single-process suites. No new cross-host result is claimed.

4. **Setup, isolation and complete cleanup:** Checkable through the reviewed
   procedure, real lifecycle receipts, negative/recovery tests and final
   resource reconciliation. Partial simulations must be labeled. The manifest
   protects preexisting resources and records privilege removal; ownership
   drift or newly shared images cannot be silently ignored. Missing teardown
   keeps completion paused (`references/verification-contract.md:178–212`).

5. **Typecheck and lint formula:** Checkable as written. Actual diff scope
   determines deep-lint applicability, and a waiver remains disclosed rather
   than green. Shell scripts additionally receive syntax and ShellCheck checks
   (`references/verification-contract.md:223–225`), so the plan no longer relies
   on TypeScript lint to cover provisioning code.

6. **Fresh review and retained evidence:** Checkable. Code review precedes
   removal; the final audit compares actual removal with reviewed code and
   manifests. Private records preserve identities, hashes, commands, statuses
   and case IDs; public results omit personal paths. Reviewers can reconcile
   receipts without connecting to hosts. Material audit findings require
   disposition and focused review within the existing budget, and missing
   cleanup blocks completion.

7. **All six deferred criteria:** Checkable. The complete pinned debt record
   is available in `references/sem2-debt.md`; the new contract supplies identity,
   archive, exchange, permission, runtime/receipt and topic/lifetime/readiness
   evidence. `GOAL.md:131–135` forbids passing with an unmet criterion.
   `GOAL.md:253–257` specifies version-scoped public documentation and an
   orchestrator follow-up summary while preserving the locked SEM-2 history.

## Sizing sanity

L (8) is plausible for the stated scope (`GOAL.md:259–265`). The work is dominated
by two provisioning paths, a cross-process harness and durable evidence, with
owner-assisted checkpoints. The 200 instances reuse a bounded set of cases;
they are not 200 separate implementations. Fixed candidate bytes and the
separate product-fix decision keep the scope bounded. The plan accurately
claims one real provisioning lifecycle, repeated fixture verification and
labeled recovery tests, rather than an unperformed second full lifecycle.
Execution budget remains the orchestrator's responsibility. No split is needed
to address the issues raised in this review.

## Open questions and grill suggestions

None.

The owner has settled the artifact target, product-fix boundary and one-goal
execution shape. Command syntax, scoped paths, resource limits and image
digests belong to the specified executor review checkpoint. They do not need
another product interview at promotion review.

## Wayfinder signal

none — The fixed case inventory, candidate selection and complete lifecycle
remove the earlier ambiguity. The remaining work is bounded implementation
and verification with explicit operator checkpoints.

## Promote-readiness verdict

ready_to_promote — All seven first-round findings are resolved in the binding
plan, and the required assertions are consistent with the inspected candidate
APIs and SPEC. Host readiness, administrator procedures and actual passing
receipts remain execution prerequisites. Promotion and launch still require
the owner's separate instruction.

CRITIQUE COMPLETE
