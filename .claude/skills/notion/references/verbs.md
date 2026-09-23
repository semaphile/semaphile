# The `evie-kit notion` verbs

Five verbs. Argument parsing is strict per verb: boolean flags never
consume a value, `--flag=value` works everywhere, a value flag without a
value refuses, and an unknown flag refuses while naming the verb's real
flags. All validation runs BEFORE the client is built, so a usage error
never surfaces as a credential error.

Every verb takes `--repo <root>` — the repo whose layered settings
govern the invocation (default: cwd).

---

## `upsert <file.md>`

Push a markdown file to a Notion page or database row. Paragraph-correct
(one block per source paragraph) and surgical (minimal ops, never a page
rewrite).

| Flag                      | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `--page <id\|url>`        | Target page. Overrides frontmatter.                           |
| `--database <id\|url>`    | Target database; the file becomes/updates a row.              |
| `--title-property <name>` | The database's title property (default `Name`).               |
| `--dry-run`               | Plan and report the exact ops; write nothing.                 |
| `--no-stamp`              | Skip writing the sync stamp back into the file's frontmatter. |

Target resolution: `--page` / `--database`, else the file's
`notion_page` / `notion_database` frontmatter. Naming both in one layer
is refused.

**Row identity is database-bound.** A file that upserted into a database
carries the stamp's `row_page`; that row is verified to live in the
resolved database before any write, so a repointed `notion_database`
refuses loudly instead of silently writing the old row. A title query
matching several rows refuses rather than picking one.

**Stamps.** On success the file's frontmatter gains a `notion_sync:`
NAMED SECTION (EVA-158): `synced_at`, `page`, `sync_rev`,
`render_rev`, and (for rows) `row_page` — legacy flat `notion_*`
stamps are still read and migrate into the section on the next stamp
write. These are what `history` and `diff` classify against later.
`--no-stamp` opts out and costs you drift detection.

Refuses: a zero-block render against a non-empty page
(`NOTION_EMPTY_RENDER`); an op needing a block above the page's first
block (`NOTION_PREPEND_UNSUPPORTED`).

---

## `patch <selector>`

Edit only the blocks a selector addresses. Nothing outside the addressed
region (plus the insert anchor) is even referenced.

| Flag                   | Meaning                                       |
| ---------------------- | --------------------------------------------- |
| `--page <id\|url>`     | Required.                                     |
| `--replace`            | Replace the addressed region.                 |
| `--delete`             | Delete it. Takes no content.                  |
| `--insert-after`       | Insert content after the addressed region.    |
| `--insert-before`      | Insert content before it.                     |
| `--content <markdown>` | Inline content.                               |
| `--file <path>`        | Content from a file; frontmatter is stripped. |
| `--dry-run`            | Plan only.                                    |

Exactly one action flag is required. `--content` and `--file` are
mutually exclusive, required for every action except `--delete`, which
takes neither — `--delete --content …` is the typo shape of a meant
`--replace`, and silently ignoring the content would delete instead of
replace.

**Selector grammar** — `<axis>:<value>[#<ordinal>]`:

| Axis       | Addresses                                                               |
| ---------- | ----------------------------------------------------------------------- |
| `heading:` | The heading block whose text matches.                                   |
| `section:` | That heading plus every block under it, to the next same-or-higher one. |
| `text:`    | Any single block whose text matches.                                    |
| `block:`   | One block by its Notion id.                                             |

Values match exactly (trimmed); a leading `~` makes it a
case-insensitive substring (`heading:~risks`). `#n` is 1-based and picks
among multiple matches (`heading:Notes#2`). An unknown axis, a selector
matching nothing, and an ambiguous match without an ordinal are all
refusals that print the candidates or the grammar. Addressing the wrong
block is a silent corruption; a loud error is always cheaper.

---

## `history [file.md]`

The page's edit timeline: per-block created and last-edited times,
classified against the file's sync stamp when one exists.

| Flag                   | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| `--page <id\|url>`     | Explicit target; the only standalone one.          |
| `--database <id\|url>` | With `<file.md>`, resolve through that file's row. |

