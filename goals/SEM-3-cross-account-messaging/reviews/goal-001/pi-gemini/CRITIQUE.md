---
agent: pi-gemini
model: google/gemini-3.1-pro-preview
reasoning_effort: high
round: 1
timestamp: 2026-09-24T00:24:54-05:00
verdict: not_ready
findings: 7
---

## Summary

The goal aims to resolve deferred debt from SEM-2 by establishing a reproducible multi-account testing fixture on macOS arm64 (native) and Linux x64 (containerized). The scope entails provisioning three dedicated, unprivileged accounts per platform, enforcing private configurations and shared fixture spaces, and executing a comprehensive matrix (48 permutations) of cross-account Redis messaging tests across Node and Bun. Finally, it requires an owner-assisted teardown of these dedicated resources, leaving only sanitized evidence behind. The goal is meticulously scoped but carries high execution risk due to the necessity of unattended cross-identity execution across platform-specific privilege boundaries.

## Plan holes and risks

1. **macOS unattended identity switching (Gate 1)**: The plan demands native macOS unattended identity switching, but explicitly rejects improvising from a sudoers wildcard ("not improvised from the preflight's example sudoers wildcard"). Standard `su` or `sudo -u` on macOS will prompt for a password. If the executor cannot configure a passwordless transition (e.g., specific explicit sudoers rules for a test harness executable, or pre-shared SSH keys) without a broad privilege grant, the 48-matrix automated run will stall at password prompts.
2. **Container UID mapping (Gate 4 / Scope 1)**: For the Linux x64 environment, the plan creates three users inside a container. By default, container UIDs map 1:1 to host UIDs unless Docker User Namespaces are enabled. If the container mounts any host directories (e.g., the repository `.tmp` for shared fixture data as required), the container's unprivileged test UIDs might inadvertently overlap with existing host UIDs or fail to satisfy strict host-level permission checks.
3. **Artifact permissions and shared storage (Scope 3 & 4)**: The matrix requires distinct users to read the test harness (`conformance/redis/messaging-acl.mjs`) and write receipts/logs to a shared location. Without a defined UNIX group or sticky-bit directory strategy, the strict private-home isolation could accidentally block the test harness from writing its own receipts or accessing the runtime binaries.
4. **Interactive bottlenecking**: The executor is required to pause for owner-reviewed administrator setups for both provisioning and teardown. If the 48-matrix tests fail mid-flight, debugging might require re-provisioning or manual state resets, leading to severe context exhaustion across multiple interactive pauses.

## Green-gate checkability

1. **Gate 1**: Can be checked by capturing the output of `id` and `uname -m` from inside the harness during unattended execution. Unattendedness is implicitly checked by the test running without blocking on `stdin`.
2. **Gate 2**: Fully checkable via programmatic positive and negative filesystem read assertions.
3. **Gate 3**: Fully checkable. The test suite's summary output and generated receipts will demonstrate the matrix coverage, provided the executor correctly formats the required fields (UID, architecture, Node/Bun).
4. **Gate 4**: Vague and difficult to check purely automatically. The phrase "without changing unrelated accounts or workloads" requires human review of the setup/teardown scripts to ensure commands are safely scoped (e.g., exact match deletions rather than wildcard `rm` or `docker prune`).
5. **Gate 5**: Fully checkable via `evie-kit lint gate`.
6. **Gate 6**: Checkable by verifying the existence and contents of the blind review artifact files in `.scratch/docs/`.
7. **Gate 7**: Checkable by auditing the final mapping document against the SEM-2 deferred criteria.

## Sizing sanity

The assigned "chore" designation is misleadingly small for the operational complexity involved. Establishing native cross-user orchestration, resolving restrictive macOS privilege constraints, configuring resource-limited Docker containers, and executing a 48-step cross-runtime matrix with teardown spans significant infrastructure and testing domains. It is borderline oversized for a single execution session, highly dependent on the speed and success of the owner's manual interventions.

## Open questions and grill suggestions

1. **Unattended execution mechanism**: For macOS, what precise mechanism (e.g., explicit per-command `sudoers` entries, SSH keys) is acceptable for the test harness to switch between the three unprivileged identities without pausing for passwords or requiring a broad root delegation?
2. **Host-to-container filesystem boundary**: On Linux, how should the containerized test users securely access the shared repository workspace (e.g., `.tmp` for test logs and receipts) without colliding with host UIDs or triggering host-level permission denials?
3. **Artifact sharing model**: What specific UNIX permission model (e.g., a dedicated shared group, world-writable sticky directory) should govern the explicitly shared fixture access for test logs and cross-account validation receipts?

## Wayfinder signal

`consider-wayfinder`. The combination of interactive administrator pauses for macOS setup/teardown and the brittle nature of OS-level permission debugging across two disparate platforms (native macOS vs. containerized Linux) creates a high risk of execution stall or context window exhaustion in a single session.

## Promote-readiness verdict

`not_ready`. The goal relies on unattended identity switching for a massive test matrix but lacks clarity on how to achieve this cleanly on macOS without violating the prohibition on broad privilege grants. The exact operational strategy for test isolation vs. shared receipt writing must be sharpened before promotion to prevent the executor from floundering in permission-denied loops.

CRITIQUE COMPLETE