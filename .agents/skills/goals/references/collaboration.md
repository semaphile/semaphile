# Multi-developer collaboration (EVA-138)

The operational reference behind SKILL.md's summary: dependency edges
and the derived backlog, the status model, cross-developer adoption
with its etiquette, issue-import-as-intake, and the settings-driven
tracker identity. Decision provenance: the EVA-138 goal record
(grilling `session-001-20260820-152000.md`).

## Dependency edges: `blocked_by` and derived readiness

A promoted goal declares what it waits on as frontmatter:

```yaml
blocked_by: [EVA-140, EVA-141]
```

- **Grammar**: the flow array only, same-tracker keys only (v1 —
  cross-tracker dependencies are a recorded limit). Malformed lists
  are loud problems in `goals list`, never a silent empty set.
- **Readiness DERIVES; nothing hand-sets it.** A blocker is met
  exactly when its goal record is on the integration branch — the
  MERGE flips readiness, not the lock (a locked-but-unmerged blocker
  is still unmet). The derivation reads the union of local `main` and
  its remote-tracking ref, so a fetch is how another machine's merges
  become visible.
- **`status: blocked` is a materialized cache** of that derivation
  (`materializeBlockedStatus` is its one writer), kept for readability
  and tracker sync. `goals list` bands the backlog from the LIVE
  derivation, so a stale cache misplaces nothing; the loader refuses a
  hand-set `blocked` (no edges) as an incoherent record.
- **Cycles are not detected** (recorded limit): mutually-blocked goals
  sit visibly in the backlog until `goals unblock` drops an edge —
  the merge-based rule cannot flip either one.
- **A RETIRED blocker never merges** (recorded limit): dependents
  naming it stay blocked until a human drops the edge and re-grills
  against the cancellation. `goals retire` warns, naming each local
  dependent and the exact `goals unblock --by` command — cancellation
  is precisely the moment the dependent's spec assumptions break.

**Declaring edges.** Charting the roadmap IS declaring the
dependencies (grilled decision 5). Promotion from a wayfinder map
passes the map's edges as `goals promote --blocked-by KEY,KEY` — keys
resolve as siblings promote, in map order, and the orchestrator holds
the map. Edges discovered later are verbs, each a recorded forward
commit in the goal's own worktree (same-tracker keys only; a foreign
prefix refuses at declaration):

```bash
evie-kit goals block EVA-142 --by EVA-140,EVA-141
evie-kit goals unblock EVA-142 --by EVA-141   # drop one edge
evie-kit goals unblock EVA-142                # drop them all
```

`block`/`unblock` re-derive on the spot; a flip fires the matching
tracker event (`blocked` → the Backlog default, back to `promoted`'s
configured target on clearing). A started goal refuses new edges (its
executor holds it); `goals execute` refuses a blocked goal, naming the
unmet edges.

**The mechanical flip.** `goals merge <KEY>` ends by re-deriving every
LOCAL worktree record whose `blocked_by` names the landed key. The
scan runs outside the landing lock and never fails the merge. It is
GATED on publication: shared side effects wait until the landing is
on the remote integration ref. An unpushed `goals merge` defers the
flip and says so; push, then `goals merge <KEY> --catch-up` re-drives
it. The dependent whose last blocker just merged flips blocked →
promoted, as a recorded, pushed commit. It walks out of the tracker
backlog and emits `goal-unblocked` through the EVA-136 bus (its own
`unblock` route class, default `both`). A dependent folder holding uncommitted
edits is skipped with a `deferred` row — a machinery commit never
sweeps up somebody's in-progress work. The ping ends at the holder's
decision — _Re-grill / Execute as specced / Park_ (the SKILL.md
re-grill seam) — never an auto-execute.

