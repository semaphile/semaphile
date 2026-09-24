---
agent: claude-code
model: claude-opus-5-5
reasoning_effort: high
round: 3
timestamp: 2026-09-24T01:45:00-05:00
verdict: ready_to_promote
findings: 3
---

## Summary

I checked the round-002 correction batch against the live GOAL.md, the
binding `references/verification-contract.md` and the candidate source
it will exercise. All nine of my round-2 items are closed, and the
batch introduces no contradiction with SPEC sections 16/20 or with the
owner's settled choices. The three blockers from last round are fixed.

1. **Default Redis user.** The contract now disables Redis's `default`
   user and uses a named ACL administrator. It requires a refusal check
   for every participant account, paired with a successful named
   connection. The refusal must be an authentication error, not a
   connectivity failure.
2. **CLI config discovery.** Each CLI case's cwd now sits beneath the
   account's private home, D1 bans the bypass flags, and each receipt
   must show which config file was loaded. That proof is feasible: the
   installed CLI's `info` returns `{ file, directory, stores }`
   (`packages/messaging/src/admin.ts:157`).
3. **Expiry observations.** Each one now follows a defined triggering
   operation.

I also withdraw part of my round-2 item 6. The brief's correction is
right: the candidate's `history` and `events` actions call `sweep`
before returning (`packages/redis/src/messaging-transport.ts:182-185`).
`send` and `publish` also sweep through admission first
(`packages/redis/src/messaging-admission.ts:14-15`). So T5's history
read, L1's claim-then-history sequence and L3's broadcast each apply
cleanup before the assertion, as the contract now states.

Three small precision notes remain. None blocks promotion, and each can
go into the executor's pre-provisioning package or a one-line contract
edit.

## Plan holes and risks

Verification of the round-2 items:

| Round-2 item | Status | Where |
| --- | --- | --- |
| 1 Default user and auth refusal | Closed | Fixture checks: per-UID unauthenticated and `AUTH default` denials, auth errors asserted, paired success. Service layout: default off before participants connect, named ACL admin. |
| 2 CONFIG GET exposure | Closed | R3 uses a separate synthetic credential. No `requirepass`/`masterauth`. Broad read-only visibility is acknowledged. |
| 3 CLI discovery | Closed | Home config-root cwd, no D1 selector flags, `info` file assertion, credential loaded after the identity switch and exported only to the CLI child. |
| 4 Dependency integrity | Closed | Integrity pinned to the candidate lockfiles, controller-staged verified offline cache, acquisition only in the reviewed bootstrap, runtime checksums. |
| 5 Case/store/grant map | Closed | Mapping enumerated before provisioning. Exact `messagingKey` root, descendants and channel. Checks apply to every input, including the ACL and readiness variants. |
| 6 Expiry triggers | Closed (and corrected as above) | T5 history before the retirement assertion, L1 claim then history, L3 broadcast then inspection. |
| 7 Reinstall cost | Closed | Narrow runner retained. Reinstalls budgeted and batched. The 8–13 estimate reflects this. |
| 8 Failure triage | Closed, stricter than proposed | Unknown causes stay blocked. A product defect needs a minimal reproducer against the candidate plus a SPEC citation. |
| 9 Scope cleanup wording | Closed | Scope item 5 points at the complete binding inventory. |

I found no new contradictions. The new "protocol input on participant
stdin is permitted" wording is consistent with the Mac requirement for
"closed authentication input". A non-interactive `sudo -n` never reads
a password from the IPC pipe. The "Redis state and all conformance
stores remain in the fixture checkout's `.tmp/`" sentence is also
consistent with home-based cwd. The Redis backend creates no local
stores, so only controller-side Redis state lives there.

Remaining precision notes (non-blocking):

