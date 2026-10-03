---
title: "macOS accounts inherit nested groups"
summary: "derive the groups every local account inherits at run time; never a fixed list"
source: SEM-3
seat: executor
written: 2026-10-03
---

# macOS accounts inherit nested groups

Every local macOS account inherits groups it was never added to. `everyone`
(12) and `localaccounts` (61) are computed for every local-node user, and
group-side `NestedGroups` records add more: `_lpoperator` (100) nests
`localaccounts`, and file-sharing setups add `com.apple.sharepoint.group.*`
GIDs that nest `everyone`. `id -G` and Node's `process.getgroups()` both report
them, and a process started through `sudo -u` carries them.

So a check that a test identity holds "no unexpected supplementary group" cannot
use a fixed list. Read the inherited set at run time from hidden local accounts
with no explicit memberships (`nobody`, `daemon`, `_www`), require that they
agree, record the set, and still refuse privileged groups (wheel 0, staff 20,
admin 80, the remote-access groups) outright. `conformance/accounts/lib/checks.mjs`
does this in `inheritedGroups()`.