**Cross-machine convergence.** The merge-time scan sees the merging
machine's worktrees. A dependent held on ANOTHER machine converges
through two mechanical points. Each fetches the integration branch
itself before re-deriving — best-effort; offline, it derives against
the last fetch, which fails toward "still blocked". `goals
tracker sync` re-derives every worktree record with edges; `--apply`
materializes the flip as a recorded, pushed commit, and the dry run
lists it as a `materialize` action. `goals execute` re-derives a
blocked goal before its status gate, so a mechanically-ready goal
launches instead of refusing on a stale cache. `goals list` bands
from the live derivation immediately, fetch-fresh or not.

## The status model

`draft | promoted | blocked | started | completed | retired` — the
bounded enum (grilled decision 3). `blocked` is machinery-derived
(above). `retired` is the promoted-tier terminal status — the
cancelled/won't-do counterpart of the drafts-only retire, with the
issue surviving as the record:

```bash
evie-kit goals retire EVA-143 --reason "superseded by EVA-150"
```

Terminal by transition guards (no verb leaves `retired`), not a lock:
`completed` alone locks. Retired goals leave the open list and join
the `goals completed` view, labeled per row.

**Tracker mapping** is settings-driven with defaults for the two NEW
events only: `states.blocked` defaults to `Backlog` (Linear; GitHub
has no backlog concept), `states.retired` to `Canceled` (Linear) /
`closed` (GitHub). Explicit names and the `null` opt-out win;
promotion proves only explicitly-configured names against the
workflow, so a workspace without a "Backlog" state degrades to the
fire-time warn-and-continue, never a refused promotion. The original
four events (`promoted/started/completed/merged`) keep EVA-83's
configure-nothing-gets-nothing contract, with ONE scoped exception.
Every promoted WALK-BACK fires with a fire-site `Todo` fallback on
Linear — the merge flip, the sweep's materialize, the launch
re-derivation, `goals unblock`, a takeover, and `goals release`. The
`blocked` default walked the issue in (and a release must read
"adoptable" on the board, not In Progress); explicit
`states.promoted` (a name or `null`) still wins. A goal simply
RESTING at promoted moves nowhere without configuration, exactly as
before. Recorded deviation from grilled decision 3: its full
five-state default list was narrowed to the two new events plus
these fire-site fallbacks, to keep EVA-83's contract intact for
existing projects — the narrowing is a recorded choice, not drift.

## Cross-developer adoption: `goals adopt`

```bash
evie-kit goals adopt EVA-142                 # promoted goal, by key
evie-kit goals adopt EVA-142-some-slug       # or by folder/branch name
evie-kit goals adopt draft/20260820-1200-x   # a shared draft
evie-kit goals adopt EVA-144 --takeover      # claim a STARTED goal
```

What it does, in order. Resolve the branch — local refs first, then
the remote; absence and ambiguity are both loud. Fetch and
fast-forward, then read the record FROM THE BRANCH for the etiquette
gate. A takeover posts its handshake comment here, before anything
else exists (fail-closed — see Etiquette below). Mint the mirror
worktree (the execute path's adopt-or-create,
checkout profile included) and provision the estate. Stamp `adopted:`
(a takeover also walks `started` back to `promoted`) and commit
forward (`docs(goals): adopt EVA-NNN (EVA-NNN)`). The PUSH is the
claim: a lost push means the branch moved since the fetch — likely a
concurrent adoption — so the verb stops loudly before touching the
tracker. Only after the claim lands does it reassign the issue and
post the adopt comment. It ends at the re-grill seam — the adoptee
decides re-grill / execute / park.

- **Etiquette (grilled decision 1)**: parked/backlog goals
  (`promoted`/`blocked`) adopt freely. A STARTED goal needs the
  owner's recorded release or the adoptee's explicit `--takeover`.
  The release is `evie-kit goals release EVA-144 [--note …]` — it
  walks status back to `promoted`, pushes, and posts the release
  comment. The takeover is FAIL-CLOSED on its handshake: the comment
  posts to the issue BEFORE anything local changes. A transport that
  cannot post (no tracker, comments off, network down) refuses the
  whole takeover — a started goal never silently converts back to
  executable. Handshake markers are EPISODE-scoped (the record's
  `started`/`released` stamp), so each handoff posts its own comment
  while a retry of the same one stays idempotent.
  Two executors on one branch is the hazard the gate exists for; the
  releasing owner is responsible for their executor being finished or
  closed. Recorded limit: the gate reads the branch's last PUSHED
  record, and a launch does not push its `started` commit — an owner
  who launched moments ago can still read as `promoted` remotely.
  The claim push surfaces that collision (the owner's next push
  fails, loudly); a shared-state compare-and-swap is recorded
  follow-up work.
