# Unit prompt: harness, candidates and evidence

This is a scope addendum to the wave's standard blind-review prompt. Every rule
there still applies: blindness, the gate-evidence audit, the retrospective
challenge, never block, and the output format. This addendum only narrows
where you spend your attention. Do not start Redis, Docker or any service;
read the code and the candidate archives instead.

## Frozen inputs

Review the frozen head named in the round brief, against `main` at
`d585cf9b8ff5ad521673d4ffd56af6705242aadb`. The coverage manifest is
`goals/SEM-3-cross-account-messaging/references/final-review/MANIFEST.md`.

## Your unit

Primary surfaces: `conformance/accounts/controller.mjs`, `participant.mjs`,
everything under `lib/`, `stage.mjs`, `candidate-pins.json`, `package.json`,
`package-lock.json`, `README.md`, and the learnings under
`.evie-kit/learnings/`. Read the admin scripts for what the harness relies on
being installed, and the candidate source at
`800c8c53b8548250da6bf4a684bf796f1e9e1a73` for the behavior each case
asserts. You may read anything else to test a boundary.

Contract: `GOAL.md` (gates 1, 2, 3 and 7, and the package build),
`references/verification-contract.md` (the whole file),
`references/sem2-debt.md`, `references/sem2-baseline.md` and
`references/final-review-scopes.md`.

## Required focus

- **Candidate and runtime identity.** Only the four unchanged candidate
  archives and the pinned runtimes may be what participants load, with every
  third-party package pinned to the candidate commit's own locks.
- **Real identities and configuration.** Each participant must run as its own
  OS identity and load its own `semaphile.json` and credential file, and the
  receipts must prove both.
- **The fixed inventory.** Exactly the contract's 100 cases per platform, each
  asserting what its row requires. Look for any path by which a case passes
  without exercising its claim, or a skipped, filtered or invalid case could
  count as passed.
- **Deadlines and errors.** Computed deadlines rather than polling, timing
  windows that mark a run invalid rather than passing it, and errors that
  propagate rather than being swallowed.
- **Cleanup after failure.** The fixture Redis, its ACL users, the
  administrator credential and every identity's credential files after a
  thrown error, a signal at any point, or a participant that fails to launch.
- **Evidence.** What the receipts and README report must match the commands
  and the platform actually exercised, with secrets redacted.

Name the boundary in each finding when it crosses into the Admin or Cloud
unit; the integration pass reconciles those.
