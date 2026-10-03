# Unit prompt: administrator scripts and identities

This is a scope addendum to the wave's standard blind-review prompt. Every rule
there still applies: blindness, the gate-evidence audit, the retrospective
challenge, never block, and the output format. This addendum only narrows
where you spend your attention.

## Frozen inputs

Review the frozen head named in the round brief, against `main` at
`d585cf9b8ff5ad521673d4ffd56af6705242aadb`. The coverage manifest is
`goals/SEM-3-cross-account-messaging/references/final-review/MANIFEST.md`.

## Your unit

Primary surfaces: `conformance/accounts/macos/admin.sh`,
`conformance/accounts/linux/container.sh` and
`conformance/accounts/bin/sem3-participant`. Read `stage.mjs` and
`lib/layout.mjs` for what these scripts are handed, and `lib/launch.mjs` and
`lib/checks.mjs` for how their identities are used and proven. You may read
anything else to test a boundary.

Contract: `GOAL.md` (gates 1, 2 and 4, and the provisioning checkpoints),
`references/verification-contract.md` (Participants and artifacts; Fixture
checks; Manifest, recovery and cleanup) and
`references/final-review-scopes.md`.

## Required focus

- **Trust from unprivileged staging to privileged installation.** The
  controller account is untrusted. Look for every place root reads, copies,
  hashes, writes or changes ownership or mode on a path that account controls,
  including symlinks, path substitution and races between a check and a use.
- **Collisions.** Setup must refuse any pre-existing fixture account, group,
  ID, path or process before changing anything, and the rehearsal must prove
  that.
- **Groups.** Account and group creation and removal on both platforms,
  including nested supplementary groups, and the identity check's view of
  them.
- **Ownership and permissions** of every created path, and whether anything
  becomes readable or writable to the wrong identity, even briefly.
- **Identity switching.** The sudoers rule, the runner's argument and
  identity checks, and the container's capability set must allow only the
  three fixture identities running the fixed participant.
- **Removal.** Teardown must remove only manifest-owned resources, refuse on
  any identity drift, survive partial setups and be a no-op when repeated.
  Check the order in which it stops processes, revokes grants and deletes.

Name the boundary in each finding when it crosses into the Cloud or Harness
unit; the integration pass reconciles those.
