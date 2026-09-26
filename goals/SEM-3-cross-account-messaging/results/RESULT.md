# SEM-3 Result: Test Redis Messaging Across OS Accounts

In progress. This record is written as the work happens; the gate sections
are added once their evidence exists. No gate is claimed yet.

## What changed

### Fixture and harness (September 24)

- `8cf2b13` adds the cross-account harness under `conformance/accounts/`: a
  controller, a fixed JSON-lines participant each identity runs, the fixed
  100-case inventory per platform, and a consumer that installs the four
  unchanged SEM-2 0.3.0 candidate archives. Its lock matches the candidate
  commit's own locks entry for entry (18 of 18 third-party packages).
- `a198aae` adds the root-owned runner, the macOS administrator script and
  the in-container Linux scripts. Each records a resource as intended before
  creating it and as observed right after, refuses collisions before any
  change, and deletes nothing when a recorded identity differs.
- `cc22320`, `2156636`, `416e623` add and repair controller-side staging. An
  offline `npm ci` needs each tarball's request-cache index entry under
  `<cache>/_cacache`, not content copied by digest alone.
- `91144bb` documents the procedure; `7c61d50` makes macOS setup compare the
  installed tree against a root-owned copy of the reviewed listing, closing a
  window in which the controller-owned listing could be swapped.

A same-UID development run, which is not evidence, passed 100 of 100 cases.
The fixture checks that need distinct identities fail in that mode, as they
must.

### Linux leg moved to a disposable cloud VM (September 26)

The owner replaced the shared Linux host with a disposable Google Cloud VM,
provisioned with Terraform and configured with Ansible
(`references/repeatable-cloud-provisioning.md`).

- `d70fcaa` commits the planner's four amendments unchanged, as the
  orchestrator asked.
- `e4d4e39` fixes four defects found by tracing the Linux container path
  under its narrow capability set, none of which had run yet: `setpriv`
  cannot clear a child's bounding set without `CAP_SETPCAP`; container root
  has no `DAC_OVERRIDE`, so teardown now empties the identities' 0700
  directories as their owners; the pinned `redis:8.4.0` image has no procps,
  so `pkill`/`pgrep` were silently absent and the survivor check always
  passed (a `/proc` scan replaces them); and the world-writable guard matched
  the sticky tmpfs `/tmp`, so setup could never start. Teardown also removed
  its own script, so a repeat had nothing to run; the verified script now
  runs from a root-only copy outside the prefix.
- `1cff9ce` adds `conformance/accounts/cloud/`: Terraform for six run-owned
  resources, Ansible for idempotent host configuration and the reviewed
  `host.sh` sequence, and `run.sh` as the single entry point.

## Execution notes

- **Re-arm without a position record.** On September 26 the goal contract
  was re-issued (`goal-rearm-20260926-200653.md`) and reported that no
  position record could be found. The session was the same executor with its
  context intact. Its handoffs are kept under the primary checkout's private
  `.scratch/docs/handoffs/`, as AGENTS.md directs, rather than where the
  re-arm looked. No history was reconstructed.
- **Pause marker already gone.** When the orchestrator's answer arrived,
  `.evie-kit/handoffs/paused.json` had already been removed by another
  process. The answer asked the executor to delete it; there was nothing
  left to delete.
- **Orchestrator commit on the branch.** `2949ab1` (the orchestrator, under
  an audit-logged override) lowered the results review budget to soft 2,
  hard 2, per AGENTS.md. The executor follows it.
- **Superseded shared-host bootstrap.** The September 24 Linux section B was
  never run. No account, container or image was created on the shared host.
