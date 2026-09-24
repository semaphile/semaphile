---
agent: codex
model: gpt-6-astra
reasoning_effort: xhigh
round: 1
timestamp: 2026-09-23T18:48:45Z
verdict: not_ready
---

## Summary

The messaging-only 0.3.0 direction is coherent, and the goal correctly separates
integration, landing and publication. It preserves the accepted contract and
does not mistake historical checks for validation of the extraction. Before
promotion, make the lint prerequisite executable, tighten the proof for the
actual release archives, and define which account boundary the deployment
example must exercise. The extraction also has a concrete dependency on an
earlier telemetry correction; that is manageable engineering work within the
proposed audit, not evidence that proxy features must ship. This critique uses
pinned source and existing records only; no tests, builds, services, other
critics or credential files were used. References prefixed `5b565ac:` refer to
the feature snapshot; unprefixed repository source references refer to the
main-based checkout. Installed evie-kit source is identified separately and is
not part of either pinned Semaphile commit.

## Plan holes and risks

1. **P1 — Gate 5 lacks a demonstrated configuration and an exact match to
   the invoked gate. Promotion blocker.** The goal equates `bun run lint`
   with the configured `tools.lint` fast tier and permits precisely three
   deep-tier outcomes (`GOAL.md:110`). The actual root script invokes the
   repository's package lint scripts (`package.json:10`); the tracked
   settings declare a review engine but no lint roots or Sonar block
   (`.evie-kit/settings.ts:33`), and the tracked inventory contains no
   `sonar-project.properties`. Inherited configuration remains unverified,
   not presumed absent.

   This distinction matters mechanically. The installed
   `node_modules/@evie-kit/goals/src/lintGate.ts:139` resolves its own
   roots and runs them directly. Its `lintReceipt.ts:151` rejects an
   unconfigured fast tier, but `lintReceipt.ts:159` accepts
   `not-configured` deep evidence as green. That fourth outcome does
   **not** satisfy the goal's three-way formula. A Sonar block without a
   properties file is instead refused (`lintDeepTier.ts:113`), before
   waiver handling.

   Add a prerequisite identifying the effective roots, complete Sonar
   configuration, supported tool revision and who supplies them. Record
   a sanitized configuration summary; no credentials belong in the goal.
   Inspect the receipt's actual deep state as well as its exit code.
   Retain the repository lint command separately unless equivalence to
   the configured fast tier is established. Configuration absence must
   not become “not applicable,” and provisioning must not become an
   unbounded tooling repair hidden inside this release.

2. **P1 — Gate 6 can be satisfied with platform-local repacks instead of
   one portable release candidate. Promotion blocker in the evidence
   definition.** The gates request identities but do not explicitly require
   the **same four archive hashes** on all four OS/runtime combinations
   or both genuine native targets in the shipped core and messaging
   archives (`GOAL.md:51`, `GOAL.md:122`). The existing release procedure
   does: `docs/releases.md:54` requires both targets, testing those exact
   archives, and preservation without repacking.

   The harness makes this a concrete risk.
   `5b565ac:conformance/redis/messaging-package.mjs:32` always packs local
   package directories; it has no supplied-archive path.
   `5b565ac:conformance/messaging/package.mjs:34` accepts a messaging
   archive but still repacks core at line 68. Ordinary native builds
   delete old native output and install only the current host's target
   (`packages/core/package-build.mjs:67`). Green host-local tests therefore
   do not prove that the owner receives one usable two-platform release.

   Make the release procedure an explicit gate dependency: clean candidate
   build; verified source/binary manifests for darwin-arm64 and linux-x64;
   assembly into core and messaging; one four-archive set and hash manifest;
   then installation and execution of that exact set on every required
   pairing. Adapt the consumer harness to accept those archives. Include
   the privacy, license, executable-mode and real native-header checks
   already required by `docs/releases.md:59`. Tests may modify an installed
   copy for fault isolation; preserve the verified original archive.

3. **P2 — “Installation without SQLite/native components” needs to match
   the decided runtime guarantee. Wording correction, not a new product
   interview.** `GOAL.md:53` can be read as promising that an ordinary
   Redis-only installation contains no native or SQLite files. The
   accepted contract says the Redis runtime must load neither and require
   no local coordination files (`5b565ac:SPEC.md:846`). The messaging
   package publishes its whole dist tree
   (`5b565ac:packages/messaging/package.json:22`), including the native
   target expected by its SQLite consumer test
   (`5b565ac:conformance/messaging/package.mjs:55`). Its Redis consumer
   proof removes native files, SQLite implementation modules and core
   **after** installation
   (`5b565ac:conformance/redis/messaging-package.mjs:103`).

   State acceptance as no native/SQLite loading or local coordination
   requirement, no install-time compilation, and successful operation when
   those installed components are absent. Describe the published package
   contents accurately. Requiring an ordinary installation to omit those
   bytes would be a different packaging contract, beyond extraction of
   the existing four-package feature.

