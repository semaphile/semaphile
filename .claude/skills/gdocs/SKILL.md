---
name: gdocs
description: >-
  Surgical Google Docs work through @evie-kit/gdocs — push local
  markdown to a doc as one atomic minimal diff (tables ride a second
  revision-guarded fill batch — recoverable, not all-or-none), edit
  addressed blocks
  through the shared selector grammar, classify local-vs-remote drift
  exactly (real revision ids), and read a doc's block outline before
  aiming an edit. Use when writing to Google Docs from a repo, keeping a
  doc in sync with a local file, triaging "did someone edit the doc?",
  or setting up Google auth for either shape (service account with
  domain-wide delegation, or the refresh-token fallback). Also use
  before hand-rolling any Docs API call — the batchUpdate index
  arithmetic a raw call would need is exactly what this package exists
  to own.
argument-hint: "[what you want to do with Google Docs]"
---

# Google Docs

`evie-kit gdocs <verb>` wraps `@evie-kit/gdocs`. Seven verbs; the
package's exported primitives for anything a verb does not cover.

Zero-ambiguity invocation when the bin might not be linked:
`bun node_modules/@evie-kit/cli/src/evie-kit.ts gdocs <verb> …`

**Toolchain guard (EVA-81)**: module-not-found on that path means the
machine's bootstrap has not run — not a broken repo. Run it once BY
PATH: `bun /path/to/evie-kit/packages/cli/src/evie-kit.ts onboard`
(`EVIE-KIT.md` at the project root has the full bootstrap).

**Credentials** resolve through the project's layered settings, per
field: `tools.gdocs.*`, then the `GDOCS_*` env vars, then the
credential files (`~/.openclaw/credentials/gdocs-service-account.json`
/ `gdocs-refresh-token`). Two refusals come BEFORE any fallback —
`tools.gdocs.enabled: false` (the project's off-switch) and a settings
knockout (a declared credential whose `${VAR}` did not resolve).
Neither falls through to ambient credentials, because that is how a
write lands in the wrong Google account.

**Two auth shapes** (decision 2 of the goal that built this,
EVA-119): a **service account with domain-wide delegation** is the
headless primary — no token lifecycle, but a one-time Workspace-admin
grant of the client id for the `documents` + `drive.file` scopes must
exist, and `tools.gdocs.subject` names the user writes act as. Doc
CREATION (`sync --create`) requires that user identity: a bare service
account can edit docs shared with it but gets a 403 on create
(`GDOCS_CREATE_NEEDS_DELEGATION` names the cure) — set
`tools.gdocs.subject` (or `GDOCS_SUBJECT`) for any flow that makes
docs. The
**stored refresh token** is the no-admin fallback: one
`evie-kit gdocs auth` consent as yourself, the token landing in the
machine's credential files (the paths above) and resolved through the
project's key chain — put it in a repo's gitignored
`tools.gdocs.refreshToken` rung instead when one machine must keep
projects on different Google identities; writes act as you personally.
An `invalid_grant` refusal names its own cure — re-consent for the
token shape, the delegation grant for the service account. Prove
either shape with `evie-kit gdocs auth --check`.

## The rule that matters most: nothing here rewrites a doc

Every write verb computes the MINIMAL block operations, compiles them
into ONE `batchUpdate` batch, and sends it under the read's
`requiredRevisionId`. That buys two guarantees notion cannot offer:
the batch is **atomic** (all of it lands or none of it does), and the
revision guard makes every write **optimistic-concurrency safe** — a
doc that changed between your read and your write refuses with
`GDOCS_REVISION_CONFLICT` instead of writing into shifted indices.
Re-run the verb; the fresh read re-addresses (reanchor-or-refuse).
The ONE exception (EVA-123): a write that materializes TABLES is a
recoverable TWO-phase write, not all-or-none — the structure batch is
atomic, the cell-fill batch runs against a re-read guarded to phase
one's exact revision, and a failure between them leaves EMPTY tables,
named by their pending `evb:` ranges in the error. Recovery differs by
verb (the error prescribes it, naming the doc id explicitly): re-running
the SYNC with `--doc <id>` heals, but a PATCH must never be replayed —
its phase one applied ALL of its content, paragraphs included, so a
replay duplicates it; reconcile with a whole-body sync, or manually
roll back the half-applied content before re-applying.

## The action surface

Verbs, with flags and refusal vocabulary: `references/verbs.md`.

- `gdocs report --doc <id|url>` — the doc's block outline (ids, types,
  indices). Read this BEFORE aiming a patch.
