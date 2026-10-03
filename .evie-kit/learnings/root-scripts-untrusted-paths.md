---
title: "Root scripts and untrusted account paths"
summary: "root must not follow links or write into a less-privileged account's paths"
source: SEM-3
seat: executor
written: 2026-10-03
---

# Root scripts and untrusted account paths

A script the owner runs as root must treat every path a less-privileged
account controls as hostile. `cp`, `chown` and `chmod` (BSD and GNU) follow
symlinks, `[ -d ]` follows them, and `ditto` copies through them, so root
writing a predictable name into the controller's directory, or copying the
controller's staging tree, lets that account overwrite or read any root file.

Write receipts as the less-privileged account with noclobber
(`sudo -n -u <controller> sh -c 'umask 077; set -C; cat >"$1"'`), refuse
links on every staging path, hash a root-private copy of any listing rather
than the account's file, and keep the install target 0700 until its contents
match the reviewed listing. `conformance/accounts/macos/admin.sh` does this.
