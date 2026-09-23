# Messaging candidate extraction

Main baseline: `3ec254e25a56daab0e2546f75cd38804df40f44c`.
Feature input: `5b565ac9bef4ff569ac0e21726947fec279323e6`.
Messaging boundary: `baa06dca5a3e764d683a79a88ff99b28bbc41303`.
The 62-file increment after that boundary is applied as a patch onto the
candidate. The full feature ancestry is not merged.

## Shared-ancestor dispositions

The required range is `67ed8cc..baa06dc`. Each row describes the candidate,
including changes embedded in commits whose main purpose was a proxy.

| Commit  | Disposition | Reason                                                                                                                                                            |
| ------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3feb141 | Exclude     | HTTP proxy contract is outside this candidate.                                                                                                                    |
| e3b4470 | Exclude     | Tracked execution cleanup is a proxy-facing API; messaging does not call it.                                                                                      |
| 96a7295 | Exclude     | Proxy implementation, optional peers, CLI routing, http-policy export, and proxy documentation do not belong in this release. Versions are prepared separately.   |
| ca43c96 | Rewrite     | Retain only messaging's invalid-baggage trace-dropped diagnostic and its test. Exporter, collector, observer, and discovery changes are independent of messaging. |
| 89f0bbe | Exclude     | Proxy teardown and its CLI routing are not used by messaging.                                                                                                     |
| 44eaaf7 | Exclude     | Streaming proxy cancellation and its runner entries are excluded.                                                                                                 |
| 1b56123 | Exclude     | Export worker isolation and observer fencing are independent telemetry work. Retain main's existing implementations and regressions.                              |
| 780406a | Exclude     | Depends on the excluded export worker.                                                                                                                            |
| c9ac5cc | Exclude     | Observer ownership fix depends on the excluded collector changes.                                                                                                 |
| 72292c5 | Exclude     | Proxy regressions are excluded; the unrelated cluster fixture adjustment is not required by messaging.                                                            |
| 13e9acc | Exclude     | MCP proxy contract is deferred.                                                                                                                                   |
| bce5ece | Exclude     | MCP implementation, CLI dispatch, help, peers, exports, and runner entries are deferred.                                                                          |
| 6af024f | Exclude     | MCP session failure behavior is deferred.                                                                                                                         |
| 9ee3e7e | Exclude     | MCP EOF fixture is deferred.                                                                                                                                      |
| 4f038e5 | Exclude     | MCP metadata/EOF behavior is deferred.                                                                                                                            |
| c7a8795 | Exclude     | Proxy release notes and fifth-package instructions do not describe this candidate.                                                                                |
| baa06dc | Rewrite     | Apply only the later messaging documentation increment against main's documentation; preserve main's licenses and omit proxy prose.                               |

## Reconciliation

- SPEC section 20 is copied intact from the pinned feature. Earlier section 16
  deferral wording now cross-references it. Sections 18/19 are absent because
  their proxy contracts are excluded; section 20 keeps its historical number.
- Main's CLI is the base for the messaging delta. No proxy command branch is
  copied. Main's core and OTel exports are retained without http-policy.
- All four package versions and Semaphile peer constraints are 0.3.0.
  Redis adds the native-free messaging export and optional messaging peer.
- Lockfiles update local package metadata and links only. Third-party version,
  resolved URL, and integrity identities must remain unchanged; the verification
  record is added after validation.
- Build order becomes core, messaging, Redis, OTel because Redis declarations
  depend on the new shared messaging entry point.
- `proxy` identifiers in Redis fault tests describe harness-owned TCP fault
  injection. They are not the excluded HTTP/MCP product or package.

## Lint configuration

The supported command adapter runs the existing package oxlint binary over
packages/, conformance/, and tools/. The legacy npm lint checks remain and invoke
this fast tier at the end. Sonar host/authentication remain machine-local.
The local review settings currently override Sonar sources to packages; effective
scope must be recorded with the final gate receipt.

The broader conformance root includes old compiler fixtures that the previous
lint script did not inspect. The consumer fixture intentionally contains unused
type assertions, an inaccessible import, a bare forbidden property access, and
a thenable. Its four matching lint rules are disabled only for that fixture.
Two historical low-level RPC fixtures retain their dynamic any boundary; the
no-explicit-any exception names only those two paths. Curly-brace fixes preserve
behavior. These are explicit fixture configuration choices, not a Sonar waiver.

Formatting excludes synced skills, preserved goal/review records, and local runtime
state. These include verbatim intake and review artifacts owned by their lifecycle;
formatting them would rewrite evidence. Source and public documentation remain
covered by the existing root format check.

## Evidence status

Extraction checks and the source/archive matrices pass; see GATES.md. Blind review remains in progress, so this record is not completion.

## Static extraction checks
- core: third-party lock identities unchanged; exports equal pinned feature minus http-policy.
- redis: third-party lock identities unchanged; exports equal pinned feature minus http-policy.
- messaging: third-party lock identities unchanged; exports equal pinned feature minus http-policy.
- otel: third-party lock identities unchanged; exports equal pinned feature minus http-policy.
- SPEC section 20 matches the pinned feature byte for byte.