Takes at most one markdown file. `--page` stands alone; `--database`
needs the file, because a database is not a page body and the row's
identity comes from the file's row-page stamp. `--database`
without a file passes the flag check and then refuses at resolution
(`NOTION_TARGET_NOT_A_PAGE`), naming `--page` and the upsert that would
create the stamp.

Report fields:

| Field                      | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `syncedAt`                 | The stamp's timestamp (stamped runs only).                          |
| `remoteChangedSinceSync`   | The live tree's rev left the stamped `sync_rev`. **Authoritative.** |
| `blocksEditedSinceSync`    | How many blocks carry a post-sync edit timestamp.                   |
| `blocks[].editedSinceSync` | Per-block, timestamp-derived. Localizes; does not decide.           |

Block timestamps are minute-granular, so an edit inside the sync minute
can read false per-block while the rev comparison reads true. Trust the
rev.

---

## `diff <file.md>`

What an upsert would change (live page vs. local render), plus
local/remote/conflict classification since the file's stamp.

| Flag                   | Meaning                         |
| ---------------------- | ------------------------------- |
| `--page <id\|url>`     | Explicit target.                |
| `--database <id\|url>` | Resolve through a database row. |

Report fields:

| Field                    | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `inSync`                 | No ops, and no row-title drift.                                    |
| `ops` / `planned`        | Op counts, and each op with the live text it touches.              |
| `upsertWouldRefuse`      | An upsert of this exact plan would refuse.                         |
| `blockedByPrepend`       | …because it needs a block above the first one.                     |
| `blockedByEmptyRender`   | …because the file renders to zero blocks.                          |
| `title`                  | Database rows: the managed title property's local-vs-live drift.   |
| `containerRecreates`     | Container blocks the plan deletes and recreates (tables, toggles). |
| `localChangedSinceSync`  | The render left the stamped `render_rev`.                          |
| `remoteChangedSinceSync` | The live page left the stamped `sync_rev`.                         |
| `conflict`               | Both moved and did not converge.                                   |
| `degraded`               | No page-bound stamp; two-way report only.                          |

A clean-looking plan must never green-light a refusal or an undisclosed
title rename, which is why the advisories are part of the report rather
than something you find out by running the write.

---

## `comment`

Post a comment on a page, or reply into an existing discussion thread.
Comments are never page content — nothing in this verb touches blocks or
synced markdown.

| Flag                | Meaning                                    |
| ------------------- | ------------------------------------------ |
| `--page <id\|url>`  | Page-anchored comment.                     |
| `--discussion <id>` | Reply into that thread.                    |
| `--content <text>`  | Inline text.                               |
| `--file <path>`     | Text from a file; frontmatter is stripped. |
| `--dry-run`         | Render and report; post nothing.           |

Exactly one target, and exactly one of `--content` / `--file`. The verb
takes no positional arguments, so `notion comment <page> "text"` refuses
and names the flag it wanted.

Text is unwrapped (EVA-66) and split at Notion's 2000-character segment
cap on the way out. Empty text refuses (`NOTION_COMMENT_EMPTY`); text
past the 100-element `rich_text` cap refuses (`NOTION_COMMENT_TOO_LONG`).

**Comment text posts as PLAIN text.** Unlike the block path, inline
markdown is not converted to annotations here: `**bold**` and
`` `backticks` `` arrive as those literal characters. Write comments in
prose, and if you must reference a path, plain quoting reads better than
backticks. The `--dry-run` rehearsal shows exactly this, characters
included — one more reason to read it rather than skim it.

`--dry-run` is the human-approval step of the etiquette flow, not a
convenience: rehearsal and post share one renderer, so the text printed
for approval is byte-for-byte the text that posts.

Report: the resolved target, the exact text, its character and segment
counts, and either `dryRun: true` or the posted `commentId` and
`discussionId`.

---

## Synonyms

One canonical verb per intent. These spellings exist only to sharpen the
did-you-mean, the same teaching pattern the goals CLI uses:

| You typed                          | It means  |
| ---------------------------------- | --------- |
| `push`, `sync`, `publish`, `write` | `upsert`  |
| `edit`, `update`                   | `patch`   |
| `log`, `timeline`                  | `history` |
| `status`, `compare`, `changes`     | `diff`    |
| `reply`, `note`                    | `comment` |
