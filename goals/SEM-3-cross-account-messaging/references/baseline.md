# Preflight and scope provenance

The planning request came from the recorded Semaphile orchestrator after the
owner asked to start the account-fixture prerequisite. Its exact subject is
captured in intake.md. The owner then chose **Fixture plus messaging** over
**Fixture only (Recommended)** or **Go deeper** on 2026-09-24. Both options
were described as a Chore. The classifier's lexical default was feat; the
confirmed maintenance/verification deliverable is recorded as chore.

The private receipt is
`.scratch/docs/receipts/account-fixture-preflight-20260923.md` in the primary
checkout. Neither required platform was fixture-ready. Native macOS needs
administrator-assisted dedicated account provisioning and accessible runtimes.
A candidate Linux x64 workstation is being rebuilt and lacks the runtimes;
another candidate has Docker and administrative capability but shares its
resources with unrelated users and workloads. No host setup is approved by
this summary. Existing personal accounts are not fixture identities.

The orchestrator ran an isolated, disposable Linux ARM64 container with three
users: own-file reads passed 3/3; cross-account private-file reads were denied
6/6; intended group sharing worked and an outsider was denied. These are
preliminary mechanics, not macOS/Linux x64 or Redis messaging evidence.

SEM-2's accepted historical scope was one OS account per host with distinct
Redis credentials. Its debt requires at least two real unprivileged identities
on macOS arm64 and Linux x64, separate private configurations, Redis exchange,
ACL denials and Node/Bun coverage. The proposed range-registry consumer has a
separate three-account requirement. Neither count may be silently substituted
for the other, and fixture readiness does not prove registry behavior.

No registry code, account changes, host package installation, tracker promotion
or executor launch was performed by this planner intake.
