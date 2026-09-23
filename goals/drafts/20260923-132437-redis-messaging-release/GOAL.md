---
status: draft
created: 2026-09-23T13:24:37-05:00
type: chore
---

# Add Redis Messaging to the Release Line

## Problem

Redis messaging is implemented locally but unavailable on the integration
branch and in the latest published packages. On 2026-09-23, a fresh fetch
showed origin/main at 3ec254e, without the Redis messaging entry point.
The completed feature is feat/redis-messaging at 5b565ac. No remote branch
under that name or repository PR was returned, and npm reported 0.2.0 as
the latest Redis and messaging versions.

The owner agreed to prioritize Redis messaging release readiness, then
selected Chore at intake. The approved proposal and exact reply are in
references/intake.md. This goal prepares existing work for integration
and publication review; the orchestrator owns landing and the owner owns
publication. Sentinel research remains a separate deferred draft.

## Scope

Agreed direction: reconcile the feature with current main, inspect its
included HTTP/MCP proxy work, finish deployment and Redis access-control
examples, and verify the integrated packages.

The owner selected Messaging only. HTTP/MCP proxies remain deferred.
The remaining detail below is the planner's proposed breakdown:

1. Before extraction, preflight required hosts, runtime/server versions,
   review tools and lint/Sonar access. Configure the repository's existing
   checks through supported evie-kit settings, including complete Sonar
   properties and evidence validation. This bounded configuration work is
   owner-approved scope; toolkit feature development is not. If supported
   setup is insufficient, record the missing prerequisite and stop.
2. Extract the messaging increment after baa06dc from the pinned feature
   onto current main, preserving main's evie-kit setup and existing
   branches. Do not merge the full feature ancestry: HTTP/MCP proxies
   are excluded. Reconcile CLI, package manifests, lockfiles, release
   notes and documentation with that exclusion. Audit dependencies on
   earlier shared changes; if messaging needs a broader product change,
   return with the concrete dependency before widening scope.
   Seed the shared-change audit with the earlier invalid-baggage
   trace-dropped telemetry correction expected by the selected tests.
   Account for proxy references in scripts, help, conformance runners,
   specs and docs as well as exports and peers. Inspect dependency-lock
   differences; preserve third-party identities unless a required change
   is explained.
   The messaging increment changes 62 files; its historical receipts
   do not establish correctness of this new integration combination.
3. Preserve SPEC section 20's decided messaging contract, including the
   native-free Redis transport, reconnect without blind mutation replay,
   confirmed claim deadlines, durable topics, agent payloads, and explicit
   SQLite messaging 1.2 upgrade. Native-free means no native/SQLite loading,
   local coordination requirement or install-time compilation for Redis
   use; the existing archives may still contain native components.
   Resolve older deferred wording by
   cross-reference rather than reopening the accepted backend design.
4. Complete a worked exchange under one unprivileged OS account per test
   host, using independent client configurations and distinct restricted
   Redis credentials. Verify send/receive/ack without SQLite coordination,
   Redis denial outside permitted keys/channels, computed-key and
   notification-channel ACL guidance, and warn/strict readiness behavior.
   Record platform architecture and process identity; required targets are
   macOS arm64 and Linux x64. A Linux arm64 container does not prove x64.
   OS-account provisioning, separate homes and cross-account file isolation
   are deferred in references/deferred-os-account-validation.md. Do not
   claim those properties were tested by this release goal. Shared-store
   participants cooperate; ACLs do not provide per-message-field isolation.
5. Verify final integrated source and installed package artifacts across
   macOS/Linux and Node/Bun, including cross-host/restart behavior. Test
   Redis operation with SQLite/native components removed from an installed
   copy; keep the nominated portable archives unchanged.
6. Prepare version 0.3.0 across the four existing packages and produce
   a reviewed release-candidate handoff with exact source and
   artifact identities, peer-version consistency, upgrade instructions,
   and remaining owner publication actions. A source version bump alone
   is not a release. An accessible PR is the orchestrator's landing seam.

## Interview decisions

- Account boundary, revised after review 002: one OS account per test
  host for now; defer separate-OS-account validation as recorded technical
  debt. Retain distinct restricted Redis credentials and ACL tests. This
  supersedes the earlier two-OS-account interview choice.
- Type: Chore, selected over Feature.
- Candidate: messaging only. HTTP/MCP proxy features stay out.
- Version: 0.3.0 across core, Redis, messaging and OTel, selected over
  retaining the feature's 0.4.0 checkpoint number. Publication remains
  the owner's separate action. Reconfirmed after disclosure of existing
  unpublished proxy checkpoint/archive identities: preserve their refs
  and bytes; use a separate source-identified messaging candidate location.