- **The estate** (the EVA-136 pothole list, closed mechanically): the
  provisioning copy stage carries THIS machine's
  `.evie-kit/settings.local.*` and `.envrc.local` from its own
  primary — credentials never travel between developers. `bun
install` runs when the tree carries a `package.json`; that is the
  one pothole the copy stage cannot close, `node_modules/` being a
  deliberate copy exclusion.
- **Terminal records refuse**: completed (locked) and retired goals
  are records, not work; adopting them is a `git worktree add` away if
  reading is the need.
- **Disambiguation**: `adopt-draft` (EVA-102) retrofits git structure
  around a LOOSE LOCAL folder; `adopt` materializes a goal that exists
  REMOTELY. Preconditions are inverted — adopt requires the branch to
  exist and the worktree not to.

## Issue-import-as-intake: `goals adopt --issue`

```bash
evie-kit goals adopt --issue EVA-145 [--slug fix-widget] [--title …] [--type bug]
```

For an issue with NO goal behind it. A record for the key ANYWHERE
this machine can see refuses. A live branch points at plain `adopt`;
a merged goal on the integration branch is the issue's locked history
(checked against a freshly fetched ref); an earlier import's draft
(matched by `import_issue`) is where refinement continues. Recorded
limit: a draft another developer imported and shared is invisible to
this check until fetched — remote draft branches carry the
`import_issue` mark in content this machine cannot read without
fetching each one; concurrent imports of one issue can therefore
still race. Past those checks, the issue's
description and comments land BYTE-FOR-BYTE as the fresh draft's
`references/intake.md` — provenance-honest exactly like typed intake.
The `--- issue comment N of M (verbatim) ---` separators are clearly
structural, and Linear comments paginate to exhaustion, so nothing
past the first page is dropped. The normal refinement lifecycle follows
(grill/ADHD/goal-review). The draft's
`import_issue`/`import_issue_url` frontmatter make `goals promote`
reuse the SAME issue by default (an explicit `--issue` still wins), so
no second issue is ever minted. Who answers the grill: the adopter —
the original author's issue comments ride the intake as record, not as
a live dependency (grilled decision 4). The issue's project PLACEMENT
rides too (EVA-236). An issue the humans filed into an epic lands on
the draft as `linear_project` / `linear_project_id`. Promotion carries
it onto the promoted record, or clears it when Linear now reports the
issue in no project. Nothing ever moves the issue.

## Tracker identity: whose key acts

Identity is settings-driven, keyed by whose API key acts (grilled
decision 2). The documented recommended setup mirrors the "Evie"
pattern — a dedicated agent tracker user, so agent actions never read
as the human replying to themselves:

```ts
tools: {
  tracker: {
    linear: {
      team: "EVA",
      apiKey: "${EVIE_LINEAR_API_KEY}",      // the agent user: comments, states
      claimApiKey: "${MY_LINEAR_API_KEY}",   // optional dual-key: claims act as the human
    },
  },
},
```

- Single-account users set only `apiKey` and claim issues as
  themselves.
- The DUAL-KEY split routes action classes: assignment/claiming —
  adoption's reassignment, promotion's assign-on-create, and `me`
  resolution inside both — ride `claimApiKey`/`claimToken`; comments
  and state management stay on `apiKey`/`token`.
- BOTH identities count as "viewer" for the
  never-move-a-human-moved-issue attribution — without that, every
  write by one key would read as a human's move to the other.
- Both keys are project-local credentials (EVA-29): the gitignored
  store, never the user layer, never committed.