- `gdocs patch <selector> --doc <id|url> --replace|--delete|--insert-after|--insert-before`
  — surgical edits on ONLY the addressed region, through the shared
  selector grammar (Targets, stamps, and selectors, below). Content
  from `--content` or `--file`; `--dry-run` plans without writing.
  Applied patches VERIFY themselves (refetch + assert the promised
  result; `--no-verify` opts out visibly).
- `gdocs sync <file.md>` — push the whole file as a minimal diff;
  target from `--doc` or the file's `gdoc_id` stamp; `--create` makes
  the doc; stamps the sync base back into frontmatter.
- `gdocs status <file.md>` — drift classification: `in_sync` /
  `local_changed` / `remote_changed` / `conflict` — exact on the
  remote side, because Docs revision ids change on every write.
- `gdocs auth` — the one interactive verb (consent flow for the
  fallback); `--check` proves whichever shape is configured.
- `gdocs comments --doc <id|url>` — the doc's comment threads (Drive
  API, EVA-126): author, quoted text, resolution state, replies;
  `--unresolved-only` for the act-on-feedback view.
- `gdocs comment --doc <id|url>` — create a doc-level comment
  (UNANCHORED — recorded Drive limit), `--reply <commentId>` into a
  thread, or `--resolve <commentId>`; `--dry-run` rehearses the exact
  text. Both comment verbs reach only docs this app CREATED OR OPENED
  (the `drive.file` scope — recorded limit).
- `gdocs share --doc <id|url>` — the publish trio (EVA-158): `--link`
  (anyone-with-link reader), `--rename <title>`, `--trash`; flags
  compose, bare invocation reports name/trashed/link state, and
  `--dry-run` plans without writing. Same `drive.file` reach as the
  comment verbs.

## Recorded limits (what does not round-trip)

Stated, not glossed — each refuses by name rather than degrading
silently (`packages/gdocs/docs/recorded-limits.md` for the full list):

- **No native code blocks**: fenced code renders as mono-styled
  paragraphs (`Courier New`), one per line — the recorded convention.
- **Tables round-trip; the diff picks its shape** (EVA-123/131/134): a
  GFM pipe table becomes one table block. STRUCTURE-FROZEN changes
  (same rows × columns) rewrite only the changed CELLS in place. A
  ONE-AXIS dimension change (rows changed OR columns changed) REALIZES
  as row/column operations plus rewrites of only the changed kept
  cells. Untouched cells' paragraphs and their comment anchors
  survive natively (EVA-134). A BOTH-axes change, or one where no line
  of the old table survives, still replaces the whole table. In every
  shape the `evb:` identity is kept. Only UNIFORM tables diff
  (rectangular, no merged cells, one plain paragraph per cell); others
  stay atomic containers, and `sync` still refuses a doc holding one
  (`GDOCS_CONTAINER_UNSYNCABLE`). Tables and `---` section breaks need
  a line of prose on BOTH sides (`GDOCS_STRUCTURE_PLACEMENT` — a real
  API constraint, probe-verified).
- **Text-only paragraph edits land as substring windows** (EVA-131):
  formatting outside the window — including styling markdown cannot
  express — and comment anchors away from the edit survive; styling
  and type changes still rewrite the block.
- **Writes that would orphan an unresolved comment's anchor refuse**
  (`GDOCS_COMMENT_ANCHORED`, EVA-131) — with a machine-readable
  anchor-overlap report in the refusal, and `--preserve-comments` as
  the capture-and-restore middle path (EVA-134). Present the choice to
  the user as a picker — see Per-runtime delivery, below.
  Range-aware; degrades loudly in the report when comments cannot be
  listed (the `drive.file` scope limit) — except under
  `--preserve-comments`, which then refuses
  (`GDOCS_PRESERVE_UNAVAILABLE`): a promise it cannot keep.