- Lint prerequisite: bounded supported configuration inside this goal;
  stop if new toolkit development is needed. No quality-gate waiver was
  requested or granted.
- Review routing: Keep one goal, with explicit prerequisites and separate
  candidate versus final-release artifact checks. Source integration and
  portable candidate verification remain one deliverable.

## Open questions (for grilling)

No owner scope questions remain. Goal review 003 returned ready_to_promote
from Astra and Opus, with advisory agreement from Pi/Gemini. The three
nonblocking wording/evidence notes are dispositioned in
reviews/goal-003/INDEX.md; the disclosure and architecture obligations are
explicit below. The owner requested promotion with execution deferred.

Extraction dependencies, host/runtime access, precise retained suite
inventory and supported lint configuration remain execution preflight
checks. They are not established by this planning work. Missing required
infrastructure or broader product scope returns to the owner. Separate
OS-account provisioning is no longer a prerequisite of this release goal.

Planner verification requirement: include Node 22 on macOS to close the
reported consumer coverage gap, alongside Node on Linux and Bun on both
platforms. Pin exact runtimes and Redis server versions in the execution
plan; historical results used Node 26.7/macOS, Node 22.23/Linux and Bun
1.4.2 on both. Platform targets remain macOS arm64 and Linux x64.

Deployment examples use the existing URL/TLS options and Redis ACLs.
Adding configurable client certificates or per-actor authorization is
outside this release. Neither feature is implied by the Redis-credentials
example.

## Green gates

These completion predicates cover the selected messaging-only 0.3.0
candidate. Historical receipts inform them but do not replace final
evidence. Review 003 approved the single-OS-account scope and recorded
three nonblocking evidence clarifications, incorporated at promotion. Candidate artifacts are not declared publication-ready until
the post-merge release checks below are satisfied.

1. The integration candidate contains the selected messaging increment
   and preserves main's setup, with shared dependencies accounted for
   and HTTP/MCP proxy features absent; proof is the pinned baseline
   inventory, selected-change record and final diff. Record include,
   exclude or rewrite dispositions with reasons for each commit in the
   pinned shared-ancestor range 67ed8cc..baa06dc. Inventory candidate-wide
   proxy/http-policy references, disposition legitimate test fault proxies,
   verify no @semaphile/proxy lock entries, and inspect third-party lock
   identity changes. Search results alone are not complete exclusion proof.
2. SPEC section 20's decided behavior is preserved, and public docs and
   exports match the candidate; proof is contract comparison, passing
   documentation checks, and installed-consumer results. Link/privacy
   checks alone do not establish API or contract parity. Provide a table
   mapping each DECIDED section 20 clause to its test/receipt and compare
   each package's exports with the pinned feature minus excluded proxy
   and http-policy behavior. Public ACL/deployment guidance and the release
   handoff must disclose that this goal tests one OS account per host;
   separate-OS-user operation and private-file isolation remain unverified.
   Carry the linked debt record into the tracker issue and result.
3. The single-OS-account deployment and Redis ACL recipe pass on macOS
   arm64 and Linux x64 under Node and Bun, using distinct restricted Redis
   credentials, independent client configs and no SQLite coordination.
   Prove send/receive/ack, allowed-store operation, denied out-of-scope
   keys/channels and readiness permission failures. Record architecture,
   unprivileged process identity, commands and output without secrets.
   Separate OS identities and private-file isolation are deferred evidence,
   not passing cases or an implicit claim of this gate.
4. Applicable messaging, Redis, CLI, installed-consumer, telemetry and
   prior limiter regressions pass on macOS/Linux under Node/Bun.
   The CLI/package tests confirm no proxy exports, commands or peers
   leaked into the messaging-only candidate. Cross-host
   recovery and SQLite 1.2 offline upgrade preserve their contract.
   Exercise an identified real 0.2.0 fixture using the installed candidate
   CLI, retaining synthetic rollback/crash tests. Document pilot 0.4.0
   replacement separately; failed-upgrade rollback does not promise
   downgrade after a successful upgrade. Record the retained suite inventory;
   proof is receipts naming final source identity, OS/CPU architecture,
   runtimes, commands,
   counts, exit codes and output. The historical 1050/1050 count is
   reference evidence, not a new run or a frozen future scenario count.
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
   sha equality). Existing repository lint, lint:types, typecheck,
   format:check and check:docs also pass. Record effective fast roots,
   supported tool revision and sanitized Sonar configuration. Inspect the
   receipt's deep state: not-configured does not satisfy this goal, even
   if a tool revision exits zero. Missing configuration is not proof of
   not-applicable. The existing repository lint script is not itself proof
   that evie-kit's fast roots are configured: require fast.configured=true
   and fast.ok=true in the receipt. Use supported command adapters for
   existing package binaries; no root dependency addition is implied.
   Keep Sonar host/authentication settings machine-local. Resolve findings
   with bounded contract-preserving fixes and affected reruns; return if
   a fix requires a contract change or unbounded extra work. The standard
   formula's waiver branch is not a waiver granted by this goal.
   No secret values enter the goal or receipts.
