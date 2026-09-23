# `evie-kit gdocs` verb reference

Every verb takes `--repo <root>` to pick the repo whose settings govern
it (default cwd). Flags are strict: booleans never consume values,
value flags require one, unknown flags refuse naming the verb's flags.
This file's flags are linted against the CLI's own
`GDOCS_VERB_FLAGS` schema — a flag documented here but absent there is
a test failure.

## report

```
evie-kit gdocs report --doc <id|url>
```

The doc's block outline: per block its id (`evb:` named range or
`pos:` positional surrogate), type, clipped text, and character start
index — uniform tables also carry their `rows`/`columns` (what a
`cell:` selector aims at, EVA-131) — plus the stale-range count. Read
it before aiming a patch selector; `block:<id>` addresses exactly one
row of this output.

## patch

```
evie-kit gdocs patch "<selector>" --doc <id|url> \
  (--replace | --delete | --insert-after | --insert-before) \
  [--content <markdown> | --file <path>] [--dry-run] [--no-verify] \
  [--preserve-comments]
```

Selector grammar: `<axis>:<value>[#<ordinal>]` — axes `heading:`,
`section:` (heading + everything under it), `text:`, `block:`,
`cell:`; a leading `~` makes the value a case-insensitive substring
match; `#n` picks among multiple matches (1-based). Exactly one action
flag. `--delete` takes no content. The compiled batch is atomic and
revision-guarded — EXCEPT table content, which adds a second
revision-guarded fill batch (recoverable, not all-or-none). NEVER
replay a failed table patch: its phase one applied ALL of its content,
paragraphs included, so a replay duplicates it — the failure text
prescribes the safe recovery. `--dry-run` reports the planned ops and
request count without writing.

**Cell addressing (EVA-131).** `cell:` addresses ONE cell of a uniform
table, in two forms: `cell:Fees[Amount]` — row by its FIRST-column
text, column by its header-row text (`~` per key for substring,
position-proof under row inserts) — and `cell:2,3` — 1-based
coordinates counting the header row, for headerless tables. `#n`
disambiguates across every matching cell in doc order; each form's
refusal cross-suggests the other. Cell targets take `--replace`
(content must render to one plain single-line paragraph — inline
bold/italic/code/links fine) or `--delete` (empties the cell); the
insert actions refuse (`GDOCS_CELL_ACTION`). The edit lands as an
in-place cell rewrite: other cells, the table's structure, and its
`evb:` identity are untouched.

**Post-apply verification (EVA-131), default ON.** An applied patch
refetches the doc and asserts the exact block sequence the ops
promised (new content present, old content gone, structure intact) in
the same invocation; a divergence throws `GDOCS_VERIFY_FAILED`,
stating that the write itself already applied. `--no-verify` is the
visible opt-out for bulk callers (reported as `verifySkipped`).

**In-place realizations (EVA-131/134).** A text-only edit whose
styling is unchanged compiles to a delete+insert of ONLY the changed
window. Formatting elsewhere in the paragraph survives — including
styling markdown cannot express — and so do comment anchors outside
the window. A styling or type change still rewrites the whole block.
A table diff with FROZEN structure (same rows × columns) rewrites
only its changed cells. A ONE-AXIS dimension change realizes as
row/column operations plus rewrites of only the changed kept cells,
so untouched cells' comment anchors survive natively (EVA-134;
reported as `restructuredTables`). A BOTH-axes change — or one where
no line of the old table survives — takes the atomic replace as
before.

## sync

```
evie-kit gdocs sync <file.md> [--doc <id|url>] [--create] [--title <t>]
  [--dry-run] [--no-stamp] [--preserve-comments]
  [--image-max-width-pt <n|none>] [--image-max-height-pt <n|none>]
```