- **`---` renders as a NEXT_PAGE section break**, matched by type only
  (section styling set in the UI is never rewritten). Page breaks stay
  out of the vocabulary.
- **Written prose paragraphs get `spaceBelow: 10pt`** (code-convention
  paragraphs 0); spacing is not diffed, so UI-applied spacing on
  untouched blocks survives every re-sync.
- **Written paragraphs get explicit `alignment: START`** (EVA-158) —
  document themes render named heading styles CENTER-aligned, so
  alignment is never inherited on write. Not diffed: UI-applied
  centering on untouched blocks survives; a block the sync REWRITES
  snaps back to START.
- **Lists nest ONE level** (EVA-158): an indented marker directly
  under a list item is a level-1 item that joins its PARENT's list.
  The parent's kind types it, and the Docs preset ladder picks the
  glyph (a `-` sub-item under a numbered parent renders lettered, not
  bulleted — recorded limit). Deeper markers, and indented markers
  with no list item above them, refuse (`GDOCS_MARKDOWN_NESTED_LIST`);
  a doc whose own lists nest past level 1 reads those items as atomic
  containers. Numbering RESTART is not controllable: Docs merges
  adjacent same-preset lists. Two markdown numbered lists separated by
  only a paragraph can therefore continue one numbering sequence (no
  restart request exists in the API — recorded limit).
- **Blockquotes lose their marker**: `> text` renders as an ordinary
  paragraph — a recorded LOSSY conversion; it does not refuse.
- **Inline images round-trip STANDALONE** (EVA-126): a line that is
  exactly `![alt](url)` inserts an inline image; identity is the
  source URI, so kept images are held in place and a URL change
  replaces in place. Public http(s) only, URL ≤2 KB, image <50 MB and
  ≤25 MP (`GDOCS_MARKDOWN_IMAGE_URI` / `GDOCS_IMAGE_REJECTED`); alt text is
  parsed and DROPPED (no API spelling); images embedded in prose,
  lists, or table cells refuse (`GDOCS_MARKDOWN_INLINE_IMAGE`);
  UI-pasted images (no sourceUri) stay atomic containers.
- **Inserted images are sized, write-only** (EVA-158): a
  `![alt](url =440x)` width hint (POINTS, not pixels) applies
  verbatim; unhinted images are dimension-probed and capped to
  `--image-max-width-pt`/`--image-max-height-pt` (defaults 440/480pt).
  Caps never upscale, and an unprobeable image inserts at native size
  — reported, never silent. Size never participates in identity: a
  hint change on an already-synced image emits nothing (change the
  URL to re-size), and UI-resizes on untouched images survive.
- **Unresolved suggestions refuse the write that would CLOBBER them**
  (`GDOCS_SUGGESTIONS_UNRESOLVED`, range-aware since EVA-126): a write
  rewriting a block that carries a pending suggestion refuses naming
  the block; suggestions elsewhere in the doc are REPORTED
  (`pendingSuggestions` in the verb report) and never block. Resolve
  in the Docs UI, or keep the write away from the suggested blocks.
- **Tabs**: a tabbed doc is read through its FIRST tab only; a tab
  selector is a recorded follow-up (Scope note, below).

## Targets, stamps, and selectors

- **Targets** come from `--doc <id|url>`, or from the file's own
  `gdoc_id` frontmatter stamp — `sync` and `status` resolve both;
  `patch`, `report`, and the two comment verbs take `--doc` only
  (copy the id out of the frontmatter). Neither, plus `--create` on
  `sync`, makes a fresh doc.
- **Sync stamps** are what make drift detection work across
  processes. A successful `sync` writes the flat `gdoc_id` target plus
  a `gdocs_sync:` NAMED SECTION (`doc_id`, `revision`, `render_rev`,
  `synced_at`) back into the file's frontmatter (`--no-stamp` skips).
  One file can carry gdocs and notion stamps side by side (EVA-158),
  each tool owning its own section. Legacy flat `gdoc_*` stamps are
  still read and migrate into the section on the next stamp write.
  A stamp write also unifies line endings: any CRLF in the file
  re-emits the whole file CRLF (recorded limit). `status` classifies
  against them. A missing, partial, or wrong-doc
  stamp degrades to `unstamped` — never an error, and never a
  misattribution.
