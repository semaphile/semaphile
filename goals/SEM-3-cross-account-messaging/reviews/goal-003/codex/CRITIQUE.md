---
agent: codex
model: gpt-6-astra
reasoning_effort: xhigh
round: 3
timestamp: 2026-09-24T06:37:55Z
verdict: not_ready
findings: 1
---

## Summary

The authentication, CLI discovery, expiry sequencing and operational corrections
are consistent with the candidate and preserve the settled scope. The new
dependency-integrity requirement has one concrete omission: it names two
lockfiles that do not contain the resolved/integrity records for OpenTelemetry,
although installing its archive remains mandatory. Add the candidate's OTel
lockfile and require complete coverage of the installed production and peer
dependency tree. This is a narrow engineering correction, with no new owner
choice or package change. My prior ready verdict does not carry forward to this
amended contract until that correction is made. This review used read-only
inspection; no provisioning or product tests ran.

## Plan holes and risks

1. **Medium — The offline dependency baseline omits the required OTel package's dependency tree.**
   `references/verification-contract.md:27–39` requires installation of all four
   unchanged candidate archives, but directs the controller to obtain third-party
   version/resolved/integrity identities from only
   `packages/redis/package-lock.json` and
   `packages/messaging/package-lock.json`. Those files contain no installed
   `node_modules/@opentelemetry/*` integrity entries. The messaging lock records
   the linked `../otel` package's manifest at
   `packages/messaging/package-lock.json:60–98`; its dependency names and version
   requirements are not the resolved, integrity-checked transitive tree.

   This matters even with telemetry disabled during messaging tests:
   `packages/otel/package.json:41–52` declares the API peer and six production
   dependencies for the fourth required archive. Their authoritative records
   exist in the candidate's `packages/otel/package-lock.json`, for example
   `@opentelemetry/api` at lines 93–100, `core` at lines 126–139, and
   `sdk-trace-node` at lines 315–330. `core` also has a version-range dependency
   on semantic conventions; its exact resolution is at lines 332–339. The
   currently named pair of lockfiles cannot supply all those required triples.

   **Correction:** include `packages/otel/package-lock.json` at candidate commit
   `800c8c53b8548250da6bf4a684bf796f1e9e1a73` in the authoritative lock sources.
   Require the staged offline manifest and resulting consumer lock to cover
   every installed production/required-peer dependency with a matching pinned
   version, resolved location and integrity. Missing coverage or conflicting
   identities must block bootstrap rather than permit fresh unpinned resolution.
   This completes the existing four-archive installation requirement; it adds
   no OTel test suite and does not reopen the archive choice.

The remaining correction batch checks out:

- **Authentication and readiness:** The contract now requires `default` off,
  named administrative authentication, per-UID authentication-error probes
  paired with named-user success, and no `requirepass`/`masterauth` secrets
  (`references/verification-contract.md:134–140,155–158,189–197`). R3 is a
  separate synthetic credential. Its inspection capabilities match the
  candidate's CONFIG GET and INFO requests at
  `packages/redis/src/messaging-readiness.ts:12–49`; ordinary credentials keep
  the existing denied-inspection warn/strict cases.
- **Actual CLI discovery:** Home-based case directories and the D1 selector
  prohibition at `references/verification-contract.md:18–25` match discovery
  from cwd upward in `packages/messaging/src/settings.ts:215–250`. The installed
  top-level `info` command can supply the required provenance: its discovery
  branch reaches `admin.info`, which returns `file: project.file`
  (`packages/messaging/src/cli.ts:60–85`;
  `packages/messaging/src/admin.ts:110–157`). The case store can be initialized
  before that observational command. No candidate modification is needed.
- **Case/settings/credential mapping:** The explicit mapping and checks over
  every actual input at `references/verification-contract.md:61–67` resolve
  ambiguity about stores with different normalized settings and permissions
  for the ACL/readiness variants. They preserve exact store grants.
