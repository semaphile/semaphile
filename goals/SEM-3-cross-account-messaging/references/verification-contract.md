# Cross-account verification contract

This is the engineering refinement of goal-review 001, under the owner's
choices of three accounts, both platforms, exact SEM-2 archives, one goal with
checkpoints, and removal after validation. It adds no messaging semantics.
SPEC sections 16 and 20 remain authoritative. Test grouped cases below with
explicit assertions; do not inflate assertion counts into extra cases.

## Participants and artifacts

A, B and C are three distinct, dedicated unprivileged OS identities on each
platform, with separate private homes, actual semaphile.json files and 0600
credential inputs. Those files are the ones each participant consumes. The
controller owns administrative credentials; none are passed to participants.
Use a clean allowlist environment, explicit HOME, private working directory and
absolute read-only runtime path. Load the participant's credential only within
its identity, never through command-line arguments or inherited admin variables.
Do not log credentials or configuration contents. For CLI cases, each case cwd
is beneath that account's private home and contains the selected semaphile.json
(or is its descendant). Never use --store, --redis-url-env, --namespace or
--messaging-store selector flags to bypass discovery in D1. Capture the installed
CLI info command's resolved project/config file and assert the expected path.
The participant wrapper reads its 0600 credential file after switching identity
and exports the referenced variable only to its CLI child. No credential travels
through the privileged runner's argv. Library-driven cases use the installed
public messagingOptions/openConfiguredMessaging configuration path where they
open a messaging client, and record the resolved mapped config path as well.
Low-level ACL probes obtain their endpoint/credential from that same mapped
input; they do not substitute shared controller configuration.

Install all four unchanged candidate archives from `sem2-baseline.md` into a
fixture-owned read-only consumer prefix. Record archive hashes before transfer,
after transfer and before installation, installed dependency identities and the
resolved package entrypoints each participant loads. Compare installed Semaphile
files to the archive contents. No workspace symlinks, checkout dist imports or
registry substitutions count. Node and Bun run the same installed candidate.
Native macOS arm64 and glibc Linux x64 match the archived native targets, though
the Redis messaging path itself must remain native-free and create no SQLite
store. Pin third-party version/resolved/integrity identities to the candidate commit's
packages/redis/package-lock.json, packages/messaging/package-lock.json and
packages/otel/package-lock.json at candidate commit
800c8c53b8548250da6bf4a684bf796f1e9e1a73. Require the staged manifest and consumer
lock to cover every installed production and required-peer dependency with its
pinned version, resolved location and integrity. Missing coverage or conflicting
identities blocks bootstrap; no fresh unpinned resolution is permitted.
The controller stages a checksum-verified offline dependency cache from those
locks; only the reviewed bootstrap acquires missing registry artifacts, never
participant test execution. No dependency upgrade or integrity mismatch passes.
Pin/checksum runtime downloads as well. Record the actual consumer lockfile and
install procedure. Unexpected acquisition requirements return to the bootstrap
checkpoint, not an ad hoc grant of network access.

Each participant self-reports PID, real/effective UID and GID, supplementary
groups, HOME, cwd, OS/architecture, executable realpath, runtime version and
resolved package locations. Assert these against the fixture manifest before
counting its test. Distinct Redis usernames are recorded without passwords;
controller snapshots of fixture-only client/ACL state corroborate their use.

## Required messaging inventory

Run the same inventory independently on both platforms. This is new same-host,
cross-account evidence; historical cross-host receipts are not part of its totals.
Use event/IPC barriers and computed deadlines, never polling loops. Expiry tests
must establish their start condition, wait a computed bound with scheduler slack,
and assert the resulting state, not pass merely because a sleep elapsed.
Coordinate barriers through controller-owned stdin/stdout pipes; no shared
writable IPC directory or messaging-store barrier is needed. Noninteractive
means no authentication prompt; protocol input on participant stdin is permitted.

Before provisioning, enumerate case → store/settings → config file → credential
file → exact Redis key/channel grants. Use independent stores where normalized
settings differ (for example T2 capacity and T8/L2 claim/retry intervals). All
clients in a case agree on its normalized config. Scope each credential to the
case's exact messagingKey root, descendants and notification channel; outside
means outside that grant, not merely a broad namespace. Apply fixture input
read/denial checks to every file in this mapping, including ACL/readiness variants.