6. All four candidate archives have version 0.3.0 with consistent exact
   Semaphile peers and pass installed consumer checks, including the
   Redis-only native-free case; proof is
   artifact hashes, package metadata and installation/run receipts. One
   identified set of four archives contains both real native targets in
   core and messaging and is tested without repacking across the required
   platform/runtime combinations, with each run recording actual OS/CPU
   architecture and runtime. Record its exact candidate source and
   native source/binary identities. Installed fault-isolation tests may
   remove components from an installed copy, not change the archive set.
   Follow docs/releases.md: build the identified source on each native
   host, collect both verified binaries, then pack once. Record the durable
   archive location outside the disposable worktree and verify hashes there.
7. Fresh blind review findings for the integrated change are recorded and
   dispositioned, accepted findings are fixed, and the configured review
   gate passes. The repository's fresh Codex review and two-round budget
   apply; proof is review records and fix verification, not reuse of the
   historical feature reviews as review of the new integration.
8. No npm publication, protected-branch merge, HTTP/MCP proxy feature,
   Sentinel implementation, harness adapter, or range registry was added
   or performed by this goal's executor; proof is the final diff and
   action record. The result hands
   a reviewed candidate to the orchestrator and owner.

### Candidate versus final-release handoff

Existing checkpoint/0.3.0 and checkpoint/0.4.0 refs and their local release
archives retain their historical proxy identities and bytes. Write the
messaging 0.3.0 candidate outside the disposable goal worktree, in the
primary checkout's releases/candidates/redis-messaging/0.3.0/<source>/.
Never overwrite releases/0.3.0 or relabel its proxy archives. Verify the
saved hashes and record the absolute durable path before worktree cleanup;
ignored files inside a reaped worktree are not durable storage. Record package
version, source identity, archive path and hash together. The final-release
handoff must preserve that distinction when assembling publication bytes.

This goal verifies a candidate before landing. Its archives retain their
candidate source identity; they are not relabeled as the later merge
commit. The orchestrator uses the repository's real-merge convention.
The handoff identifies the later owner/orchestrator checks: compare landed
source with the tested candidate, follow docs/releases.md for final release
identity and assembly, and rerun affected source and exact-archive checks
when that source or those bytes change. Only evidence for the actual final
archive set supports publication. No final release success is claimed by
this pre-merge goal, and no fast-forward-only requirement is introduced.

Stop clause: complete when all eight listed gates have evidence. If the
second review remains as large as the first, stop and return the size
comparison and a split proposal to the owner/planner per AGENTS.md; the
executor does not create goals or waive that rule. If integration needs a new product contract, unavailable
required platform, or additional feature work, record the gap and return
for a scope decision rather than silently expanding or claiming success.

## References

- [Reference index](references/INDEX.md).
- [Verbatim agreed proposal and reply](references/intake.md).
- [Source baseline and evidence](references/baseline.md).
- [Interview](grilling/session-001-20260923.md).
- [Final goal review and dispositions](reviews/goal-003/INDEX.md).
- [Deferred OS-account validation](references/deferred-os-account-validation.md).

## Executor notes (self-sufficiency)

Execution is deferred. Promotion records the agreed goal; it does not
instruct an executor to begin. The orchestrator owns later launch planning
and landing; publication remains with the owner. Tracker: GitHub
semaphile/semaphile, SEM keys. The planner does not launch, merge or publish
packages.

Review-wave diff base: `main`. This draft stacks on nothing. The source
feature is an input, not a managed parent goal or an implicit permission
to merge it. Work only in an isolated candidate worktree; preserve the
existing main, feature, Sentinel draft, and private pilot files.

Use the pinned feature ref to read missing files. Do not trust stale
root dist artifacts as a supported source baseline. Use repo-local .tmp
stores and the agreed conformance host setup. No polling loops, history
rewrites, force pushes or package publication. New native-install
requirements require a separate owner decision.

Private historical evidence lives in the primary checkout's .scratch/docs;
record fresh raw receipts/review dispositions there per AGENTS.md, outside
the disposable goal worktree. Record the absolute evidence paths, with a
shareable sanitized gate summary in the goal's results. The final release handoff
must identify what remains for the orchestrator and owner.
