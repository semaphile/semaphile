# Maintaining a Notion mirror

A mirror is a set of local documents published as Notion pages, kept in
step over time, where humans read on the Notion side and sometimes edit
there. Everything in this file assumes that last part is true, because
it is the part that makes mirrors hard: **a conflict is a when, not an
if.** A mirror design that treats human edits as an error case will
eventually destroy one.

Two mirror shapes exist in this repo, and they are not interchangeable:

- **Local-dominant** (this file). The repo is the source of truth; Notion
  is the published surface. `evie-kit notion upsert` is the write, and
  the sync stamp in each file's frontmatter is the durable base.
- **Notion-dominant** — `@evie-kit/notion/basic-memory`, a one-way
  Notion → local tree sync (discover, layout, relocate, render, snapshot,
  commit). If Notion is where the writing happens, use that, not this.

## The three questions a mirror has to answer

Every mirror incident reduces to one of these. Each has a mechanical
answer; none of them needs a hand-rolled API script.

1. **Did anything actually change on the Notion side?** (status, with
   verification)
2. **What changed, and why?** (triage)
3. **What do I do about it?** (heal, with dominance and etiquette)

---

## 1. Status, in two stages

**A page's `last_edited_time` is not evidence of a content edit.** It
bumps for property changes, comment activity, and Notion-side metadata
churn. Alarming on it produces exactly one outcome: a "possible unseen
stakeholder edit" that sits unresolved for days and turns out to be
nothing.

So status is two stages, and only the second one is a verdict.

**Stage one — the candidate.** The page's `updatedAt` moved past the
file's stamped `synced_at`. This says "look closer", nothing more.

Stage one is allowed to be wrong in exactly ONE direction: it may say
"look closer" when nothing happened, and must never say "nothing
happened" when something did. That asymmetry has a mechanical
consequence — **compare with a one-minute slack, not with `>`.** Notion
rounds edit timestamps DOWN to the minute while the sync stamp is
written from a full-precision clock, so a sync at `10:00:30` and a human
edit at `10:00:45` reports `updatedAt = 10:00:00`, which is _before_ the
stamp. A strict comparison skips stage two entirely and calls a real
edit nothing. The slack costs one extra block read per page per sync
minute.

**Stage two — the verdict.** Compare block-level revisions:

```bash
evie-kit notion history path/to/doc.md
```

Read `remoteChangedSinceSync` first. It compares the live block tree's
rev against the stamped `sync_rev` — the rev captured by reading the
page back right after the last upsert. It is the authoritative signal for
what the revs can see:

- `remoteChangedSinceSync: true` → **real content edit.** Continue to
  triage.
- `remoteChangedSinceSync: false` **and the page carries no container
  blocks** → **metadata bump** as far as the BODY goes. The body is
  byte-identical to what you published, so there is nothing to heal and
  nothing to alarm about. Sweep the comments before you close it
  anyway: a bump with an unchanged body is exactly what a new comment
  looks like, and the etiquette step tells humans to reply in that
  thread. Closing here unread is how you ignore the channel you asked
  them to use.
- `remoteChangedSinceSync: false` **on a page with tables or toggles** →
  **not proven.** Containers compare atomically and their children never
  move the revs, so an edit inside a table cell reads exactly like this.
  Triage by hand; do not close it and do not heal unattended.

That third case is the one to internalize, because it is where a
clean-looking verdict is wrong rather than merely coarse. On a
container-bearing page the two signals fail in OPPOSITE directions, so
neither is evidence:

- the revs **under-report** — container children never move them, so an
  edit inside a table cell reads clean;
- a block diff **over-reports** — a container cannot be updated in
  place, so an untouched table still plans delete+append ops. `diff`
  reports that count as `containerRecreates`.

A nonzero `containerRecreates` with both since-sync flags false is the
signature of a page whose revs cannot answer the question.

`blocksEditedSinceSync` and the per-block `editedSinceSync` flags then
localize WHICH blocks moved. Use them to narrow, never to decide:
Notion's block timestamps are **minute-granular** (verified live), so an
edit landing inside the sync minute reads false there while the rev
comparison correctly reads true. The rev is the verdict; the timestamps
are the map.

One more trap: **do not triage from a cached read.** An MCP fetch or any
cached page render can serve you the pre-bump content, which looks
reassuringly unchanged. `history` and `diff` read the live block tree
through the API every time.

---

## 2. Triage, mechanically

Three reads, in this order. None of them writes anything.

```bash
evie-kit notion diff path/to/doc.md      # classification + planned ops
evie-kit notion history path/to/doc.md   # which blocks moved, and when
```

`diff` gives you the classification against the stamp:

| Field                    | Meaning                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `localChangedSinceSync`  | The file's render left the stamped `render_rev`.                 |
| `remoteChangedSinceSync` | The live page left the stamped `sync_rev`.                       |
| `conflict`               | Both moved, and they did not converge on the same state.         |
| `planned`                | The exact ops an upsert would apply, with the text each touches. |
| `degraded`               | No page-bound stamp — this is a two-way report only.             |