4. **P2 — The account boundary and readiness assertions are
   underspecified.** `GOAL.md:47` and `GOAL.md:99` do not distinguish
   two operating-system users from two Redis ACL users. Separate OS users
   exercise independent homes/configuration without shared local store
   access; separate Redis users exercise remote permissions. The consumer
   assessment connects the deployment need to avoiding shared SQLite
   permissions (`.scratch/docs/handoffs/20260922-2242-consumer-feedback.md:72`,
   primary checkout).

   Define the required identities before promotion; the recommended case
   uses both distinctions. Keep them cooperating users, as the goal
   already says, and let the executor choose the harness. Require the
   documented allowed store to work and an unrelated computed store/channel
   to be refused, covering the root key, derived keys and notification
   channel. Exercise direct delivery/acknowledgment and topics, including
   renew/cleanup permissions, rather than only opening a client.

   Specify positive and negative readiness expectations. The existing
   strict test checks refusal against an unsafe server
   (`5b565ac:conformance/redis/messaging.mjs:85`); the restricted-user
   test allows everything except ZADD
   (`5b565ac:conformance/redis/messaging-faults.mjs:253`). Neither proves
   the proposed restricted deployment. Require a correctly configured
   server where inspection is permitted and strict startup succeeds;
   denied CONFIG GET and denied INFO cases where warn emits a diagnostic
   and messaging still works, while strict refuses without creating store
   state; and separate failures for missing operational key/channel
   permission. Warn mode does not bypass necessary command permissions.
   These are checks of existing behavior, not new authorization features.

5. **P2 — The shared-change audit already has a concrete dependency.
   Execution risk, not a reason to reopen scope.** Applying only
   `baa06dc..5b565ac` leaves main's
   `packages/messaging/src/telemetry.ts:57` unchanged: invalid baggage
   options become an empty list without a diagnostic. The imported
   `5b565ac:conformance/otel/messaging.mjs:183` requires the
   `trace-dropped` diagnostic. That correction predates the selected
   boundary, visible in
   `git diff 3ec254e baa06dc -- packages/messaging/src/telemetry.ts`.
   The Redis telemetry suite delegates to this shared test. This is a
   static dependency finding; no failure run is claimed.

   Seed the selected-change record with this correction and disposition
   other earlier shared changes individually. Earlier exporter lifecycle
   fixes also exist; that does not authorize importing their whole ancestry
   or automatically adding their API changes. The minimal contract-preserving
   correction fits the existing audit. Also preserve the increment's build
   ordering: `5b565ac:package.json:9` puts messaging before Redis because
   `5b565ac:packages/redis/src/messaging.ts:3` imports its new client
   subpath. Retaining main's build script wholesale loses that ordering.
   Verify with a clean build without inherited dist output.

   Proxy exclusions are identifiable in the CLI dispatcher
   (`5b565ac:packages/messaging/src/cli.ts:15`), help
   (`packages/messaging/src/cli-options.ts:6`), optional peer
   (`packages/messaging/package.json:49`) and root build/test entries.
   No direct dependency on the HTTP/MCP proxy runtime was found in the
   Redis messaging entry or shared client examined here.

6. **P2 — Upgrade evidence should include the actual prior release
   boundary. Execution-plan improvement.** The goal correctly requires
   explicit offline upgrade and preserves the 1.2 contract
   (`GOAL.md:42`, `GOAL.md:106`). Its migration suite creates stores with
   the new implementation and removes tables/columns to emulate older
   formats (`5b565ac:conformance/messaging/upgrade.mjs:16`, line 22 and
   line 118). These are useful rollback and retained-receipt tests, but do
   not independently prove the consumer transition from published 0.2.0.

   Add a small fixture created by the identified previous package or
   pinned previous implementation, then run the candidate's installed CLI
   upgrade and reopen with the candidate archive. Retain the synthetic
   crash tests. Record preserved pending/claimed messages, receipts, dedupe
   and trace data, ordinary-open refusal, and the stop-all-clients
   prerequisite. A failed upgrade rolls back transactionally; downgrading
   after successful upgrade is different and must not be implied by
   “rollback.” No new migration semantics are needed.

## Green-gate checkability

1. **Integration and exclusions:** Checkable by the executor. Pin the actual
   execution base as well as the feature input, list retained dependencies
   and exclusions, and review the complete candidate diff. Include source,
   package contents, exports, CLI help, peers, lockfiles and root scripts.
   Finding 5 supplies a concrete starting point. Preserve main's evie-kit
   additions rather than copying the feature tree wholesale.

2. **Contract, docs and exports:** Checkable. Map section 20's DECIDED
   clauses to tests and exported entry points. Name `bun run check:docs`;
   that checker validates links and private-path leakage
   (`tools/check-docs.mjs:19`), so manual contract/API comparison remains
   necessary. Describe 0.3.0 as a candidate until publication. Resolve
   native-free wording as in finding 3.

3. **Separate-account deployment:** Checkable once finding 4's identity
   boundary and matrix are specified. Record OS identity evidence if
   required, Redis roles, computed keys/channels, sanitized ACL commands,
   assertions and cleanup. Distinguish administrator provisioning from
   application-user permissions. Real secrets must not appear in receipts.