Whole-file push as a minimal diff. Target: `--doc`, else the file's
`gdoc_id` frontmatter stamp; neither plus `--create` makes a fresh doc
(title from `--title`, else the first `# H1`, else the basename).
A `--create` run VERIFIES itself (EVA-158): after the write it
re-reads, re-diffs, and heals anything the create emission left that
the source never had. The report's `converge` is the receipt — `ops:
0` is a clean create — and the old "always re-sync after `--create`"
ritual is the tool's job now.
After a write it stamps the flat `gdoc_id` target plus a `gdocs_sync:`
NAMED SECTION (`doc_id`, `revision`, `render_rev`, `synced_at`) into
the file's frontmatter (`--no-stamp` skips). One file can carry gdocs
and notion stamps side by side (EVA-158), each tool owning its own
section. Legacy flat `gdoc_*` stamps are still read and are migrated
into the section on the next stamp write.
Tables and `---` section breaks sync since EVA-123. The table diff
picks its shape (EVA-131/134). Frozen dimensions rewrite only the
changed cells in place. A ONE-AXIS dimension change realizes as
row/column operations plus cell rewrites, keeping surviving anchors
(reported as `restructuredTables`). Only a BOTH-axes change — or one
where no line of the old table survives — replaces the table
atomically (structure batch plus fill batch; the report's `tables`
count is the fills). Standalone `![alt](url)` images
sync since EVA-126 (held in place by source URI; alt is dropped;
public http(s) only). Inserted images are SIZED since EVA-158: a
`![alt](url =440x)` width hint (points) applies verbatim, and unhinted
images are probed and capped to `--image-max-width-pt` /
`--image-max-height-pt` (defaults 440/480pt). Passing `none` for BOTH
caps disables probing entirely, and the probe stays off
private/internal hosts (loopback, RFC 1918, `.local`). Caps never
upscale — an unprobeable image inserts at native size, reported
as `probe-failed` under the report's `imageSizing`. Size is
write-only: it applies when an image is INSERTED, so a hint change
alone re-emits nothing — change the URL (the identity) to re-size an
already-synced image. Refusals: a doc holding atomic containers
refuses — TOCs, page-break paragraphs, text-plus-image paragraphs,
UI-pasted images without a sourceUri, NON-uniform tables
(`GDOCS_CONTAINER_UNSYNCABLE`). A zero-block render against a
non-empty doc refuses too (`GDOCS_EMPTY_RENDER`), as do malformed pipe tables
(`GDOCS_MARKDOWN_TABLE_SEPARATOR` / `GDOCS_MARKDOWN_TABLE_RAGGED`),
and a table/break without prose on both sides
(`GDOCS_STRUCTURE_PLACEMENT`).

Both write verbs (`sync` and `patch`) also run the **comment-anchor
guard** (EVA-131): a write that would rewrite text an UNRESOLVED
comment anchors to refuses (`GDOCS_COMMENT_ANCHORED`) — deleting
anchored text orphans the thread, and docx-imported comments then
vanish from the UI. The refusal message ends in a machine-readable
JSON anchor-overlap report: per thread its comment id, author,
created time, text, quoted span, reply count, and destroying op. That
report is the input for the preserve/drop/abort picker the SKILL.md
Per-runtime delivery section describes.
Three cures: `--preserve-comments` (below), resolve the thread
(`gdocs comment --resolve <id>`), or keep the edit away from the
anchored text. The guard is range-aware: a substring edit elsewhere
in the same paragraph passes, and the EVA-134 table realization
touches only its deleted lines and changed cells. It degrades LOUDLY,
never silently. An unlistable comment surface (the `drive.file` scope
limit) or a quote found nowhere lands in the report (`commentGuard`),
not in a refusal. The EXCEPTION is a write destroying an atomic
container (a TOC, say): its content is invisible to the projection,
and the Drive API cannot say which occurrence owns an anchor. Every
unresolved anchored comment refuses there, quote found elsewhere or
not.

**`--preserve-comments` (EVA-134).** The interactive middle path on
both write verbs. Overlapping threads are CAPTURED pre-write — the
write orphans the anchors, so capture afterwards is too late — and
the write applies. Each thread is then re-posted as an attributed
UNANCHORED comment (anchored creation is a recorded Drive limit),
with the original RESOLVED — never deleted. The restored body is
normative:

```
Restored comment after table reformatting
The anchored text now appears at the table (block evb:…), row 2 column 3.
On Thu Aug 20 2026 at 2:06PM CT, Jane commented (was anchored to: "…"):

---

Lorem ipsum dolor sit amet
```

The prefix names the destructive operation. The locator line reports
the anchored text's new location HONESTLY: found at, no longer
appears, or N places (ambiguous) — an exact-substring search, never a
guess. Each original reply re-posts as an attributed reply on the
restored comment. The verb report's `commentsPreserved` rows carry the
mapping (original id → restored id, replies, locator); a dry run
reports `commentsToPreserve` instead and posts nothing. Preserve fails
CLOSED. An unlistable comment surface refuses
(`GDOCS_PRESERVE_UNAVAILABLE`). A restore failing mid-flight names
what landed — per thread, per write — and what remains
(`GDOCS_PRESERVE_INCOMPLETE`); the originals are still readable via
`gdocs comments`, even when the UI hides docx-origin ones.

## status

```
evie-kit gdocs status <file.md>           # drift classification
evie-kit gdocs status --doc <id|url>      # doc facts only
```

With a file: `in_sync` / `local_changed` / `remote_changed` /
`conflict` against the sync stamps, plus what a sync would change
(`pendingOps`). A missing/partial/wrong-doc stamp degrades to
`unstamped` — never an error.

## share

```
evie-kit gdocs share --doc <id|url> [--link] [--rename <title>]
  [--trash] [--dry-run]