Converged edits are deliberately NOT a conflict: if both sides
independently arrived at the same content, there is nothing to resolve.

Then the third read, which is the one hand-rolled scripts always skip:

```ts
const sweep = await client.getComments({ pageId }, { deep: true });
const complete = !sweep.truncated && sweep.failed.length === 0;
```

A human who edited a mirrored page usually said why, in a comment, on
that page. Sweep the comments before you decide anything. Comment text
stays out of the document — read it, act on it, never merge it in.

**Read DEEP here, not shallow.** `getComments({ pageId })` returns only
the comments anchored to the page itself, and the natural way to object
to a paragraph is to comment ON that paragraph. A page covered in
margin notes answers "no comments" to the shallow read — so triage
concludes nobody objected about a page full of objections, which is the
wrong direction for the one check whose job is to notice humans. Each
returned comment carries `parentBlockId`, which lines the commentary up
with the changed blocks the diff reported.

Check `truncated` and `failed` before you treat an empty sweep as
silence. A bounded walk that stopped early and a page nobody commented
on look identical in the `comments` array, and only one of them means
it is safe to overwrite someone.

At the end of triage you should have, **for every remotely changed
block**, one of:

- **whitespace-only** — the remote BLOCK and the block you would publish
  are the same block, modulo insignificant whitespace;
- **superseded** — the incoming content carries the human's edit
  forward, so republishing loses nothing;
- **substantive** — a human said something the repo does not know.

**Only the first can be decided by a machine.** That boundary was
learned the expensive way: the obvious proxy for supersession is "the
local text contains the remote text", and it authorizes exactly the
overwrite this whole flow exists to prevent. Base `pending`, human
writes `approved`, local says `not approved` — containment holds, and
the heal silently reverses what they said. There is no cheap test for
"this carries their meaning forward"; that judgement belongs to whoever
can read both texts. Let the machine assign `whitespace-only` and
`substantive`, and let `superseded` come from triage.

**Classify blocks, not strings.** The same mistake has a second form:
comparing PLAIN TEXT and calling equality proof of equivalence. Plain
text cannot see a link whose destination changed under the same label, a
word that gained emphasis, a paragraph that became a heading, or a code
block whose language changed — all real edits, all of which `diffBlocks`
emits ops for, and all of which a text comparison waves through as
whitespace. Compare the whole type payload with only the character data
normalized, and exempt `code`, where whitespace IS significant. The
general rule: keep everything except what you can prove is
insignificant, so a field the API adds next year is compared by default
rather than silently ignored.

Four cases are substantive (or refusable) by construction, and a heal
must treat them that way rather than reason about them:

- **a block the human EMPTIED** — a deletion says something, and an
  empty string is trivially "contained in" whatever you publish;
- **a block the human ADDED** — there is no base to classify it
  against;
- **any changed block triage did not classify** — an unexamined change
  is not a safe change. Key dispositions to block ids and fail on a
  missing one; a bare list of verdicts with no block to attach them to
  is how an empty classification silently authorizes a destructive plan;
- **any change on a page with containers** — see below. Approval cannot
  cover what neither the diff nor the staleness check can see.

---

## 3. Heal, with dominance

Dominance is the policy for who wins when both sides changed the same
thing. The package ships the model:

```ts
import {
  DEFAULT_DOMINANCE,
  dominanceFor,
  threeWayMerge,
} from "@evie-kit/notion";
```

Three rules, per field:

- `"local"` — an agent-owned execution fact. Local wins; a remote edit is
  refused and corrected on the next push.
- `"notion"` — the agent seeds it, a human may override it. Notion wins.
- `"merge"` — set union; neither side may delete the other's entries.

The fallback for any field not in the map is `"notion"`
(`DEFAULT_FIELD_DOMINANCE`): **a human edit to a field the agent does not
claim is treated as intentional.** Design your dominance map so the
things you are willing to overwrite are the ones you explicitly claim.

For a local-dominant mirror the body is `"local"`, which is precisely
why the etiquette step exists — "local wins" describes the merge, not
the manners.

**What dominance covers and what it does not.** `threeWayMerge` and
`diffStatus` resolve typed METADATA fields. Page BODY is block content,
and there `diffBlocks` gives you the mechanical change set while the
disposition (superseded / whitespace / substantive) stays yours. That
split is deliberate: the package refuses to guess what a paragraph
edit MEANT.

**Dominance decides whether to heal at all — never how loudly.** A heal
computes "make Notion match local", so under a `"notion"`-dominant body
those ops contradict the policy they claim to implement. The answer is
to refuse and pull, not to apply them with the approval step switched
off. Watch the default here: `dominanceFor` falls back to `"notion"` for
any field a map does not list, so an EMPTY dominance map is
Notion-dominant, and "the human wins" must never be the input that
produces the least-guarded write.

**A container-bearing page cannot be healed unattended at all.**
`listBlocks` reads top-level blocks only, so a change inside a table
cell is invisible to the diff, to the revs, and to the staleness
re-check — before, during and after approval. Approval does not fix an
undetectable change. Refuse and heal that page by hand.

---

## 4. The etiquette step

