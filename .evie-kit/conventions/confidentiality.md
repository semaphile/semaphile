---
# Generic deny patterns (case-insensitive regex sources) every
# publication seam lints against. Starter default: none — add your
# organization's shapes (doc-id URL forms, tenant-id formats).
# deny_patterns:
#   - 'docs\.google\.com/(document|spreadsheets|presentation)(/u/[0-9]+)?/d/'

# Starter default FALSE so scaffolding this file never arms a refusal:
# the lint runs tracked-patterns-only until the machine-local half
# exists. Flip to true once .evie-kit/conventions/confidentiality.local.md
# (gitignored) carries your real deny_tokens — from then on a machine
# WITHOUT the local half refuses to publish rather than silently
# checking nothing.
require_local: false
---

<!-- Starter default placed by `evie-kit setup` (EVA-140). This file is
     YOURS: edit it to your project's conventions — setup never rewrites
     it. Its PRESENCE arms the matching lifecycle lint; delete it (or
     rename confidentiality.md) to opt out. -->

# Confidentiality rules

The TRACKED half of the confidentiality pair (EVA-139): generic
patterns in the frontmatter feed the deterministic publication lint;
this prose feeds agent judgment. The machine-local half —
`confidentiality.local.md`, gitignored — carries the actual names,
domains, and topics, which tracking would defeat.

Rules for anything committed, promoted, shared, or published from
this repo:

- **Never name clients or client individuals** — use sanctioned alias
  spellings (the local file's `deny_tokens` entries carry each
  alias).
- **No direct quotes from private meetings** — paraphrase decisions
  and outcomes.
- **No client-identifying artifacts** in committed content: document
  URLs/ids, tenant ids, customer email domains, internal codenames.
