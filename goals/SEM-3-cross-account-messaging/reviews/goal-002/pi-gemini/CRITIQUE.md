---
agent: pi-gemini
model: google/gemini-3.1-pro-preview
reasoning_effort: high
round: 2
timestamp: 2026-09-24T01:29:59-05:00
verdict: ready_to_promote
findings: 3
---

## Summary

The revised verification contract elegantly resolves the structural ambiguities raised in round 1. It replaces the problematic shared writable directories with a robust design where the controller captures stdout/stderr over pipes, isolating participants to private working directories. It mitigates Linux host-UID mapping risks by replacing bind mounts with artifact copy-in and receipt export, and explicitly mandates a root-owned immutable runner on macOS to solve the unattended switching requirement safely. The expansion to a strict 200-case matrix with detailed architectural constraints pushes this into a heavy execution lift, but the plan is now mathematically cohesive and structurally sound for promotion.

## Plan holes and risks

1. **Cross-Identity IPC Synchronization**: The contract firmly bans polling loops and mandates "event/IPC barriers and computed deadlines." However, because participants A, B, and C are isolated to private subdirectories and cannot write to a shared location, traditional filesystem-based POSIX IPC (like named pipes or UNIX sockets) across distinct UIDs will fail permission checks. Synchronizing test phases (e.g., A must not publish until B has successfully subscribed) must therefore be proxied completely through the controller via stdin/stdout streams, or risk contaminating the test state if Redis itself is used as the barrier. This creates high multi-process orchestration complexity for the executor.
2. **Linux Container Identity Capabilities**: The contract dictates dropping unnecessary capabilities and states "The container controller may switch identities inside that container only." The executor must ensure the controller inside the container retains `CAP_SETUID` and `CAP_SETGID` to legally transition to the unprivileged A, B, and C identities without a password, and the exact mechanism (e.g., `su`, `sudo`, or a custom binary) must be validated to not require a TTY, matching the strictness applied to the macOS native runner.

## Green-gate checkability

1. **Gate 1**: Fully checkable via the exported process identity receipts.
2. **Gate 2**: Highly checkable. The update explicitly requires `EACCES`/`EPERM` rather than just `ENOENT` (missing file), completely eliminating the false-positive risk from incorrect pathing.
3. **Gate 3**: Fully checkable via the 200-case matrix logs.
4. **Gate 4**: Checkable. The addition of a strict manifest, partial-setup recovery, and harmless repeated teardown provides clear programmatic criteria for assessing the cleanup scripts.
5. **Gate 5**: Checkable via `evie-kit lint gate`.
6. **Gate 6**: Checkable via the `.scratch/docs/` artifact audit.
7. **Gate 7**: Checkable by mapping the final output to `references/sem2-debt.md`.

## Sizing sanity

The estimate of L (8) is accurate and well-justified. The sheer volume of the matrix (200 cases) isn't the primary driver; rather, establishing the strict root-owned macOS runner, the heavily constrained Linux Docker environment, and a custom multi-process harness capable of coordinating cross-identity execution strictly over standard streams will consume the bulk of the engineering budget.

## Open questions and grill suggestions

1. **Test Synchronization Proxy**: Given the strict prohibition on shared writable paths and polling loops, should the executor design the test harness such that the master controller proxies all event/IPC barriers via standard streams between participants, or is there an approved UNIX permission model for a shared IPC socket directory?

## Wayfinder signal

`none`. The engineering requirements and architectural boundaries are exceptionally clear. The remaining complexities are implementation details appropriate for the executor to resolve during delivery.

## Promote-readiness verdict

`ready_to_promote`. The goal-001 corrections systematically addressed the execution risks regarding permission boundaries, unattended identity switching, and artifact sharing. The resulting plan is rigid, auditable, and ready for executor launch.

CRITIQUE COMPLETE