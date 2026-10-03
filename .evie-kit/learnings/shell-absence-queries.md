---
title: "Absence queries must fail closed"
summary: "a failed query inside a test substitution reads as absent; capture and fail first"
source: SEM-3
seat: executor
written: 2026-10-03
---

# Absence queries must fail closed

In shell, `[ -z "$(query)" ]` treats a failed query as "nothing found": a
failing command substitution inside a test triggers neither `set -e` nor
`pipefail`. Any check whose empty answer means "absent" (an audit that nothing
remains, a preflight that no fixture exists, a teardown that a container is
gone) must capture first and fail on the query's own exit:

    out=$(gcloud ... list --filter=...) || fail 'gcloud list failed'
    [ -z "$out" ] || echo "audit: ... remain"

The same holds for `terraform state list` (a missing state file is an error,
not an empty state, once anything was applied) and for every Docker listing.
`conformance/accounts/cloud/run.sh` and `linux/host.sh` follow this pattern.