- **Block ids** are the adapter's other stamp discipline. Blocks it
  writes get an `evb:` NAMED RANGE as a stable block id — anchors
  that survive other people's edits (beyond what the notion adapter
  offers). Blocks it has never written carry positional `pos:<n>`
  ids, valid only against the revision they were read from — which
  the revision guard enforces. `report` shows both kinds, plus the
  stale-range count.
- **Selectors** address blocks for `patch`:
  `<axis>:<value>[#<ordinal>]` over the axes `heading`, `section`,
  `text`, `block`, `cell`. A leading `~` makes the match a
  case-insensitive substring. `cell:` addresses ONE uniform-table
  cell (EVA-131), in two forms: `cell:Fees[Amount]` — row by its
  first-column text, column by its header-row text — and `cell:2,3`
  by 1-based coordinates; `--replace`/`--delete` only. Every
  ambiguity is a refusal listing the candidates, because addressing
  the wrong block is a silent corruption.

## Comments are never doc content

Comments live in the DRIVE API, not the Docs API, and this package
quarantines them from every render and sync path. The quarantine is
enforced by a code-level allow-list, not by convention (EVA-131
pinned the one consumer permitted to read comment data on a write
path: the anchor guard). Comment text must never enter synced
content. A file that folded a comment into the body would push it
back as body text on the next sync, laundering someone's margin note
into the document permanently.

Both directions are available and both stay outside the body:

- **Read** — `gdocs comments --doc <id|url>`: every thread with its
  author, plain-text content, `resolved` state, the QUOTED doc text
  it anchors to (when Google recorded one — UI-created comments carry
  it), and its replies. `--unresolved-only` is the act-on-feedback
  view.
- **Write** — `gdocs comment`: create a doc-level comment (UNANCHORED
  — a recorded Drive limit: the API cannot anchor a new comment to
  doc content; anchors read, never write, for Docs),
  `--reply <commentId>` into a thread, or `--resolve <commentId>`.
  `--dry-run` rehearses the EXACT text a real run would post —
  rehearsal and post share one renderer.
- Both verbs reach only docs this app CREATED OR OPENED (the
  `drive.file` scope — recorded limit); a doc authored elsewhere
  403/404s with the cure named.

**The etiquette rule.** When a write of yours destroys or displaces
something a human wrote — an anchored thread, quoted text — say so
where they will see it. The preserve flow (Per-runtime delivery,
below) is this rule mechanized: every orphaned thread is re-posted
attributed with a locator, and the original is resolved, never
deleted.

## Refusals you will meet

A refusal is a diagnosis: it tells you something true about the doc
or the config. Never work around one with a raw API call:
`GDOCS_REVISION_CONFLICT` means re-read and re-aim;
`GDOCS_SELECTOR_*` refusals print the grammar and the doc's headings;
`GDOCS_AUTH_*` refusals name the exact cure. The selector ambiguity
refusals (`#n` ordinal vs a block literally named "Issue #1") exist
because addressing the wrong block is silent corruption — pick the
spelling the error offers. The per-verb refusal vocabulary is in
`references/verbs.md`.

And cite them only when they actually fired: the Recorded limits
above are documentation, not evidence. A documented limit is stated
on the skill's authority ("comment creation is unanchored — this is
recorded"), never dressed up as a live refusal you observed.
Reporting a refusal code as the outcome of a probe you never ran is
fabrication, even when the limit is real.

## Use cases (progressive disclosure)

Read the reference for the job you are doing, not all of them.

- **Pushing a repo file to a doc, and keeping it there** — `sync`
  (`--create` the first time), `status` before every re-sync; the
  sync stamps carry the drift baseline (Targets, stamps, and
  selectors, above).