**Never a silent overwrite.** When the heal will discard something a
human wrote, the sequence is:

1. **Draft** the explanation — what you are overwriting, why the repo is
   dominant here, and where their change should go instead.
2. **Rehearse** it:

   ```bash
   evie-kit notion comment --page <id|url> --content "…" --dry-run
   ```

   The report prints the exact text that would post, unwrapped and
   segmented exactly as the real call sends it.

3. **Get a human to approve that text.** Not the plan — the text.
4. **Post it, then heal:**

   ```bash
   evie-kit notion comment --page <id|url> --content "…"
   evie-kit notion upsert path/to/doc.md
   ```

Comment before overwrite, not after: if the upsert fails halfway, the
explanation is already there.

**Re-check the page between approval and write.** A human takes minutes
or hours to answer, and block operations address blocks by ID, so an
edit landing in that window would be overwritten by an op approved for
different content. Re-read the page immediately before the write and
compare it against what you triaged; if it moved, the approval no longer
covers it — go back through triage rather than re-diffing under the old
approval. `examples/mirror-heal.ts` carries this as `expectedTreeRev`.

Re-check AFTER posting the explanatory comment too, not only before it:
the comment is its own network request behind the shared limiter, so it
is a real window, and an edit landing inside it proves a human is on
the page at that exact moment. The refusal leaves the posted comment
standing over a heal that did not happen — say so in the error rather
than applying anyway, because the alternative overwrites the very edit
that proved someone is there. What cannot be closed is the final
`applyBlockOps` request itself: Notion has no conditional writes, so
that single request is the irreducible race floor. Know it exists;
do not pretend a re-read removes it.

Compare on the same terms `diffBlocks` does — block id, TYPE and the
full type payload. Plain text alone is blind to a changed link
destination, an annotation, a code language, and a paragraph promoted to
a heading, all of which produce real ops; a text-only comparison would
call the page unchanged while the plan it guards was already stale.

**And post exactly the text that was approved.** "Some string was
passed" is not an approval — the check has to be equality against the
draft the human read, or a caller can approve one wording and publish
another over someone's edit. Reword by re-drafting the plan, not by
passing different text to the write.

**Preflight the ops before the comment, not after.** A plan whose first
op needs a block above the page's current first block cannot execute —
Notion has no prepend — and the executor discovers this only when it
reaches that op, after earlier deletes have already landed. Combined
with comment-before-overwrite, the failure mode is a half-healed page
carrying a comment that describes a heal which did not happen. Check
for a null-anchored `append`/`move` against a non-empty page at plan
time AND again immediately before the first write.

A workable shape for the text — say what changed, why, and where to put
the edit next time:

> This page is mirrored from `<repo path>` and was just republished from
> that source, so the edit made here on `<date>` is no longer shown.
> Nothing was lost: <what it said>. To make that change stick, edit the
> source file (or comment here and it will be picked up in triage).

Replying inside an existing thread instead of opening a new one:

```bash
evie-kit notion comment --discussion <discussion-id> --content "…"
```

`getComments` returns each comment's `discussionId` (and, in deep mode,
the `parentBlockId` it was anchored to), so a triage sweep that found
the human's note can answer in the same thread, on the same paragraph.

---

## The loop, end to end

```
for each mirrored file:
  1. status stage one   page.updatedAt vs the stamped synced_at   → candidate?
  2. status stage two   notion history → remoteChangedSinceSync   → verdict
     ├─ false, no containers → body is clean; still sweep comments
     └─ false, containers    → NOT proven; hand-triage
  3. triage             notion diff + history + getComments DEEP  → disposition
     (every CANDIDATE sweeps, not only changed bodies — a reply is
      human input even when the page body did not move)
  4. heal
     ├─ nothing remote      → notion upsert
     ├─ superseded / ws     → notion upsert
     └─ substantive human   → draft comment → --dry-run → HUMAN APPROVES
                            → re-check page unchanged since triage
                            → notion comment → notion upsert
```

Step 4's last branch is the only one that blocks, and the re-check
inside it can send a page back to step 3. Everything above runs
unattended.

## Recorded limits

Know these before you design around them.

- **No mirror CLI verbs yet.** There is no `status --verify`, `triage`,
  or `heal` verb: each needs a mirror-config shape that the deferred
  adoption surface owns (EVA-106 decision 4). What exists is the
  composition above. If you need the config shape, open a goal.
- **`NotionSyncEngine`'s bases are in-memory, per process.** A CLI
  invocation is a fresh process, so the durable local base is the
  frontmatter sync stamp, not the engine. The engine is for
  long-running consumers that keep their own state.
- **The engine is typed on `ResearchRecord`.** Wiring it to arbitrary
  document types is the deferred adoption work; `references/library.md`
  says exactly how far the existing types reach.
- **Container blocks compare atomically**, so tables and toggles
  recreate rather than update in place, and their children never move
  the revs.
- **Block timestamps are minute-granular.** Rev comparison is the
  verdict; timestamps localize.
- **Notion cannot prepend.** A mirror whose documents grow at the top
  will refuse. Keep a stable first block (a title heading does this
  naturally).
