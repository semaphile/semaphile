# Wiring the primitives

Reach for the library when a verb is the wrong shape: a long-running
process that keeps its own sync state, a mirror over documents that are
not markdown files on disk, or a conflict policy the CLI does not
express.

Everything below is exported from `@evie-kit/notion` (the root entry)
unless noted.

## The client

```ts
import { createNotionClient } from "@evie-kit/notion";

const client = createNotionClient({ apiKey }); // …but read the next paragraph
```

**Where that key comes from is the whole question.** This package is a
dependency LEAF: it cannot read the layered `.evie-kit` settings, so it
takes a key rather than resolving one. The resolution lives in the
composition root (`packages/cli/src/notion.ts`), which implements the
project chain — `tools.notion.token`, then `NOTION_API_KEY`, then the
credential file — behind two refusals that fire BEFORE any fallback:
`tools.notion.enabled: false`, and a settings knockout whose `${VAR}` did
not resolve. That root is wiring, not an exported helper.

So, in order of preference:

1. **Drive the CLI verbs** (`evie-kit notion …`). They already run the
   chain and its refusals; this is the supported path for anything inside
   a project.
2. **Construct a client directly** only where no project settings govern
   the call — a one-off script against a workspace you named yourself.
   Reading `NOTION_API_KEY` and calling it a day inside a configured
   project skips the refusals, and a knockout falling through to an
   ambient credential is exactly how a write lands in the wrong
   workspace.

The client surface:

| Method                                        | Does                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| `upsert(artifact, opts)`                      | Deliver an artifact to a database, idempotent on a key.  |
| `getPage(pageId)`                             | The page's mapped domain shape (title, url, timestamps). |
| `listBlocks(pageId)`                          | Every top-level child block, paginated, with ids.        |
| `appendBlocks(pageId, blocks)`                | Append to the end, in 100-block batches.                 |
| `applyBlockOps(pageId, existing, ops)`        | Execute a `DiffOp[]` surgically.                         |
| `getComments(target)`                         | Unresolved comments anchored to a page or block.         |
| `getComments(target, { deep: true })`         | …plus the whole block subtree's; `DeepCommentsResult`.   |
| `createComment(target, text)`                 | Page-anchored comment, or a discussion reply.            |
| `getDatabaseSchema(dbId)`                     | The live `properties` map.                               |
| `setSelectOptions(dbId, prop, options, kind)` | Replace a select/multi-select's FULL option list.        |
| `queryPages(dbId, filter)`                    | Every matching row, paginated.                           |
| `updatePageProperties(pageId, properties)`    | Patch properties, leaving the body untouched.            |

`setSelectOptions` is a destructive overwrite of that one property's
options — pass the complete desired array (existing ∪ additions), never
just the additions.

## Blocks and diffs

```ts
import { applyOps, diffBlocks, markdownToBlocks } from "@evie-kit/notion";

const desired = markdownToBlocks(localMarkdown); // unwrapped, segmented
const live = await client.listBlocks(pageId);
const ops = diffBlocks(live, desired); // minimal ops, pure data
await client.applyBlockOps(pageId, live, ops); // …or applyOps(live, ops) in memory
```

`diffBlocks(before, after)` needs real ids on `before` (they come from a
Notion read) and none on `after`. It emits `update`, `delete`, `append`
and `move` ops. It makes no decisions and calls no model — the judgment
about what a change MEANS belongs to the caller.

**Two things that recipe leaves to you, and both bite in production:**

- **Preflight before you write.** A plan containing a null-anchored
  `append`/`move` against a non-empty page cannot execute (Notion has no
  prepend), and `applyBlockOps` finds out only when it reaches that op —
  after earlier deletes have landed. Scan for null anchors first and
  refuse the whole plan. The CLI verbs do this for you; a raw caller
  must do it themselves.
- **The ops are only valid against the tree you diffed.** They address
  blocks by id, so re-reading the page and applying an older plan
  silently overwrites anything that changed in between. Compare the
  current tree against the one you planned from, and re-plan on drift.

`examples/mirror-heal.ts` carries both as `preflightOps` and
`expectedTreeRev`.

`applyOps` runs the same op vocabulary against an in-memory block list,
which is what makes a dry run meaningful: plan, apply locally, inspect
the result, then commit.

## The sync engine

`NotionSyncEngine` wraps a store with five explicit, agent-invoked
commands — never automatic, never background:

