# Markdown, blocks, and the limits

What `markdownToBlocks` converts, what it deliberately does not, and
every hard limit the Notion API imposes — in one place, so you find out
before a write 400s rather than after.

## What converts

| Markdown                            | Notion block                                  |
| ----------------------------------- | --------------------------------------------- |
| `#` / `##` / `###`                  | `heading_1` / `heading_2` / `heading_3`       |
| Paragraph                           | `paragraph` (one per SOURCE paragraph)        |
| `-` / `*` list                      | `bulleted_list_item`                          |
| `1.` list                           | `numbered_list_item`                          |
| `>` lines                           | one `quote`, lines joined by soft breaks      |
| ` ``` ` fenced code                 | `code`, body left literal, language preserved |
| `---`                               | `divider`                                     |
| Pipe table (header + separator row) | `table` with `has_column_header`              |
| `![alt](url)` on its own line       | `image` (external; alt becomes the caption)   |

Inline `**bold**`, `*italic*`, `` `code` `` and `[links](url)` become
Notion annotations on every text-bearing block. Code fence bodies are
left literal — no inline parsing inside them.

Images (EVA-158) are EXTERNAL-only, and standalone-only. A line that
is exactly `![alt](url)` becomes an external image block whose caption
is the alt text (the pull direction renders `![caption](url)`, so the
pair round-trips). The URL must be absolute public http(s) and must
OUTLIVE the page. An expiring SIGNED URL — Notion's own S3 file links
included — refuses outright, because it dies in place within the
hour; host the file somewhere durable. Anything else
standalone-image-shaped refuses too (`NOTION_MARKDOWN_IMAGE_URL`);
an image INSIDE a prose line stays literal text — Notion has no
inline images (recorded domain limit). A caption-only edit patches in
place (the block id survives). A SOURCE change RECREATES the block —
the API cannot update a media source — so comments anchored to the
image do not survive a URL swap. The recreate appends the new image
after the old one, then deletes the old — first-block swaps included
(that anchoring is never a prepend). A
FILE-hosted (UI-uploaded) image digests as an opaque source, so its
content changes are invisible to `diff` and the sync-stamp revs. The
upload/hosted-file path is deliberately out of scope.

The scope is deliberately small: these are the block types this repo's
output actually emits. Anything else passes through as paragraph text
rather than silently becoming a block type nobody asked for. If you need
a block type that is not here, build it as a `NotionBlock` literal and
append it; do not stretch the converter.

**This path has a live consumer**, which is why "these are the block
types this repo actually emits" is a statement about production and not
a guess: `@evie-kit/research` publishes every research draft to Notion
through `NotionSyncEngine`, and therefore through this converter. Two
practical consequences. Changing `markdownToBlocks` or the rich-text
segmenter changes what that pipeline publishes, so treat them as shared
surface rather than local helpers. And the converter's coverage tracks
what research drafts contain — if you are publishing documents of a
different shape, check the table above before assuming a block type
survives the trip.

## The unwrap rule (EVA-66)

Repo markdown is hard-wrapped at ~72 columns. Notion renders every
intra-paragraph newline as a visible line break, so hard-wrapped source
posted verbatim arrives as a ragged column.

`markdownToBlocks` calls `unwrapProse` internally, so **one source
paragraph becomes one block** with the newlines joined. Structure that
carries meaning survives: code fences keep every line, list items stay
separate, blockquote lines stay soft-broken inside one quote.

The rule generalizes past this converter. Any prose you send to an
external renderer — an MCP call, a Linear comment, a Notion comment —
goes unwrapped. `evie-kit notion comment` applies the same pass on the
way out, which is why a comment composed from a wrapped file posts as
prose rather than as a column.

## The hard limits

| Limit                              | Value | Handled by                                                                      |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------- |
| Characters per `rich_text` segment | 2000  | Automatic splitting.                                                            |
| Elements per `rich_text` array     | 100   | Coalescing adjacent same-annotation segments, then sibling-splitting the block. |
| `children` per create/append call  | 100   | Batched (`NOTION_CHILDREN_LIMIT`).                                              |
| Requests per second                | 3     | The shared Bottleneck limiter on every call.                                    |

Two accepted consequences of the element-cap sibling split, worth
knowing because they are visible in output: a split `numbered_list_item`
renders an extra ordinal (shifting later numbers), and a pull-direction
round trip reads the siblings back as separate blocks. Both are strictly
better than the API 400 they replace.

Adjacent-segment coalescing runs on every conversion, not only on
over-cap blocks. Rendering is identical and element counts drop; the
one-time cost was a re-sync churn on already-mirrored content, accepted
deliberately.

## What the API cannot do

- **Prepend.** Blocks are only ever appended after an anchor. Inserting
  above the current first block is impossible, so a write needing it
  refuses (`NOTION_PREPEND_UNSUPPORTED`) and names the recovery: patch
  the new content in after the current first block, then re-run. A
  document with a stable first block (a title heading) never meets this.
- **Create new inline block-anchored discussions.** Comments can be
  created page-anchored, or as replies into an existing discussion.
  That is the whole public surface.

## Comparison quirks that surprise people

- **Container blocks compare atomically.** Tables and toggles diff as
  whole units; their children are invisible to the sync revs. A
  table-bearing document can therefore show pending ops while both
  since-sync flags read false. `diff` reports `containerRecreates` so
  the count explains itself instead of looking like a bug.
- **Block timestamps are minute-granular** (verified live). An edit
  landing inside the sync minute reads as unedited per-block while the
  rev comparison correctly reports a change. Revs decide; timestamps
  localize.
- **Converged edits are not a conflict.** If both sides independently
  reached the same content, there is nothing to resolve, and `diff` says
  so rather than reporting a conflict you would then have to dismiss.

## Refusals, and why each exists

| Refusal                      | Cause                                       | Why it is loud                                                                                               |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NOTION_EMPTY_RENDER`        | Zero-block render against a non-empty page. | The diff would be all deletes; a truncated file is the usual cause.                                          |
| `NOTION_PREPEND_UNSUPPORTED` | An op needs a block above the first one.    | Silently reordering to fit would corrupt the document.                                                       |
| `NOTION_ROW_PAGE_FOREIGN`    | Stamped row lives in a different database.  | Writing the old row while reporting the new database is invisible.                                           |
| `NOTION_TARGET_NOT_A_PAGE`   | A page-body verb resolved to a database.    | A database is not a body.                                                                                    |
| `NOTION_ID_UNPARSEABLE`      | Not a URL, dashed uuid, or 32-hex id.       | Guessing an id addresses someone else's page.                                                                |
| `NOTION_COMMENT_EMPTY`       | Empty or whitespace-only comment draft.     | A blank comment says nothing and cannot be edited into saying something.                                     |
| `NOTION_COMMENT_TOO_LONG`    | Past the 100-element cap.                   | The API would 400 after the human already approved the text.                                                 |
| `NOTION_MARKDOWN_IMAGE_URL`  | A standalone image with a non-http(s) URL.  | The author clearly wanted an image; silently degrading it to prose text recreates the two-sync-system split. |

Selector failures (unknown axis, no match, ambiguous match with no
ordinal) are refusals too, and each prints the candidates or the
grammar. Addressing the wrong block is a silent page corruption; a loud
error is always the cheaper outcome.
