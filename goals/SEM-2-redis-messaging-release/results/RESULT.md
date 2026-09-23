# SEM-2 execution result (verification pending)

The messaging-only 0.3.0 candidate has passed the source, deployment,
portable-archive and configured quality checks recorded in GATES.md.
The first blind review produced bounded fixes. Their verification review
is pending, so this goal is not locked.

## Candidate identity

Package source is `59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9`.
ARTIFACTS.json records all four 0.3.0 archives, exact peer versions,
hashes, durable paths and both native targets. The archives are retained at
`/Users/openclaw/src/divideby0/semaphile/releases/candidates/redis-messaging/0.3.0/59127e4cd50bb6c19a6ec0f1e2e03790ea4cebf9/`.
The subsequent 25e3158 fault-fixture cleanup changes no package bytes.
Historical checkpoint/0.3.0 and checkpoint/0.4.0 refs and archives retain
their original proxy identities; the earlier ce00f9b candidate also remains intact.

The source matrix reports 2508 passing scenarios across macOS arm64 and
Linux x64 with Node 22 and Bun, plus six cross-host/restart cases.
All four exact-archive pairings pass five installed groups each, including
real 0.2.0 store upgrade, strict consumer types and native-free Redis CLI/library
operation. GATES.md explains the unchanged-source ancestry of retained receipts.

## Findings and verification

The review fixes preserve the decided section 20 contract: waits survive
pre-dispatch timeouts, independent confirmed claims keep their deadlines,
retired SQLite subscriptions cannot be revived by retry, bounded terminal
error text fits its reservation, and event retention avoids scanning an
unchanged history. Cleanup uncertainty, corrupt metadata, permission errors
and stale socket failures now retain their intended distinctions.
Contributor lint and retained documentation were corrected as well.
The excluded policy export is core/http-policy, not an OTel export.

Two Linux Node runs failed the new outage fixture before per-case client
cleanup removed interference from earlier reconnecting clients. Those failed
receipts remain preserved. A Sonar scan at d9a7dec was invalidated by source
movement during the scan; it is diagnostic evidence, not a passing gate.
The final lint receipt at 25e3158 has configured and passing fast roots and
valid passed Sonar evidence. It reports zero in-diff issues, 71 preexisting
issues and an ERROR project dashboard. No waiver or coverage result is claimed.

## Remaining owner and orchestrator actions

- Land the reviewed branch using the repository's real-merge convention.
  Compare landed source with this candidate, follow docs/releases.md to
  assemble the actual release identity, and rerun affected source and exact
  archive checks if source or bytes change. These archives remain identified
  by their candidate source; they are not relabeled as a later merge commit.
- Consider excluded observer-fencing fixes `1b56123` and `c9ac5cc` before
  publication. The retained limiter/OTel line lacks those fixes and can
  retain stale collector identifiers. Porting them is outside this goal.
- Keep the [separate OS-account validation debt](../references/deferred-os-account-validation.md)
  open. Tests used one unprivileged OS account per host with independent
  configurations and distinct restricted Redis credentials. Separate homes,
  separate OS-user operation and private-file isolation remain unverified.
  The debt is linked from [issue 2](https://github.com/semaphile/semaphile/issues/2).
- The owner controls publication. Redis limiter consumers must explicitly
  install matching core because that peer is now optional for messaging-only use.
  Follow the documented 0.2.0 offline upgrade and separate private 0.4.0 pilot
  replacement steps; successful upgrade does not promise downgrade.

## Execution record

No npm publication, protected-branch merge, HTTP/MCP proxy feature,
Sentinel implementation, harness adapter or range registry was performed
or added. Refused supervisor probes were not retried. Startup liveness
returned NONE before execution; this continuing executor acknowledged arm
generation 6 after compaction. Authorship and final lint eligibility will
be recorded before lock.

The compaction handoff described earlier source and receipts. Current
GATES.md supersedes that position without removing any contract gate.
The required retrospective records process learnings and reviewer feedback;
its check must pass before lock. Durable raw receipts and reviews live under
`/Users/openclaw/src/divideby0/semaphile/.scratch/docs/`.