```

The three Drive operations every publish needs (EVA-158), without the
raw API: `--link` grants anyone-with-link READER access (idempotent —
an existing `anyone` permission reports `already enabled`),
`--rename <title>` renames the doc, `--trash` moves it to the Drive
trash. Flags compose in one invocation (rename → link → trash); bare
`share --doc <id|url>` is the read-only report — name, trashed state,
link sharing, `webViewLink`. `--dry-run` plans the actions against
live metadata without writing. Same `drive.file` scope reality as the
comment verbs: only docs this app created or opened are reachable
(the 403/404 refusal names the cure). Broader Drive management —
per-user permissions, folders, restore-from-trash — stays out of
scope; restore by hand in the Drive UI.

## auth

```
evie-kit gdocs auth --check               # prove the configured shape
evie-kit gdocs auth [--client-id <id> --client-secret <secret>]
  [--print-url] [--code <code> --redirect-uri <uri>] [--out <path>]
```

`--check` mints a real access token with whichever shape resolves and
reports the mode PLUS the full probe ledger (EVA-158): every settings
key, env var, and credential-file path the resolution consulted, in
precedence order, with which rung won — and the unconfigured refusal
lists the same ledger, so "where should my key live" is answered by
the error itself. The consent flow (refresh-token fallback only)
captures the redirect on a loopback listener by default; `--print-url`
prints the URL and stops (for a machine whose browser is elsewhere),
then re-run with `--code`. The token lands 0600 and PROJECT-LOCAL at
`<repo>/.evie-kit/gdocs-refresh-token` (self-gitignored; `--out`
overrides); the legacy machine-global
`~/.openclaw/credentials/gdocs-refresh-token` remains a read-only
fallback rung.

## Settings block

```ts
// .evie-kit/settings.ts
tools: {
  gdocs: {
    // primary: service account + domain-wide delegation
    serviceAccountKey: "…key JSON or a path to it…",
    subject: "docs-owner@example.com",
    // fallback: the refresh-token trio (evie-kit gdocs auth mints it)
    // clientId, clientSecret, refreshToken
    // enabled: false is the project's off-switch
  },
},
```

`serviceAccountKey`, `clientSecret`, and `refreshToken` are
credential-path keys (EVA-29): project-local only, never the
machine-global user layer.

## comments

```
evie-kit gdocs comments --doc <id|url> [--unresolved-only]
```

Every comment thread on the doc, via the DRIVE API (comments are a
Drive resource, not Docs content): per thread the author, plain-text
content, `resolved` state, the QUOTED doc text it anchors to (when
Google recorded one — UI-created comments carry it), and its replies.
`--unresolved-only` is the act-on-feedback view. Comment text is
quarantined from sync/patch content — a checked invariant, never just
a convention. SCOPE: under the `drive.file` grant both comment verbs
reach only docs this app CREATED OR OPENED — a doc authored elsewhere
403/404s with the cure named (a broader scope + re-consent, not
requested in v1). Both verbs take `--doc` only (like `patch`): they
do not resolve the target from a stamped markdown file the way
`status`/`sync` do — copy the `gdoc_id` out of the frontmatter.

## comment

```
evie-kit gdocs comment --doc <id|url> (--content <text> | --file <path>) [--dry-run]
evie-kit gdocs comment --doc <id|url> --reply <commentId> (--content … | --file …)
evie-kit gdocs comment --doc <id|url> --resolve <commentId> [--content …]
```

Write into the comment surface: create a doc-level comment, reply into
a thread, or resolve one (`--resolve` sends the reply-with-action the
Drive API requires; its text is optional — the ONE bare-text form).
Text unwraps hard-wrapped prose (EVA-66) and refuses empty
(`GDOCS_COMMENT_EMPTY`). `--dry-run` rehearses the EXACT text a real
run would post — rehearsal and post share one renderer. RECORDED
LIMIT: creation lands UNANCHORED (doc-level) — the Drive API cannot
anchor a new comment to Doc content; anchors are readable, never
writable, for Docs files. Carry any quoted text in the comment body.