- **Expiry assertions:** History does perform cleanup: its dispatch explicitly
  awaits `sweep` at `packages/redis/src/messaging-transport.ts:182–186`.
  T5's history trigger therefore applies subscription retirement before the
  observation; the sweep processes it at
  `packages/redis/src/messaging-records.lua:188–190`. L1's post-deadline claim
  attempt also sweeps (`packages/redis/src/messaging-receiver.ts:37–62`).
  L3's broadcast goes through admission cleanup
  (`packages/redis/src/messaging-admission.ts:14–24`). The revised ordering and
  in-window publication at `references/verification-contract.md:92–117` are
  compatible with those paths. A blanket claim that history cannot apply
  cleanup would be incorrect for this candidate.
- **Execution boundaries:** Additional owner-assisted harness installations,
  Linux identity-switching capabilities, controller pipe barriers and the
  complete cleanup cross-reference are explicit. Allowing participant protocol
  input does not permit an authentication prompt. Failure triage correctly
  leaves unexplained failures blocked instead of assuming they are harmless
  harness defects (`references/verification-contract.md:54–59,165–175,194–197,275–285`).

## Green-gate checkability

1. **Platform and identities:** Checkable. Participant identity assertions and
   noninteractive switching still apply on both platforms. Linux switching
   capabilities and Mac reinstall checkpoints are now explicit executor
   deliverables; exact commands remain subject to the existing activation review.

2. **Private inputs and shared access:** Checkable. Every mapped configuration
   and credential variant receives owner-positive and cross-account denial
   checks. Authentication probes now rule out passing ACL tests beside an
   unauthenticated default connection. These fixture checks remain outside the
   messaging case total.

3. **Fixed messaging inventory and artifact identity:** The 100-per-platform
   inventory and its assertions remain checkable. D1 now has direct config-file
   provenance, and T5/L1/L3 name the operations preceding expiry observations.
   Complete the dependency-lock baseline in finding 1 before this gate can
   certify the entire required installation. The 200 messaging cases and
   historical-evidence exclusions do not change.

4. **Setup and complete cleanup:** Checkable. The GOAL scope now points to the
   full resource inventory. Named administrator credentials, staged caches,
   grants and installed harness revisions fit the existing manifest and
   teardown requirements. Failure recovery and final cleanup auditing remain
   required, with no deletion of mismatched or unrelated resources.

5. **Quality formula:** Checkable and unchanged. Reviewed bootstrap acquisition
   does not authorize network access during the fast lint tier or participant
   tests. Typecheck, lint eligibility, shell checks when applicable and the
   documented deep-lint outcomes remain distinct checks.

6. **Fresh review and durable evidence:** Checkable. Owner reinstalls for
   accepted harness changes are explicitly budgeted; reviews and affected
   reruns still precede teardown. The final audit and private receipt index
   retain their earlier requirements. Unknown failure attribution cannot
   produce passing evidence.

7. **All six SEM-2 debt criteria:** Checkable after finding 1 is corrected and
   execution produces passing evidence. Required failures still block
   completion, and version-scoped results preserve historical records and
   exclude new registry, failover or cross-host claims.

## Sizing sanity

L (8–13) at `GOAL.md:263–270` reasonably accounts for the retained narrow runner
and additional owner-assisted installations. The correction needed here is a
lock-source amendment and dependency-coverage check within already required
bootstrap work. It does not justify splitting the goal or changing the fixed
case inventory. The orchestrator still sets the execution budget.

## Open questions and grill suggestions

None.

Adding the missing candidate lockfile is an engineering correction under the
owner's existing four-archive choice. Authentication, acquisition and privilege
details continue through the already specified concrete bootstrap checkpoints.

## Wayfinder signal

none — One precise dependency-baseline omission remains. The purpose, case
inventory, lifecycle and owner decisions are settled.

## Promote-readiness verdict

not_ready — Narrowly, the new integrity contract must include the candidate
OTel lockfile and cover the full dependency tree of the four required archives.
The other amendments in this round are consistent and resolve the intended
precision issues. No new user decision, SPEC change or product test expansion
is needed.

CRITIQUE COMPLETE
