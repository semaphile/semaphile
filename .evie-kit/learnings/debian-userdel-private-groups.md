---
title: "userdel removes Debian private groups"
summary: "USERGROUPS_ENAB yes makes userdel delete the user's group; reconcile before groupdel"
source: SEM-3
seat: executor
written: 2026-10-03
---

# userdel removes Debian private groups

On Debian (and so in the official `redis` images, which are bookworm-based),
`/etc/login.defs` sets `USERGROUPS_ENAB yes`. With that, `userdel` also deletes
the user's private group when the group has the user's name and no other
members. A teardown that deletes the users and then runs `groupdel` on each
recorded group fails with exit 6 on the first private group, and under `set -e`
stops before the rest.

Reconcile groups after deleting users: an absent group was removed with its
user; a present one must still match its recorded identity before `groupdel`.
`conformance/accounts/linux/container.sh` does this in `teardown()`.