| Command                      | Does                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `push(record, sections)`     | local → Notion; stamps a base snapshot + provenance.    |
| `pull(id)`                   | Notion → local; the authoritative remote record.        |
| `status(record, dominance?)` | Non-mutating classification against the base.           |
| `merge(id, local, opts?)`    | Three-way merge resolved by per-field dominance.        |
| `diffBody(id)`               | Block-level diff of the page against the captured base. |

**Two constraints to know before you build on it.**

1. **The record type is `ResearchRecord`.** The engine is
   format-agnostic in structure but typed on the research pipeline's
   record shape, and it is wired only to research records today. Making
   it carry arbitrary document types is the deferred mirror-adoption
   surface (EVA-106 decision 2) — not a small local cast.
2. **Bases are in-memory, per instance.** A CLI invocation is a fresh
   process, so the engine cannot be the durable base for
   command-line work; the frontmatter sync stamp is. Use the engine in
   long-running consumers that hold their own state, or persist the
   base yourself.

`diffBody` additionally needs a `BodyBlockSource` injected at
construction (`new NotionSyncEngine(store, { blocks })`) and a prior
push/pull to have captured a base; without either it throws saying which
one is missing.

## Dominance

```ts
import {
  DEFAULT_DOMINANCE,
  DEFAULT_FIELD_DOMINANCE,
  dominanceFor,
  threeWayMerge,
} from "@evie-kit/notion";
```

- `"local"` — agent-owned execution fact; local wins, remote edits are
  refused and corrected on the next push.
- `"notion"` — human-overridable; Notion wins a two-sided change.
- `"merge"` — set union; neither side deletes the other's entries.

Unlisted fields fall back to `DEFAULT_FIELD_DOMINANCE`, which is
`"notion"`: **a human edit to a field the agent does not claim is
intentional.** Claim what you are willing to overwrite, explicitly.

`threeWayMerge(base, local, remote, dominance)` returns the merged
record plus `conflicts` and `autoResolved`. `diffStatus(local, remote,
base, dominance, pageId)` is its read-only sibling — same detection,
reports the side a change came from instead of resolving it. Both cover
typed METADATA fields; page BODY is `diffBlocks` territory.

## Comments

```ts
import {
  createComment,
  fetchComments,
  renderCommentRichText,
} from "@evie-kit/notion";
```

Prefer the client methods (`client.getComments`, `client.createComment`)
— the standalone functions take the caller's own request closure and
exist for wiring a different transport. `renderCommentRichText(text)` is
the renderer both use: it unwraps, segments at 2000 characters, and
throws on an empty draft or one past the 100-element cap. Call it early
to validate a draft before a human reads it.

These are quarantined from every render and sync path by a test that
walks the import graph. Keep them that way: comment text must never
enter synced markdown.

## Worked examples

Two files beside this reference, typechecked by this package's
`typecheck` script and exercised by
`packages/notion/src/skillExamples.test.ts`:

- **`examples/mirror-status.ts`** — `verifyMirrorStatus` (the two-stage
  gate that tells a metadata bump from a content edit) and
  `triageMirrorPage` (that, plus the comment sweep).
- **`examples/mirror-heal.ts`** — `disposition`, `preflightOps`,
  `planHeal`, `draftHealComment`, `applyHeal`: dominance-aware healing
  where the overwrite-a-human branch takes the approved comment text as
  a required argument, so "a human approved this" cannot be asserted
  without something a human actually read. Classification is
  fail-closed (an unclassified, added or emptied block needs approval),
  and both the staleness re-check and the prepend preflight run before
  anything is written.

Read them as the starting point for a mirror, not as a library to import
from — they live in the skill so they travel with it.

## Other entry points

| Entry                             | What it is                                                     |
| --------------------------------- | -------------------------------------------------------------- |
| `@evie-kit/notion/basic-memory` | One-way Notion → local tree sync (the Notion-dominant mirror). |
| `@evie-kit/notion/markdown`     | `markdownToBlocks` and the block types on their own.           |
| `@evie-kit/notion/carrier`      | `NotionCarrier` — the delivery-carrier shape.                  |
| `@evie-kit/notion/cli`          | `createNotionCli(deps)`, for a different composition root.     |

If Notion is where the writing actually happens, `basic-memory` is the
right mirror, not the local-dominant flow in `references/mirror.md`.