4. **Conformance and regressions:** Checkable on the required hosts.
   Replace “applicable” with a pre-run inventory mapped to the five
   retained suite groups: core, Redis, messaging, administration and OTel,
   plus cross-host/restart and added deployment checks. Record exclusions
   with reasons. Node 22 on macOS must appear as its own runtime identity;
   pin the other three pairings and Redis versions too. Tie receipts to
   the candidate source, including finding 6's release-boundary upgrade.
   Missing host access invokes the stop clause, not a skipped green result.

5. **Typecheck and lint:** Not reliably checkable as specified. Resolve
   finding 1 before launch and retain the goal's stricter outcome rules
   even if the tool exits zero. Validate the final receipt and lock
   eligibility. A waiver requires an actual owner decision and remains
   disclosed; it is not an executor fallback or equivalent to green.

6. **Four archives:** Checkable after findings 2–3 are addressed. Produce
   one manifest mapping final source to four 0.3.0 archive hashes, exact
   Semaphile peers and native target identities. Every installed-test
   receipt should identify that set, including the Redis-only test.
   Filename or version alone is insufficient identity.

7. **Fresh review:** Checkable with available engines. Record the effective
   results-review roster, exact base/head and gate command at launch;
   include AGENTS.md's fresh Codex review. Historical feature reviews do
   not count. Explicitly enforce the two-round budget: installed tooling
   defaults to results soft/hard budgets of four/eight
   (`node_modules/@evie-kit/goals/src/settingsReviewPolicy.ts:102`).
   The repository rule already takes precedence, so this is configuration
   work, not a request for more rounds. Fix receipts must cover the
   candidate after accepted findings are resolved.

8. **Boundaries and handoff:** Checkable from the diff and action record.
   Keep forbidden publication/merge/features explicit. State who creates
   and verifies the accessible PR mentioned at `GOAL.md:58`, and whether
   its URL is required before executor completion or is a named
   orchestrator follow-up. Follow existing seat ownership without changing
   the release scope.

The stop clause suits scope expansion and unavailable platforms. Add
unresolved lint/review infrastructure to prerequisite handling. “Selected
gates” at `GOAL.md:137` should mean all eight listed gates, with only the
explicitly authorized waiver path as an alternative. A blocked handoff is
useful evidence, but is not a completed release candidate.

## Sizing sanity

No t-shirt size or Fibonacci estimate is declared. This is a medium-to-large
integration and verification task: 62 selected files, earlier shared fixes,
five retained suite groups, four OS/runtime pairings, cross-host recovery,
ACL fixtures, offline upgrade and portable artifacts need coherent evidence.

One goal remains plausible if hosts, package caches, review engines and lint
infrastructure are ready and the dependency audit stays narrow. Use internal
milestones for extraction/clean build, deployment and migration evidence, then
immutable artifacts and final review. If lint provisioning or a broader product
dependency becomes substantial, split that prerequisite before consuming the
review budget. There is no reason to split merely because the selected type is
Chore, or to restore proxy features to simplify integration.

## Open questions and grill suggestions

1. **Lint prerequisite ownership — finding 1.** The release requires
   configured fast lint roots and valid Sonar evidence, but the tracked
   checkout supplies neither those settings nor a Sonar properties file.
   Should providing this configuration be a bounded prerequisite within
   the release goal, or must the release wait for a separate tooling task?
   Recommend including it only if an existing supported setup can be
   supplied without tool development. The first option lets the executor
   configure and validate the gate before extraction; the second keeps
   the candidate blocked until that setup is delivered. Neither silently
   waives Sonar.

2. **Meaning of separate accounts — finding 4.** Should the exchange run
   under two operating-system users, each with its own restricted Redis
   login, or are two Redis logins under one OS user enough? Recommend
   the former: separate homes/configurations demonstrate deployment
   across accounts without shared SQLite files. The latter demonstrates
   Redis permissions but does not exercise the OS-account boundary.
   Neither implies authorization of individual message fields.

Ask these separately, defining OS users and Redis ACL users before the picker.
Do not re-ask Chore, messaging-only scope, 0.3.0, backend semantics, configurable
client certificates or publication ownership. The remaining corrections are
engineering and evidence work.

## Wayfinder signal

consider-wayfinder — The product boundary is clear, but size depends on
unverified lint infrastructure and the deployment account boundary. Resolve
those uncertainties and inventory the required hosts before sizing. A broader
discovery exercise is unnecessary if infrastructure is available and the known
shared-source correction stays small.

## Promote-readiness verdict

not_ready. The main blockers are an unproven lint-gate prerequisite and an
artifact gate that does not yet require the identical portable archive set the
maintainer will publish. Define the deployment account boundary and align
native-free wording with the runtime contract. The telemetry dependency and
migration fixture can be handled by the executor under a sharpened plan; they
do not justify importing proxies or redesigning messaging. No implementation,
live experiment or publication is required to resolve this critique.

CRITIQUE COMPLETE
