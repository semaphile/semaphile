# SEM-2 execution result

The messaging-only 0.3.0 candidate is verified for the orchestrator and owner.
All eight goal gates pass: 2520 source scenarios, six cross-host/restart cases,
20 installed-archive groups, the configured quality formula and reconciled
blind review. GATES.md records commands, tested commits and evidence.

## Candidate identity

Package, fixture and archive source is
`800c8c53b8548250da6bf4a684bf796f1e9e1a73`.
ARTIFACTS.json records all four 0.3.0 archives, exact peer versions,
SHA-256 hashes and both verified native targets. Their durable directory is
`/Users/openclaw/src/divideby0/semaphile/releases/candidates/redis-messaging/0.3.0/800c8c53b8548250da6bf4a684bf796f1e9e1a73/`.
The same four archives passed on macOS arm64 and Linux x64 with Node 22 and
Bun, retaining their hashes across every run. Core's extracted files and
native identities are unchanged from its earlier verified source; its newly
packed archive has a new byte identity and was tested as part of this set.

The installed checks cover the real archived 0.2.0 store upgrade, strict
consumer types, CLI routes and Redis operation after removing native/SQLite
components from installed copies. Earlier ce00f9b and 59127e4 candidates remain
intact. Historical checkpoint/0.3.0 and checkpoint/0.4.0 refs and archives retain
their original proxy identities.

## Review and recovery behavior

The first blind wave produced 20 consolidated findings. The verification
wave produced 10 minor/nit items with no blocker or major defect; all have
recorded dispositions. Both fresh Codex reviews are retained. The second found
no actionable issue and checked receipt ancestry and archive hashes.
Accepted closing corrections received focused regressions, the final source
matrix and new exact-archive checks. See reviews/results-005/INDEX.md.

The fixes preserve section 20: pre-dispatch wait timeouts recover, independent
confirmed claims retain their deadlines, retired SQLite subscriptions cannot
be revived by retry, bounded error text fits its reservation, and unchanged
event history avoids a full scan. Permission refusals report ACCESS without
reconnecting healthy sockets. Old local subscription snapshots preserve a
transport error instead of inventing retirement. Caller timer expiry returns
null even when the wall-clock comparison has not reached the deadline.

A lost dispatched listener claim remains explicit through done/onError and
requires an explicit listener restart; the lost claim stays fenced until expiry.
Public guidance and a regression cover this boundary. Generic local cancellation
retains the existing API; authoritative server generation checks report STALE.
The excluded policy export is core/http-policy, not an OTel export.

## Quality and failed attempts

The final receipt at 800c8c5 has configured, passing fast roots and valid
passed Sonar evidence: zero in-diff issues, 71 preexisting issues and an ERROR
project dashboard. Both review scans also passed their in-diff checks. No
waiver or coverage result is claimed. Authorship is verified with no uncovered
commits, and lint eligibility passes before lock. The retrospective passes
and routes four convention candidates, two toolkit candidates and one one-off.

Failed runs remain preserved. Earlier Linux Node outage cases exposed clients
leaking between tests; per-case cleanup resolved that interference. A later
Linux run exposed early timer expiry, fixed with the frozen-clock regression.
The 2910e5a Sonar naming finding was fixed; a d9a7dec scan invalidated by source
movement remains diagnostic. A build missing CARGO_HOME did not rebuild the
candidate; its old-build run reproduced the subscription bug. Final receipts
supersede these attempts without counting them green.

## Owner and orchestrator handoff

- Land the reviewed branch using the repository's real-merge convention.
  Compare landed source with this candidate, follow docs/releases.md to
  assemble the actual release identity, and rerun affected source and exact
  archive checks when source or bytes change. Candidate archives keep their
  recorded source identity; they are not relabeled as a later merge commit.
- Consider excluded observer-fencing fixes 1b56123 and c9ac5cc before
  publication. The retained limiter/OTel line lacks those fixes and can
  retain stale collector identifiers. Porting them is outside this goal.
- Keep the [separate OS-account validation debt](../references/deferred-os-account-validation.md)
  open. Tests used one unprivileged OS account per host, independent configs
  and distinct restricted Redis credentials. Separate OS-user operation,
  separate homes and private-file isolation remain unverified. The debt is
  linked from [issue 2](https://github.com/semaphile/semaphile/issues/2).
- Confirm the optional-core peer behavior during publication review: Redis
  limiter consumers explicitly install matching core. The selected feature
  peer contract is retained and disclosed in CHANGELOG.md. The owner controls
  publication. Follow the documented 0.2.0 offline upgrade and separate 0.4.0
  private-pilot replacement; successful upgrade does not promise downgrade.

## Execution record

No npm publication, protected-branch merge, HTTP/MCP proxy feature, Sentinel
implementation, harness adapter or range registry was added or performed.
Refused supervisor probes were not retried. Startup liveness returned NONE;
arm generation 6 was acknowledged after compaction. The executor completes
only its own goal-branch commit and push at lock.

Positional handoffs described earlier source and receipts. Final GATES.md
supersedes those snapshots without removing any contract gate. Raw receipts,
review reports and the final handoff live under
`/Users/openclaw/src/divideby0/semaphile/.scratch/docs/`.