1. **T5's "publish does not refresh" assertion needs an observation
   window to be meaningful.** Retirement is due at B's last activity
   plus the TTL. If A's in-window publish had wrongly refreshed
   activity, retirement would move to A's publish time plus the TTL. C's
   history read therefore has to land after B's deadline plus slack and
   strictly before A's publish time plus the TTL. If the check waits
   past both deadlines, a refreshing implementation also passes. The
   contract's "computed bound with scheduler slack" permits this design
   but does not force it. Choose a TTL and publish time that leave a
   window wider than the scheduler slack, and record both computed
   deadlines in the receipt.

2. **Redis's own files should be unreadable by participants, not just
   unwritable.** The contract keeps "authoritative manifest/control
   files outside participant-writable paths" and records service
   storage and log ownership. The files at issue are the Redis AOF,
   config, any aclfile, logs and the controller's admin credential. The
   AOF holds every case store's data, including keys outside a given
   participant's grant. A participant that can read it bypasses the
   exact-grant scoping behind A1–A3, even though no Redis command is
   involved. Add "controller-only readable" for those paths to the
   fixture checks: one denied read per UID. Configure `default` off in
   the startup config or aclfile, not by a runtime command after
   listening, so no unauthenticated window opens even before
   participants start.

3. **The contract does not say how library-driven cases consume the
   mapped config.** The CLI-discovery rule covers D1. T1–T8, L1–L3,
   A1–A6 and R1–R3 run through a participant driver, and the contract
   says each participant consumes its actual `semaphile.json` but not
   how. The installed package exports the public path:
   `messagingOptions({ cwd })` and `openConfiguredMessaging` from
   `@semaphile/messaging` (`packages/messaging/src/index.ts:6,13`).
   `openConfiguredMessaging` loads `@semaphile/redis/messaging` lazily,
   and SQLite and native code load only through a worker on the SQLite
   path (`packages/messaging/src/client.ts:1-2`). Using it keeps the
   Redis path native-free and makes library cases consume the same
   mapped files the fixture checks examine. Also record the resolved
   config file for those cases. A driver that parses the JSON itself
   would be weaker evidence for the "actual configuration" criterion.

## Green-gate checkability

- **Gate 1:** checkable. The self-report fields and the proof of
  non-interactive switching on both platforms are mechanical, and on
  Linux the minimal capabilities are documented.
- **Gate 2:** checkable across the full case → file mapping, including
  the auth-refusal pairs. Note 2 would add the Redis-file read denials.
- **Gate 3:** checkable. There are 200 enumerated cases with fixed
  roles, per-case stores and exact grants. The trigger rules make the
  lifetime assertions well defined. Note 1 keeps T5 from being
  vacuous, and note 3 makes the config-consumption evidence the same
  for CLI and library cases.
- **Gate 4:** checkable through per-class before/after manifests, the
  partial-recovery and repeated-teardown demonstrations, privilege
  revocation and the final audit. The scope wording now matches.
- **Gate 5:** checkable. The ShellCheck requirement is explicit, and a
  Sonar `not applicable` is expected with `packages/` untouched.
- **Gate 6:** checkable, with private absolute locations and
  repository-relative results.
- **Gate 7:** checkable against `references/sem2-debt.md`, with all six
  criteria required.
- **Stop clause and triage:** clear. Unexplained failures stay blocked,
  and confirmed defects go back to the owner.

## Sizing sanity

The L (8–13) range is now plausible. It explicitly budgets repeated
owner reinstalls on the Mac, and the launch budget remains the
orchestrator's call. No change needed.

## Open questions and grill suggestions

None. The three notes are engineering precision within the existing
owner decisions.

## Wayfinder signal

`none`. The goal is bounded and specified, with a fixed inventory,
fixed artifacts and a fixed order.

## Promote-readiness verdict

`ready_to_promote`. All round-2 blockers are closed without
contradicting SPEC, the candidate API or the owner's choices. The three
remaining notes can go into the executor's reviewed pre-provisioning
package or a one-line contract edit:
- the T5 observation window;
- controller-only readable Redis files and startup-time `default` off;
- public config-discovery helpers for library-driven cases.

As always, promotion remains the owner's decision.

CRITIQUE COMPLETE
