<!-- Verbatim source: goals/SEM-2-redis-messaging-release/references/deferred-os-account-validation.md at d585cf9b8ff5ad521673d4ffd56af6705242aadb. -->

# Deferred OS-Account Validation for Redis Messaging

Status: deferred technical debt, owner-directed on 2026-09-23
Source goal: Add Redis Messaging to the Release Line

## Decision

After goal-review 002 raised native macOS provisioning, the owner said:
"let's just focus on one account for now and log the tech debt to resolve later"

This release goal uses one unprivileged OS account per host. Distinct Redis
credentials, ACL denial tests, independent client configurations, macOS/Linux
and Node/Bun coverage remain required. The earlier two-OS-account gate is
superseded. This is a verification deferral, not a new product guarantee or
permission to remove existing messaging behavior.

## Missing evidence and its consequence

We will not have demonstrated exchange between separate OS identities,
private-home/configuration isolation, or the account-provisioning recipe.
Separate Redis credentials under one OS login do not establish these facts.
Release receipts and documentation must describe this boundary honestly.
No skipped test should be presented as a pass; reference this deferral when
account-isolation coverage is omitted.

## Follow-up acceptance criteria

- Arrange two unprivileged OS identities on native macOS arm64 and Linux
  x64, with separate private homes and independent configurations. A Linux
  container may supply both Linux users; it does not replace native macOS.
- Establish a supported way to run as each identity and provide readable
  runtimes and the same identified package archives without exposing either
  user's private configuration. Decide provisioning ownership at that time.
- Run send, receive and acknowledge between the users with distinct
  restricted Redis credentials, without a shared local SQLite store.
- Confirm neither test user can read the other's private configuration,
  and confirm the permitted/denied Redis key and channel operations.
- Cover Node and Bun on both platforms, record actual OS/process identities
  and architecture, and retain raw commands/results with secrets omitted.
- Preserve required topic/lifetime and warn/strict readiness behavior;
  do not turn cooperative-store ACLs into a claim of per-message isolation.

## Tracking

This reference is the durable debt record inside the unpromoted release
goal. No separate tracker issue, execution date or implementation was
created. Carry the deferral into the release goal's eventual issue and
result; a later owner-directed goal can resolve it with the evidence above.
