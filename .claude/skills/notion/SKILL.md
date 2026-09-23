---
name: notion
description: >-
  Structured Notion work through @evie-kit/notion — push local markdown
  to a page or database row, edit addressed blocks surgically, read a
  page's edit timeline, classify local-vs-remote drift since the last
  sync, and post explanatory comments. Use when writing to Notion from a
  repo, maintaining a Notion mirror of local files, triaging "did someone
  edit the page?", resolving a local-vs-Notion conflict, or wiring a sync
  onto the package's engine primitives. Also use before hand-rolling any
  Notion API call — most of what a raw call would do already exists here,
  with the refusals that keep it from corrupting a page.
argument-hint: "[what you want to do with Notion]"
---

# Notion

`evie-kit notion <verb>` wraps `@evie-kit/notion`. Five verbs for the
common work; the package's exported primitives for anything a verb does
not cover.

Zero-ambiguity invocation when the bin might not be linked:
`bun node_modules/@evie-kit/cli/src/evie-kit.ts notion <verb> …`

**Toolchain guard (EVA-81)**: module-not-found on that path means the
machine's bootstrap has not run — not a broken repo. Run it once BY
PATH: `bun /path/to/evie-kit/packages/cli/src/evie-kit.ts onboard`
(`EVIE-KIT.md` at the project root has the full bootstrap).

**Credentials** resolve through the project's layered settings:
`tools.notion.token`, then `NOTION_API_KEY`, then the credential file.
Two refusals come BEFORE any fallback — `tools.notion.enabled: false`
(the project's off-switch) and a settings knockout (a declared token
whose `${VAR}` did not resolve). Neither falls through to ambient
credentials, because that is how a write lands in the wrong workspace.

**Comment capabilities are a separate grant** — a valid token with full
content access can still 403 on every comment call. Notion integrations
carry **Read comments** and **Insert comments** capabilities that are
BOTH OFF by default: triage (`getComments`, shallow or deep) needs the
first, `createComment` / the `comment` verb needs the second, and the
page tree must be shared with the integration either way. A 403 on a
comment call while `upsert` works is this, not a bad token — enable the
capabilities on the integration's settings page and re-run.

## The rule that matters most: nothing here rewrites a page

Every write verb computes the MINIMAL set of block operations and
applies only those. Blocks nobody touched keep their ids, their
comments, and their history. This is not an optimization — a page that
gets deleted and recreated loses every comment thread anchored to it,
and on a mirror of any size that is unrecoverable.

So: never reach for the raw API to "just replace the body." If a verb
refuses, the refusal is telling you something true about the page (see
Refusals, below).

## The action surface

### Verbs

| Verb                | What it answers                                                                        |
| ------------------- | -------------------------------------------------------------------------------------- |
| `upsert <file.md>`  | Put this local markdown on that page / database row, surgically.                       |
| `patch <selector>`  | Change only the blocks this selector addresses.                                        |
| `history [file.md]` | When was each block last edited, and which moved since my last sync?                   |
| `diff <file.md>`    | What would an upsert change, and did local, remote, or both move since the sync stamp? |
| `comment`           | Post an explanation on a page, or reply in a discussion thread.                        |

Every verb takes `--repo <root>` to pick the repo whose settings govern
it (default: cwd). Every write verb takes `--dry-run`, which plans and
reports without touching Notion. Full flags, report shapes, and the
synonyms the CLI teaches from: `references/verbs.md`.

### Library primitives

Import from `@evie-kit/notion` when a verb is the wrong shape — a
long-running sync, a custom conflict policy, a mirror over documents
that are not markdown files on disk.

| Primitive                                              | Use                                                      |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `createNotionClient({ apiKey })`                       | The raw client: pages, blocks, comments, db schema.      |
| `markdownToBlocks(md)`                                 | Markdown → Notion blocks, paragraph-correct.             |
| `diffBlocks(before, after)`                            | Mechanical block-level diff. No judgment, pure data.     |
| `applyOps(blocks, ops)` / `client.applyBlockOps(…)`    | Execute a diff, in memory or against Notion.             |
| `NotionSyncEngine`                                     | push / pull / status / merge / diffBody over a store.    |
| `threeWayMerge` + `DEFAULT_DOMINANCE` + `dominanceFor` | Who wins when both sides changed a field.                |
| `diffStatus(local, remote, base, dominance, pageId)`   | Non-mutating classification: local, remote, or conflict. |
| `fetchComments` / `createComment`                      | Read and write comments. Never page content.             |

Signatures, the engine's record-shape constraint, and wiring examples
that compile: `references/library.md` (the examples are real
typechecked files under `examples/`).

## Composition rules

Markdown does not become Notion blocks for free. These rules are
enforced in code; knowing them is how you avoid writing content that
400s or renders wrong.

- **Prose is unwrapped** (EVA-66). Repo markdown is hard-wrapped at ~72
  columns; Notion renders those newlines as visible breaks.
  `markdownToBlocks` unwraps internally, so ONE source paragraph
  becomes ONE block. Compose prose sent through other paths unwrapped
  too, and never paste hard-wrapped file content into an MCP call.
