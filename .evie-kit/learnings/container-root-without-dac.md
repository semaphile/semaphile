---
title: "Container root without DAC capabilities"
summary: "no DAC_OVERRIDE: switch to the owner for 0700 dirs; setpriv needs SETPCAP; redis image has no procps"
source: SEM-3
seat: executor
written: 2026-10-03
---

# Container root without DAC capabilities

Inside a container started with `--cap-drop ALL` plus CHOWN, SETUID, SETGID and
KILL, root has no DAC_OVERRIDE or DAC_READ_SEARCH. It cannot list, read or
delete inside another UID's 0700 directory, so cleanup must switch to the owner
first (`setpriv --reuid ... find "$dir" -mindepth 1 -delete`), and ownership
records for a service's private directory must be taken as that service.
`setpriv --bounding-set=-all` also needs CAP_SETPCAP, which `--cap-drop ALL`
removes; without it every identity switch fails with EPERM. The official
`redis` image also ships no procps, so `pkill` and `pgrep` are absent and a
`/proc/*/status` scan is needed to find a UID's processes.
