# Cross-account Redis messaging fixture

This fixture runs Redis messaging between three dedicated, unprivileged OS
identities on native macOS arm64 and on Linux x64. Each identity has a private
home holding its own `semaphile.json` files and 0600 credential files, and runs
the installed SEM-2 0.3.0 candidate archives under Node and Bun. It resolves
the OS-account validation that SEM-2 deferred. It adds no messaging semantics:
[SPEC.md](../../SPEC.md) sections 16 and 20 remain the contract.

The fixture proves same-host exchange between separate identities, private
configuration isolation and restricted Redis credentials. It does not prove
cross-host behavior, registry allocation, shared SQLite support, failover or
package publication. Redis ACLs restrict a store's keys and notification
channel; participants inside one store still cooperate (case T4 exercises that
deliberately).

## Identities and layout

| Identity | UID/GID | Groups            | Role in cases         |
| -------- | ------- | ----------------- | --------------------- |
| `sem3a`  | 3601    | `sem3a`, `sem3ab` | A                     |
| `sem3b`  | 3602    | `sem3b`, `sem3ab` | B                     |
| `sem3c`  | 3603    | `sem3c`           | C, the share outsider |

`sem3ab` (GID 3610) is the handoff group. Everything lives under one prefix,
`/opt/semaphile-sem3`:

| Path                                     | Owner and mode                                         | Contents                                                                |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `bin/sem3-participant`                   | root, 0755                                             | the runner                                                              |
| `runtime/node`, `runtime/bun/bun`        | root, no group/other write                             | pinned official runtimes                                                |
| `checkout/`                              | root, no group/other write                             | harness export, candidate archives, installed consumer                  |
| `checkout/.tmp/controller`, `.tmp/redis` | controller (macOS) or root/Redis service (Linux), 0700 | Redis config, AOF, log, admin credential                                |
| `checkout/.tmp/participants/<id>`        | the identity, 0700                                     | participant `TMPDIR`                                                    |
| `home/<id>`                              | the identity, 0700                                     | `projects/<profile>/semaphile.json`, `.sem3/credentials/<profile>.json` |
| `shared/handoff.txt`                     | root:`sem3ab`, 0640 in a 0750 directory                | synthetic shared file                                                   |

The macOS accounts have `/usr/bin/false` as their shell, no password hash
(`Password *`, no `AuthenticationAuthority`), `IsHidden 1`, and no membership
of `com.apple.access_ssh`. Linux identities exist only inside the fixture
container.

## Trust and ownership model

The controller is an ordinary account on macOS and container root on Linux. It
holds the Redis administrator credential and never passes it to a participant.