- **2000 characters per `rich_text` segment**, and **100 elements per
  `rich_text` array** (EVA-101). Long text is split; adjacent segments
  with identical annotations are coalesced so heavily-formatted blocks
  stay under the element cap.
- **100 children per append request.** Handled by batching
  (`NOTION_CHILDREN_LIMIT`).

More, including what survives a round trip: `references/composition.md`.
What does not round-trip at all: Recorded limits, next.

## Recorded limits (what does not round-trip)

Stated, not glossed — the holes and losses to know before promising a
faithful mirror (`references/composition.md` for the mechanics behind
each):

- **Notion cannot prepend.** Blocks are only ever appended after an
  anchor, so inserting at the very top of a page is impossible through
  the API (`NOTION_PREPEND_UNSUPPORTED` names the recovery: keep the
  first block stable, or patch content in after it). This is a
  documented hole, not a bug to route around.
- **Container blocks compare atomically.** Tables and toggles diff as
  whole units: they are never patched in place — a changed container
  is deleted and recreated wholesale — and their children are
  invisible to the sync revs, so a table-bearing document can show
  pending ops while both since-sync flags read false. `diff` reports
  this as `containerRecreates` so the count explains itself: a nonzero
  count with both flags false is the container quirk, not evidence
  that a human edited the page.
- **Block timestamps are minute-granular** (verified live). An edit
  landing inside the sync minute reads as unedited per-block while the
  rev comparison correctly reports a change. Revs decide; timestamps
  localize.
- **Resolved comments are unretrievable.** The public API returns
  unresolved comments only, with no option to ask otherwise. What the
  API cannot return, you do not have (the Comments section below
  carries the honesty rule in full).
- **New inline block-anchored discussions cannot be created.**
  Page-anchored comments and replies into existing discussions are the
  whole public creation surface.
- **Over-cap blocks split into visible siblings.** The 100-element cap
  is handled by sibling-splitting, and the split is visible. A split
  numbered item renders an extra ordinal, and a pull-direction round
  trip reads the siblings back as separate blocks — strictly better
  than the API 400 it replaces.
- **Images are external-only, standalone-only** (EVA-158): a line
  that is exactly `![alt](url)` becomes an external image block (alt
  → caption, round-tripping with the pull direction). The URL must be
  public http(s) that OUTLIVES the page — an expiring SIGNED URL or a
  non-http(s) one refuses (`NOTION_MARKDOWN_IMAGE_URL`). Caption
  edits patch in place; a SOURCE change recreates the block (the API
  cannot update a media source). An image inside a prose line stays
  literal text (Notion has no inline images), and the
  upload/hosted-file path is out of scope
  (`references/composition.md` carries the full limits).
- **Unknown markdown passes through as paragraph text.** The
  converter's table (`references/composition.md`) is deliberately
  small; anything outside it becomes a paragraph rather than silently
  becoming a block type nobody asked for.

## Targets, stamps, and selectors

- **Targets** come from `--page` / `--database`, or from the file's own
  `notion_page` / `notion_database` frontmatter. A layer naming both is
  refused.
- **Sync stamps** are what make drift detection work across processes.
  A successful `upsert` writes a `notion_sync:` NAMED SECTION back
  into the file's frontmatter (EVA-158): `synced_at`, `page`,
  `sync_rev`, `render_rev`, and `row_page` for database rows. One
  file can carry notion and gdocs stamps side by side, each tool
  owning its own section. Legacy flat `notion_*` stamps are still
  read, and they migrate into the section on the next stamp write.
  A stamp write also unifies line endings: any CRLF in the file
  re-emits the whole file CRLF (recorded limit).
  `history` and `diff` classify against them. A missing, partial, or
  wrong-page stamp degrades to a two-way report — never an error, and
  never a misattribution.
- **Selectors** address blocks for `patch`:
  `<axis>:<value>[#<ordinal>]` over the axes `heading`, `section`,
  `text`, `block`. A leading `~` makes the match a case-insensitive
  substring. Every ambiguity is a refusal listing the candidates,
  because addressing the wrong block is a silent corruption.

## Comments are never page content

Comments are a parallel API resource, and this package quarantines them
from every render and sync path — enforced by a test that walks the
import graph, not by convention. Comment text must never enter synced
markdown: a mirror that folded a comment into the body would push it
back to Notion as body text on the next sync, laundering someone's
margin note into the document permanently.

Both directions are available and both stay outside the body:

- **Read (shallow)** — `client.getComments({ pageId })` returns
  unresolved comments, paginated. It answers only for comments anchored
  to the PAGE itself.
- **Read (deep)** — `client.getComments({ pageId }, { deep: true })`
  (EVA-104) also sweeps the page's block subtree, so
  paragraph-anchored comments come back too, each carrying
  `parentBlockId`. **This is the one triage needs.** Commenting on a
  specific paragraph is the natural way to comment, and those comments
  are invisible to the shallow read — a page covered in feedback
  answers "no comments" without it. Deep mode returns a
  `DeepCommentsResult` (`comments`, plus `truncated` / `boundaries` /
  `failed`) rather than a bare array, because a bounded walk has
  caveats an array cannot carry: check them before concluding a page is
  quiet.