| Family | Cases per platform | Roles and required assertions |
| --- | ---: | --- |
| D1 direct delivery | 24 | All six directed account pairs times Node→Node, Node→Bun, Bun→Node and Bun→Bun. Installed CLI sends a unique nonce, receiver waits and acknowledges, and sender observes durable accepted state. Duplicate ack remains idempotent. Both sides log the same stable message/delivery identities. |
| T1–T8 topic behavior | 16 | Eight cases below times two mixed-runtime assignments: A Node/B Bun/C Node and A Bun/B Node/C Bun. All operations run in distinct participant processes with their own restricted credentials. |
| L1–L3 other lifetimes | 6 | Three cases below under both mixed-runtime assignments. |
| A1–A6 ACL regression | 36 | Six cases below under each of A/B/C times Node/Bun. Label these per-identity reruns, not new cross-account exchanges. |
| R1–R3 readiness | 18 | Three cases below under each of A/B/C times Node/Bun. Label these per-identity reruns. |
| Total | 100 | 200 across both platforms. Fixture checks and a second verification pass are separate from this case total. |

Topic cases:

1. T1: A publishes to separate B/C subscriptions; exact matching fans out to
   both, each acknowledges; a subscription created later receives no old event;
   dedupe replay preserves the original snapshot. Disconnect/reopen one durable
   subscriber to prove an offline pending delivery survives.
2. T2: B/C workers share one subscription and cannot claim the same delivery
   concurrently. A publish to multiple subscriptions when one is full fails
   atomically; the non-full queue receives nothing from that rejected publish.
3. T3: A direct-send carrying topic metadata reaches B's mailbox but not C's
   topic subscription; direct send to a reserved subscription recipient refuses.
4. T4: A publishes, B claims, C removes and recreates the subscription. B's old
   receipt is stale, the generation changes and old pending work is cancelled.
   This intentionally exercises cooperative-store access, not identity isolation.
5. T5: A publishes to B's temporary subscription; B claims then becomes idle.
   A publishes inside the inactivity window while B stays idle, proving publish
   does not extend B's activity deadline. After that deadline C calls history
   to apply the candidate's sweep, then observes retirement; B's old receipt is
   stale. A later publish with no remaining matches is REFUSED. Place the retirement
   observation after B's last-activity deadline plus slack but strictly before
   A's in-window publish time plus TTL. Record both deadlines, with a gap wide
   enough for scheduler slack. Missing that window is an invalid test run,
   never a pass; it would fail to distinguish an incorrect activity refresh.
6. T6: B keeps a temporary subscription actively waiting across its inactivity
   interval; A's later publication is received and acknowledged. Idle listener
   activity renews the subscription; C records the fixture observation.
7. T7: B creates a subscription; C's incompatible creation options fail with
   CONFIG_MISMATCH, and duplicate topic filters fail with INPUT.
8. T8: A publishes to B's temporary subscription; after a handler starts, B
   closes gracefully while it runs beyond initial claim/subscription lifetimes.
   Renewal remains valid until the handler finishes; C observes acceptance.

Other lifetimes:

1. L1: A sends with bounded message expiry; after expiry B cannot claim it and
   C reads history after B's post-deadline claim attempt and observes expired
   terminal state. History performs the candidate's sweep before returning.
2. L2: A sends to a mailbox with B/C receivers. B's claim expires without ack;
   after the configured retry deadline C receives the same delivery with a new
   receipt, B's stale ack cannot mutate it, and C acknowledges successfully.
3. L3: B registers presence then exits without graceful cleanup. After its
   presence lifetime, A's broadcast applies cleanup and excludes B while reaching
   registered C; inspect the result only after that completed operation.
   B's durable mailbox still exists and can receive a subsequent direct send.

ACL cases (separate synthetic credential variants, owned by the same test UID):

1. A1: allowed in-store key read succeeds; out-of-store key read returns NOPERM.
2. A2: allowed notification publish succeeds; out-of-store publish is NOPERM.
3. A3: allowed notification subscribe succeeds; out-of-store subscribe is NOPERM.
4. A4: root-key-only permission cannot read computed store keys; startup is ACCESS.
5. A5: missing notification-channel permission rejects startup with ACCESS.
6. A6: revoke EVAL and TIME separately via the controller. Existing operations
   and fresh startup return definitive ACCESS without reconnecting established
   sockets; restore permissions and verify recovery, as in the historical suite.

Readiness cases:

1. R1: inspection denied, warn mode opens and emits the uninspectable warning.
2. R2: the same inspection-denied credential fails strict startup with READINESS.
3. R3: a separate inspection-capable restricted credential succeeds in strict
   mode against verified safe fixture settings. Only the needed read-only INFO
   and CONFIG GET capabilities are added, never configuration mutation or ACL
   administration. R3 uses a separate synthetic credential variant, not the
   ordinary messaging credential. CONFIG GET is not parameter-restricted: the
   fixture therefore has no requirepass/masterauth secret to disclose; use named
   ACL-user authentication instead. This does not promise lossless failover or infrastructure durability.

Unsafe-setting detection and internal timer-injection regressions outside these
cases retain historical SEM-2 evidence; they are not counted as fresh runs here.
Do not simply run the existing single-process topics suite and label it T1–T8.
Reuse its assertions through a new cross-UID participant driver where appropriate.

## Fixture checks (separate totals)

For each platform and runtime, all three owners successfully read their own
actual config and credential inputs, and all six directed cross-account reads
fail specifically with EACCES/EPERM. Do not accept ENOENT or a failed launcher.
A/B belong to a dedicated handoff group and can read its synthetic shared file;
C is the outsider and is denied. All three read the installed harness/packages.
All three are denied writes to the trusted runner, runtimes and package prefix.
For every UID on each platform, a fresh unauthenticated connection cannot execute
a store command, and AUTH default with an arbitrary fixture password is rejected.
Assert authentication errors, not connectivity failures, and pair these denials
with a successful named-participant connection. Redis default is off in startup configuration before its listener opens, not
merely switched off afterward. The controller's admin credential, Redis config,
aclfile if present, AOF/state and logs are controller/service-only readable.
Verify denied reads for each participant UID as well as valid controller/service
access; nobody can bypass ACL probes through readable Redis data files.

Mac accounts use dedicated non-staff groups, have no usable login password or
Remote Login membership, and are hidden from interactive login. Verify effective
groups and a narrow access check on personal-home directory boundaries without
reading personal file contents. Do not change personal-home modes to pass.

The Mac owner installs a root-owned immutable runner and an exact command rule
for switching only to the three fixture identities, never root. No shell or
arbitrary program argument is permitted. Review argument validation and the
ownership of every ancestor, interpreter and loaded script before activation.
Driver/harness changes require reinstallation through the reviewed checkpoint.
Retain this narrow design; budget additional owner-assisted installations for
accepted review fixes, batching related changes before reinstalling. Do not relax
trusted-code ownership to avoid a checkpoint.
Demonstrate no-TTY identity switches with closed authentication input after invalidating
the caller's sudo timestamp; cached authentication cannot establish unattendedness.
If this mechanism needs broader authority, stop and return to the owner.

Run fixture verification twice (distinct run IDs). Demonstrate collision refusal
without modifying a preexisting resource, a failed/partial setup recovery using
an isolated test manifest, refusal on identity mismatch, and harmless repeated
cleanup. Destructive negative tests never target unrelated real resources.
Document which failure paths were simulated and which lifecycle ran for real.

## Service and filesystem layout

Pin Redis 8.4.0, Node 22.21.1 on macOS / 22.23.0 on Linux, and Bun 1.4.2 on both,
as in the candidate receipts. Capture executable identities; unavailable pinned
runtimes are a reported prerequisite, not permission for a silent major upgrade.

Mac uses a dedicated fixture Redis process bound to loopback, administered by the
controller via a named ACL administrator. Disable the Redis default user before
participants connect; use no requirepass/masterauth configuration secrets.
Linux uses Redis inside the isolated glibc x64 fixture container,
also bound to its loopback, without published ports or a Docker socket mount.
The host driver alone controls Docker; participant processes run as unprivileged
container UIDs. The container controller may switch identities inside that
container only; document minimal capabilities (including SETUID/SETGID if used) and drop the
remainder. Prove noninteractive switches inside Linux as well as macOS.

Configure the fixture service explicitly for AOF, always-flush, flushing during
rewrite, healthy persistence and noeviction. The controller creates the restricted
credentials and supplies an explicit endpoint; reject unrelated endpoints. Do not
let existing server() defaults start nested Docker. Record Redis process/version,
service settings, endpoint identity and service storage/log ownership. No change
to a user's Redis service or network configuration is authorized.

