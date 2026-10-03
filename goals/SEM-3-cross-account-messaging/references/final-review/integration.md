# Integration prompt: the complete lifecycle

This is a scope addendum to the wave's standard blind-review prompt. Every rule
there still applies, including never block and the output format. Prefer a
critic that did not author any of the change's fixes. Never run provisioning,
`sudo`, Docker or any service.

## Frozen inputs

Review the frozen head named in the round brief, against `main` at
`d585cf9b8ff5ad521673d4ffd56af6705242aadb`, after the unit lanes have
finished. The coverage manifest is
`goals/SEM-3-cross-account-messaging/references/final-review/MANIFEST.md`.
Work on the frozen source yourself before reading any unit lane's findings.
The orchestrator decides whether, and when, you see them.

## Scope

The whole change, followed end to end on both platforms. Use the manifest's
boundary table as your checklist:

1. **Staging** on the controller host: what is exported, copied, hashed and
   listed, and from which commit.
2. **Installation**: what root verifies and installs (the macOS admin script;
   the container script via `host.sh` and Ansible on Linux), and what remains
   trusted afterwards.
3. **Identity switching**: from the controller to each fixture identity, and
   what proves the switch.
4. **Participant launch** and the line protocol.
5. **Redis operations**: the fixture service, its administrator, the per-run
   ACL users and the grants each case needs.
6. **Interruption recovery**: a crash, a signal or a failed launch at each
   stage, and what is left behind.
7. **Evidence export**: receipts out of the container, the VM and the
   controller before anything is destroyed.
8. **Teardown**: container, image, VM and network on Linux, and accounts,
   groups, the sudoers grant and the prefix on macOS, then the read-only
   audits.

For each stage, check that the units agree where they meet: names, paths,
identities, exit codes, the order of steps, and what one side assumes the
other has already done. A defect that lives in the seam between two units is
exactly what this pass exists to find.

## Consistency audit

After the lifecycle review, compare `GOAL.md`, the references, the README,
`results/GATES.md` and the retrospective's two tables against the code. Read
`results/RESULT.md` last, after recording your own findings, and only to
check that its claims match the code and the receipts. It summarizes earlier
rounds, so it must not shape what you report about the code.