- Both read modes are unresolved-only, with no option to ask
  otherwise — the public REST API cannot retrieve resolved comments.
  When someone asks for resolved threads or a "complete" comment
  history, say exactly that. What the API cannot return, you do not
  have: never reconstruct it from caches, exports, page history, or
  recollection and present the result as part of the comment record.
- **Write** — `evie-kit notion comment` (or `client.createComment`)
  posts page-anchored, or replies into an existing discussion. Those
  are the only two shapes Notion's public API creates; new inline
  block-anchored discussions cannot be created through it at all.

**The etiquette rule.** When a write of yours overwrites something a
human wrote, say so where they will see it. Draft the comment, rehearse
it with `--dry-run`, get a human to approve the exact text, then post.
Rehearsal and post share one renderer, so what you show for approval is
byte-for-byte what lands. A silent overwrite is the failure mode this
exists to prevent.

The gate is the OVERWRITE, not the comment. A comment — or an edit —
the user explicitly asked for, exact text in hand, carries its
approval in the ask: run it (a `--dry-run` rehearsal first is fine;
stalling the directed change behind a second "shall I proceed?" loop
is not). The rehearse-then-approve flow is for writes the affected
human has not seen yet — an overwrite you initiated yourself, or
replacement text the requester never actually confirmed.

## Refusals you will meet

Each of these is a guard that fired, and each names its recovery. Do
not work around them; read what they are telling you. And cite them
only when they actually fired: this table is documentation, not
evidence. A documented limit is stated on the skill's authority ("the
API cannot prepend — this is documented"), never dressed up as a live
refusal you observed — reporting one of these codes as the outcome of
a probe you never ran is fabrication, even when the limit is real.

| Refusal                      | Means                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_EMPTY_RENDER`        | The file rendered to zero blocks against a non-empty page. A truncated or frontmatter-only file is the usual cause.       |
| `NOTION_PREPEND_UNSUPPORTED` | The change needs a block above the current first block. Keep the first block stable, or patch content in after it first.  |
| `NOTION_ROW_PAGE_FOREIGN`    | The file's stamped row lives in a different database than the one it now names. Repointed `notion_database`, stale stamp. |
| `NOTION_ID_UNPARSEABLE`      | Not a page URL, dashed uuid, or 32-hex id.                                                                                |
| `NOTION_TARGET_NOT_A_PAGE`   | `history`/`diff` read a page body; the target resolved to a database. Upsert first, or pass `--page`.                     |
| `NOTION_COMMENT_EMPTY`       | An empty comment draft. Never an intentional post.                                                                        |
| `NOTION_COMMENT_TOO_LONG`    | Past the 100-element cap. Comment the summary; put the detail where detail belongs.                                       |

## Use cases (progressive disclosure)

Read the reference for the job you are doing, not all of them.

- **`references/mirror.md` — maintaining a mirror.** The flagship case:
  a repo folder mirrored to Notion pages, humans reading and sometimes
  editing on the Notion side. Covers status with second-stage
  verification (telling a metadata bump apart from a real edit),
  mechanical triage of a remote change, dominance-aware healing, and
  the etiquette step. Read this one before building any recurring sync.
  A direct `upsert` of any path is in-policy — `.notionignore` governs
  which files the recurring MIRROR sweeps, never what a one-off upsert
  may target.
- **`references/verbs.md` — the CLI reference.** Every flag, every
  report field, and what each verb refuses.
- **`references/library.md` — wiring the primitives.** The engine's
  five commands, its record-shape constraint, and what to use when the
  engine does not fit. Examples under `examples/` are typechecked.
- **`references/composition.md` — markdown, blocks, and limits.** What
  converts, what survives a round trip, and every hard API limit in one
  place.

## Per-runtime delivery

The invariant on every runtime: **a write that overwrites human content
is confirmed by a human before it happens, and explained where they can
see it.** How the confirmation is collected differs.

- **Claude Code**: `--dry-run` first, then an `AskUserQuestion` picker
  carrying the exact drafted comment text and the pages affected —
  _Post and heal / Edit the wording / Skip this page_. The rehearsed
  output goes in the prose before the picker, never squeezed into an
  option description.
- **Button/reply runtimes** (Discord-backed): the same rehearsal posted
  as a message, approval as a button; a plain reply is the free-text
  channel for rewording.
- **Unattended runs** (an executor, a scheduled job): no picker exists
  to answer, so a heal that would overwrite human content STOPS and
  records what it is blocked on rather than deciding alone. Healing
  pages nobody touched needs no approval — the gate is the overwrite,
  not the sync.

## Scope note

The mirror-adoption surface — wiring `NotionSyncEngine` to arbitrary
document types, and the `status --verify` / `triage` / `heal` verbs that
would ride it — is a deferred follow-up (EVA-106 decision 2/4). Until it
lands, `references/mirror.md` documents the mirror as a composition of
primitives that exist today. If you find yourself needing a
mirror-config shape to proceed, that is the gap, and it wants a goal
rather than a local workaround.