- **Runner.** `bin/sem3-participant` accepts exactly one argument, `node` or
  `bun`, checks that its identity is one of the three fixture accounts, changes
  to that account's home and execs the fixed `participant.mjs` with an
  allowlisted environment (`HOME`, `USER`, `LOGNAME`, `PATH`, `LANG`, `TMPDIR`,
  and for Bun `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, which keeps Bun's
  transpiler cache out of the homes). It calls only absolute paths.
- **macOS switching.** One sudoers rule lets the controller run exactly
  `/opt/semaphile-sem3/bin/sem3-participant node` and `... bun` as `sem3a`,
  `sem3b` or `sem3c`, with `env_reset`, an empty `env_keep` and a fixed
  `secure_path`. It grants no root, no shell and no other argument. The fixture
  check `identity-switch` invalidates the sudo timestamp and then proves both
  the unattended switch with closed input and the refusals.
- **Linux switching.** The container runs with every capability dropped except
  `CHOWN`, `SETUID`, `SETGID` and `KILL`, with `no-new-privileges`. The
  controller starts participants through `setpriv` with an empty bounding set,
  and each participant reports all-zero capability sets.
- **Trusted code.** Every ancestor of the prefix, the runner, both runtimes,
  the harness and every installed package file is root-owned and not group- or
  world-writable (`trusted-ownership`). Any change to the runner or harness
  means reinstalling through the reviewed administrator step.
- **Participant.** `participant.mjs` answers JSON lines from the controller
  over its own stdin and stdout. Its operations are fixed: open a client
  through `messagingOptions()` and `openConfiguredMessaging()`, call allowlisted
  client methods, run the installed CLI with allowlisted subcommands (never
  `listen`, never the selector flags `--store`, `--redis-url-env`,
  `--namespace` or `--messaging-store`), and run raw RESP probes. It reads its
  credential file after the switch and passes the URL only to its own CLI
  child.

## Cases, configurations, credentials and grants

Each account gets one profile per row: a `semaphile.json`, a credential file
and a Redis user named `<id>-<profile>`. The Redis namespace is
`sem3-<run>`. `KEY` is `messagingKey(namespace, store)`.

| Profile         | Store   | Configuration beyond the defaults                          | Grant                                                 | Used by   |
| --------------- | ------- | ---------------------------------------------------------- | ----------------------------------------------------- | --------- |
| `d1`            | `d1`    |                                                            | standard                                              | D1        |
| `t1`, `t3`–`t7` | `t1`…   | per-subscription TTLs where the case needs them            | standard                                              | T1, T3–T7 |
| `t2`            | `t2`    | `maxPendingPerRecipient: 1`                                | standard                                              | T2        |
| `t8`            | `t8`    | `claimTtlMs: 1500`                                         | standard                                              | T8        |
| `l1`            | `l1`    |                                                            | standard                                              | L1        |
| `l2`            | `l2`    | `claimTtlMs: 1500`, `retryDelayMs: 1000`, `maxAttempts: 3` | standard                                              | L2        |
| `l3`            | `l3`    | `sessionTimeoutMs: 3000`                                   | standard                                              | L3        |
| `acl`           | `acl`   |                                                            | standard                                              | A1–A3     |
| `acl-rootonly`  | `acl`   |                                                            | `~KEY` only                                           | A4        |
| `acl-nochannel` | `acl`   |                                                            | keys, no channel                                      | A5        |
| `acl-revoke`    | `acl`   |                                                            | standard (the controller revokes `EVAL`, then `TIME`) | A6        |
| `ready-warn`    | `ready` | `readiness: warn`                                          | standard                                              | R1        |
| `ready-strict`  | `ready` | `readiness: strict`                                        | standard                                              | R2        |
| `ready-inspect` | `ready` | `readiness: strict`                                        | standard plus `+info +config\|get`                    | R3        |

The standard grant is `~KEY ~KEY:* &KEY:notify` plus the documented command
allowlist in [docs/redis-messaging.md](../../docs/redis-messaging.md). Every
profile also sets `operationTimeoutMs: 10000` and `configMismatch: error`. All
clients in a case read the same normalized configuration.

The inventory is fixed at 100 instances per platform:

| Family | Instances | Participants                                                                                   |
| ------ | --------: | ---------------------------------------------------------------------------------------------- |
| D1     |        24 | six directed account pairs × Node→Node, Node→Bun, Bun→Node, Bun→Bun, through the installed CLI |
| T1–T8  |        16 | A, B and C in separate processes, assignments X (Node/Bun/Node) and Y (Bun/Node/Bun)           |
| L1–L3  |         6 | the same two assignments                                                                       |
| A1–A6  |        36 | per-identity reruns: each identity × Node and Bun                                              |
| R1–R3  |        18 | per-identity reruns: each identity × Node and Bun                                              |

A case counts only when every participant's reported PID, UID/GID,
supplementary groups, home, working directory, platform, architecture,
executable, runtime version and resolved package paths match the manifest, and
when a probe connection from each participant, made with that participant's
own credential file, appears in the server's `CLIENT LIST` under that
participant's Redis user. Timing cases compute their deadlines from recorded
timestamps. T5 records both the activity deadline and the deadline that a
wrong refresh would produce, and marks the run INVALID, never PASS, when the
observation falls outside the window between them.

Fixture checks run once per runtime and are counted separately: identity,
reads of every one of the account's 38 mapped files, all six directed
cross-account reads (EACCES or EPERM, never ENOENT), the handoff share and its
outsider, readability of the trusted tree, write denial on it, unauthenticated
and `AUTH default` refusal paired with a successful named connection, denial of
the Redis files, the personal-home boundary on macOS (directory listing only,
no file contents), and native-free loading. The controller adds the
installed-candidate comparison, Redis startup settings, service access, trusted
ownership, identity switching and, on macOS, login attributes.

## Procedure

Raw receipts and exact host commands stay in the primary checkout's private
`.scratch/docs/` tree; this file names no host.

### Staging (controller, unprivileged)

```sh
node conformance/accounts/stage.mjs --platform darwin --commit <sha> \
  --out <staging> --candidates <candidate-archive-dir> --downloads <dir>
node conformance/accounts/stage.mjs --platform linux --commit <sha> \
  --out <staging> --candidates <candidate-archive-dir> --downloads <dir>
```

Staging exports `conformance/accounts` from the commit, copies the four
archives and checks their SHA-256 before and after, downloads the pinned
official Node and Bun archives and checks the published SHA-256, and builds an
offline npm cache holding exactly the tarballs in `package-lock.json`, taken
from the local cache with their index entries. The lock matches the candidate
commit's own locks entry for entry (`candidate-pins.json`; staging regenerates
and compares it). On macOS it then installs offline with the pinned runtime's
npm and compares every installed Semaphile file with its archive. It prints
the SHA-256 of `STAGED-FILES.txt`, which the owner checks before setup.

### macOS

The owner runs a root-private copy of `macos/admin.sh`, verified against its
reviewed SHA-256, first with `rehearse` and then with `setup`. The rehearsal
uses an isolated state directory: it proves the collision refusal against an
existing account without changing it, crashes a setup after creating an
account but before recording it, refuses teardown of a manifest whose recorded
identity was altered, recovers the partial setup, and repeats the teardown as
a verified no-op. The controller then runs:

```sh
/opt/semaphile-sem3/runtime/node/bin/node \
  /opt/semaphile-sem3/checkout/conformance/accounts/controller.mjs run \
  --run <id> --receipts <private-dir> --redis-binary <redis-server 8.4.0>
```

After review, the owner runs `teardown` and then `teardown` again, and the
controller's read-only audit confirms that no name, ID, path or grant remains.

### Linux

`linux/drive.sh USER@HOST <subcommand>` runs `linux/host.sh` over ssh without
copying it to the host. The sequence is `preflight`, `pull`, `create`,
`load` (stdin carries the bundle; the hash is taken again inside the
container), `unpack` (checks the listing hash and the bytes of `container.sh`
before running it), `admin rehearse`, `admin setup`, `controller` twice,
`export_receipts`, then after review `admin teardown`, `teardown` and `audit`.

The container is bounded as follows:

| Resource          | Limit                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Network           | `none`: no published port, no bridge, no host networking                                                                         |
| CPU, memory, PIDs | 2 CPUs, 3 GiB memory with no swap, 512 processes, 4096 open files                                                                |
| Capabilities      | only `CHOWN`, `SETUID`, `SETGID`, `KILL`; `no-new-privileges`; not privileged                                                    |
| Writable storage  | tmpfs only: the prefix (1.5 GiB), `/tmp` (64 MiB), `/var/tmp`, `/run`, `/data` (the image's volume path, so no anonymous volume) |
| Disk layer        | checked by `size`; over 32 MiB stops the container                                                                               |
| Logs              | log driver `none`; Redis output is captured by the controller on tmpfs                                                           |
| Mounts            | no bind mount, no Docker socket, no host checkout or home                                                                        |

`preflight` refuses unless the host has at least 4 CPUs, 6 GiB of available
memory and 2 GiB free for Docker, and no labelled fixture container, volume or
network exists. The image is the official `redis:8.4.0` (Debian bookworm,
glibc), pinned by its linux/amd64 manifest digest.

## Manifest, recovery and cleanup

Each admin script keeps an append-only `state.tsv` outside participant-writable
paths (`/var/db/semaphile-sem3` on macOS, `/var/lib/semaphile-sem3` in the
container). Every line is `time`, `status` (`intended`, `observed`,
`removed`), `class`, `name` and attributes; the last line per class and name
wins. A resource is recorded as intended before it is created and as observed,
with its identity (UID/GID, GeneratedUID, passwd entry, file hash), right
after. A crash between the two leaves an intended record that teardown
reconciles only when the live resource matches the intended identity exactly.

Teardown verifies every recorded resource first. It always revokes a sudoers
grant whose recorded hash matches, and otherwise deletes nothing if any
identity differs. When everything matches it stops fixture processes, removes
the prefix, the accounts and the groups, validates sudoers, and removes its
state directory. With no state directory it only confirms that no fixture
name, ID or path exists.

Cleanup targets are exactly: the three accounts and four groups, their homes
and the prefix, the sudoers file, the state directories, the per-run Redis
users and credential files (removed at the end of every controller run), and
on Linux the fixture container and, if this fixture pulled it and nothing else
uses it, the image. Existing accounts, runtimes, Redis installations and
unrelated containers, images and volumes are never targets; nothing runs a
broad prune.