Use an isolated fixture checkout under a reviewed prefix on each target, with
all conformance stores inside its `.tmp/`. Private homes contain actual config
and credential files; CLI cwd is within the matching home config root so discovery
works. Non-store scratch may also live there. Redis state and all conformance
stores remain in the fixture checkout's .tmp/, with private per-UID subdirectories
where required; setting cwd does not move those stores into a home. Shared harness and packages are read-only. The controller
captures stdout/stderr over pipes; participants do not write a common receipt log.

Linux has no bind mount of personal homes, the host checkout or its Docker socket.
Copy verified artifacts in and export receipts through the host driver. Container
UIDs do not grant access to host files. Before provisioning, record reviewed CPU,
memory, PID, storage and log limits plus enforcement/abort mechanisms for growth
where the Docker storage driver lacks quotas. Reserve capacity on the disposable
Terraform/Ansible host specified in `repeatable-cloud-provisioning.md`;
unavailable capacity blocks provisioning. Avoid privileged mode, host networking,
new host accounts and broad prune commands.

## Manifest, recovery and cleanup

Before setup, record existing resources privately and a unique run identity.
Record an intended resource before creation and its exact observed identity
immediately afterward, with exclusive names and a crash-recovery state. A crash
between creation and observation requires reconciliation of exact ownership or
owner intervention, never blind deletion. Refuse collisions and ownership drift.
Keep the authoritative manifest/control files outside participant-writable paths.

Inventory accounts, homes, groups, login attributes, runner and sudoers grant,
runtimes/packages/harness paths, Redis process/binary/config/state/logs and ACL
users, container/network/volume/image digests and any generated cache. Mark
preexisting resources. Revoke authorization, stop owned processes, then delete
only verified fixture resources. Remove temporary credentials and private data.
Validate sudoers after grant installation and removal. Record before/after checks
for every created resource class and the absence of surviving fixture privileges.

Only remove newly introduced Linux images/cache if exclusively fixture-owned and
unused by other workloads; never force removal of shared objects. If an introduced
object has become shared, report it and pause for an explicit owner disposition;
that is not permission to declare cleanup complete with unexplained leftovers.
Repeated cleanup is a verified no-op. Failed tests or interrupted setup still have
a safe cleanup path, and mismatched resources are reported without deletion.

## Sequence and retained evidence

Reviewed exact setup → owner-assisted bootstrap → fixture checks → required
matrix → blind code review and accepted harness fixes/reruns → durable receipt
capture → owner-assisted teardown → final read-only cleanup audit → completion.
The main review inspects teardown code before it runs. The final audit reconciles
actual removal receipts against that code and the manifest. A material audit
finding requires a fix and focused review within the repository's review budget;
it is not self-approved by a clean command exit. If another exercised change is
needed after teardown, return to approved provisioning and rerun affected cases.
Owner absence at teardown pauses completion; no lock before cleanup is verified.

Keep raw commands, sanitized output, exit statuses, test IDs/nonces, package and
harness/bootstrap hashes, process identities and manifests under the primary
checkout's private `.scratch/docs/` outside the disposable worktree. Sanitize
secrets at capture. Record absolute private locations in that private index.
Shareable results use repository-relative record IDs, digests, counts and
version-scoped conclusions, with no private host inventory. A reviewer must be
able to reconcile all 200 cases to retained receipts without host access or new
provisioning. Label inspection of old receipts separately from new test execution.

If shell provisioning scripts are delivered, syntax-check and ShellCheck them,
recording justified suppressions; do not assume TypeScript lint covers shell.
Preserve typecheck, the required lint formula, docs check, fresh blind review,
AGENTS.md progress marker and final handoff. Each of SEM-2's six debt criteria
must map to passing evidence. Missing artifacts, failed/skipped cases or absent
cleanup block completion. Product defects stop for a separate fix decision.


## Failure triage

First isolate whether a failure comes from fixture setup, config discovery,
identity switching, scheduling assumptions or the harness. Those fixes are in
scope with affected reruns. Establish a candidate product defect with a minimal
reproducer against the unchanged installed archives and a cited SPEC property;
remove unrelated fixture machinery, retaining multiple UIDs only when necessary
to reproduce the behavior. Do not label an unexplained failure a harness bug just
because it has not reproduced outside the fixture. If attribution remains
uncertain, preserve the failing evidence and report the blocker; it is not green.
Confirmed product defects return for the owner's separate fix decision.