- **Aiming a surgical edit** — `report` FIRST (the block outline is
  what selectors address), then `patch`; `--dry-run` when unsure.
- **Triaging "did someone edit the doc?"** — `status <file.md>`:
  exact on the remote side, because Docs revision ids change on every
  write.
- **Acting on reviewer feedback** — `comments --unresolved-only`,
  apply the asked-for edits (the anchor guard makes each thread's
  fate an explicit decision — Per-runtime delivery, below), close
  addressed threads with `comment --resolve`.
- **Setting up auth** — the two shapes in the intro; `auth --check`
  proves whichever is configured.
- **`references/verbs.md` — the CLI reference.** Every flag, every
  report field, and what each verb refuses.
- **`packages/gdocs/docs/recorded-limits.md`** — the full
  recorded-limits list behind the summary above.

## Per-runtime delivery

The invariant on every runtime: **a write that would destroy a
human's comment thread is decided by a human, and the outcome is
reported where they can see it.** Preserve, drop, or abort is their
call. How the decision is collected differs by runtime. The CLI
itself never asks (the EVA-92 pattern: pickers live at the agent
layer): it REFUSES with `GDOCS_COMMENT_ANCHORED`, whose message ends
in a machine-readable JSON **anchor-overlap report**. Per thread the
report carries the comment id, author, created time, text, quoted
anchor span, reply count, and the op that would destroy it.

- **Claude Code** (EVA-134): turn the refusal into an
  `AskUserQuestion` picker. Brief first (the explain-first
  discipline): summarize each thread from the report in prose — who
  commented, when, on what quoted text, what the write does to it —
  before any picker. The user is deciding the fate of a colleague's
  comment, and the picker captures only the decision. Three options,
  preserve first:
  - **Proceed and preserve (Recommended)** — re-run the same verb
    with `--preserve-comments`. Each thread is captured pre-write and
    the write applies. Every thread is then re-posted as an
    attributed unanchored comment: a prefix line naming the
    operation, a found-at locator for where the anchored text landed,
    the original text, replies re-threaded. The original is
    RESOLVED — never deleted — so its history survives the resolved
    view. Nothing is lost. After a preserve run, the report's
    `commentsPreserved` rows carry the restored comment ids and each
    locator verdict (found at / not found / ambiguous). Relay them to
    the user rather than just saying "done".
  - **Proceed and drop** — resolve each thread first
    (`gdocs comment --doc <id> --resolve <commentId>`), then re-run
    the verb. A deliberate, explicit drop: the thread survives only
    in the resolved view, with no restored copy.
  - **Abort** — leave the doc and the comments untouched; rework the
    edit to avoid the anchored text (the report names the exact
    spans).
- **Button/reply runtimes** (Discord-backed): the same brief posted
  as a message, the three options as buttons; a plain reply is the
  free-text channel.
- **Unattended runs** (an executor, a scheduled job): no picker
  exists to answer. A write that hits the anchor refusal STOPS and
  records what it is blocked on rather than deciding alone. Writes
  that touch no anchored text need no approval — the gate is the
  thread's destruction, not the write.

The ONE exception, on every runtime: a user who already directed the
shape in this conversation ("preserve any comments you hit") has made
the decision. Re-run with `--preserve-comments` and report what was
restored. Never work around the refusal with a raw API call, and
never pick silently on the user's behalf: preserve-vs-drop is their
call — that is the whole point of the seam.

## Scope note

Deferred, recorded surfaces — each is a gap that wants a goal, not a
local workaround:

- **Tabs**: a tabbed doc is read through its FIRST tab only; a tab
  selector is a recorded follow-up.
- **Drive scope**: both comment verbs ride the `drive.file` grant
  (docs this app created or opened). The broader-scope re-consent
  path exists but was deliberately not requested in v1 (EVA-126).
- **Anchored comment creation**: the Drive API cannot anchor a new
  comment to Doc content — a hole in the platform, not in this
  package; carry quoted text in the comment body.
- **Live eval smoke**: the gdocs eval suite runs against the offline
  simulator; a live-smoke leg waits on the Workspace-admin delegation
  grant (EVA-119 decision 2).
