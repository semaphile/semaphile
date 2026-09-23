---
name: research
description: >-
  Draft-first async research over the evie-kit research pipeline —
  create a research draft (report, comparison, discovery, due-diligence,
  timeline), get explicit approval, dispatch the Exa run, and deliver the
  result to the project's configured storage destinations (local
  docs/research/ drafts plus a Notion mirror when configured). Also covers
  quick person/org lookups (entity-profile). Use when the user asks for
  deep research on a domain question, when a grill-me question offers
  "research this first", or when resolving a wayfinder research ticket.
  Research costs real money and stays consent-gated — grounding (the
  read-only recall ladder) is NOT this skill.
argument-hint: "[research question or entity to profile]"
---

# Research Workflow

`evie-kit research <command>` wraps `@evie-kit/research` (which
composes `@evie-kit/{exa,notion}`). Five commands, five async formats.
The primary human-review surface is the draft artifact — the Notion page
when a mirror is configured, otherwise the local draft under the
project's `storage.research.drafts` folder.

Zero-ambiguity invocation when the bin might not be linked:
`bun node_modules/@evie-kit/cli/src/evie-kit.ts research <command> …`

**Toolchain guard (EVA-81)**: module-not-found on that path means the
machine's bootstrap has not run — not a broken repo. Run it once BY
PATH: `bun /path/to/evie-kit/packages/cli/src/evie-kit.ts onboard`
(`EVIE-KIT.md` at the project root has the full bootstrap).

Provenance: `references/attribution.md`.

## ⛔ THE #1 RULE: never call `draft` bare for a content-bearing format

For `report` (the default), `comparison`, and `discovery` formats,
`draft` **requires** an `--input <path-to-json>` flag pointing at a JSON
file with real research content. Without it, `formatInputs` is left
undefined and the draft falls back to a generic, mostly-empty scaffold —
no real focus areas, no real options/criteria, just empty structure.
**This already happened**: an agent ran `draft` for a `report` with no
`--input`, and the resulting page rendered with every section as
unfilled placeholder text.

**The pre-draft checklist — run it, in order, before every `draft`
call for `report`/`comparison`/`discovery`:**

1. **Author the `--input` JSON content FIRST**, as part of gathering
   the research question from the user (see "Writing Good Research
   Content" below for what goes in it) — **at full register, not
   label depth**: the `--summary` is 150–300 words (two dense
   paragraphs), each report focus-area `body` is 80–150 words, and
   comparison/discovery criteria carry real rubric bands plus 2–3
   sentence descriptions. Count words before moving on — a 40-word
   body is a topic label wearing a research question's clothes, and
   the delivered report can only be as sharp as the questions in this
   file. (The tool's 30-word floor catches labels; the 80–150 target
   is what good looks like — floors are not targets.)
2. **Sanitize sweep.** Re-read the summary and every `--input` string
   for internal codenames, issue keys (anything shaped like `ABC-123`),
   client names, and internal cost/benchmark figures — the user's
   message will often contain them; your dispatched fields must not.
   Abstract each one per the curious-stranger rule below.
3. **Check the title**: ≤35 characters, capitalized — the pipeline
   REFUSES anything longer (`researchTitleGrammar`), so count before
   you call.
4. Write the JSON to a temp file (e.g. under `.scratch/`), then call
   `draft --title ... --summary ... --input <path>`.
5. **Relay reality, then stop.** The draft link and content hash you
   present to the user come from the `DRAFT_READY` line the CLI just
   printed — if you never ran `draft`, there is no draft, and
   presenting an invented link or a hand-written "quality check" is
   fabrication, not drafting. Then END YOUR REPLY with the full
   go/no-go picker from the approval section — the question embeds the
   `DRAFT_READY` url and offers **Approve & run / Grill the question
   first / Revise the draft / Cancel** — and stop there: `approve` and
   `start` belong to a later turn, after the user picks. This stop
   applies even when the user pre-authorized in advance ("just run
   it", "consider this my approval", "dispatch once drafted") — that
   authorized the _question_; the draft in front of them is what
   actually executes, and they haven't seen it yet (the approval
   section has the full reasoning — this is the part agents get wrong
   most).

Never call `draft` bare and hope for `report`/`comparison`/`discovery`.
The only formats that don't need `--input` are `due-diligence` and
`timeline` — they have a fixed schema and `--input` for them is optional
(it only ever carries a `systemPrompt` override).

Since EVA-54 the CLI also enforces this mechanically: `start` refuses to
dispatch when the checkpointed `--input` content cannot steer the Exa
output schema, or when the draft's sections still carry the template's
placeholder text (see the dispatch gate under `start` below) — but the
gate is the backstop, not the workflow. Author real content first.

Since EVA-64 `draft` itself also enforces **depth floors** on supplied
report sections — presence is not substance: focus-area bodies below 30
words, a Desired Output below 10, or Out of Scope items below 6 refuse
at draft time, printing the section's guidance inline. The floors catch
label-thin content; the length targets below are what GOOD content
looks like. `draft` additionally prints a per-section **self-check**
(word counts, UNFILLED markers) and a **sanitization lint** (warn-only,
internal names/issue keys in dispatched fields) with its output.

**`--focus "A|B|C"` is not a substitute for `--input`.** `--focus` fills
the reviewed Focus Areas RENDER only — it never populates the
`focusAreas` content (`{subject, body}` objects) that `--input` sends to
the provider, so a `--focus`-only draft still refuses at `start`. And
since EVA-64 its entries are not labels either: each must clear the same
30-word depth floor as an `--input` focus-area body, because whatever
renders there is what the human approves.

## Commands

| Command          | What it does                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `draft`          | Creates a local draft (+ Notion page when configured). No Exa call yet.                                                       |
| `approve`        | Records HITL approval for the draft's CURRENT revision (content hash). Any redraft or edit voids it.                          |
| `start`          | Dispatches the Exa run and spawns a detached delivery worker; returns in <1s. Refuses an unapproved revision.                 |
| `status`         | Ad-hoc check (disk cache, else a single non-blocking probe). Info only.                                                       |
| `deliver`        | Idempotent safety net — renders a completed run when the detached worker died mid-flight. You should rarely need it.          |
| `entity-profile` | Synchronous Apollo→Exa-fallback lookup for a person/org. No draft/start/deliver lifecycle at all — see its own section below. |

## Where artifacts land (settings, not flags)

Routing comes from the repo's layered `.evie-kit` settings:

- `storage.research.drafts` — the local draft root (default
  `docs/research/` since EVA-151; projects with a configured path keep
  it).
- `storage.research.categories` — the project's declared category
  vocabulary (EVA-151): kebab-case names that are BOTH folders under
  the drafts root and Notion `Category` select values. ABSENT means
  the project declined categories: reports land at the drafts root
  (no `_default` ceremony) and `--category` refuses with the setup
  pointer. Declared at setup (`evie-kit setup --research-categories
a,b,c`) or by editing settings.
- `storage.research.outputs[]` — a `{notion: {database: <pasted URL or
id>}}` entry names the Notion mirror; the 32-hex id is parsed out at
  load. No notion output means the project chose local-only — that is
  explicit routing, not a silent default.
- `tools.notion` — the connection token (a notion output REQUIRES this
  block; the settings loader cross-validates at load).
- `tools.research.exa` — defining the block declares the engine; the
  apiKey falls back to `EXA_API_KEY`/the credentials file when unset.

Per-invocation overrides: `--notion-db <id|url>` redirects one run,
`--notion-db none` forces the local-only stub (dry runs), `--repo
<root>` targets another repo's settings (default: cwd).

## Formats

`--format <name>` on `draft` (default: `report`):

| Format          | Needs `--input`?              | `--input` JSON shape                                                                                                                                                            |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report`        | **Required** for real content | `{ "focusAreas": [{ "subject": "...", "body": "..." }] }`                                                                                                                       |
| `comparison`    | **Required**                  | `{ "options": [{ "key","name","description","url" }], "criteria": [{ "key","name","rubric","description" }], "systemPrompt"?: "..." }`                                          |
| `discovery`     | **Required**                  | `{ "criteria": [...], "categories": ["..."], "fields"?: [{ "key","name","description","type","unit"? }], "bounds"?: { "minOptions"?, "maxOptions"? }, "systemPrompt"?: "..." }` |
| `due-diligence` | Optional                      | `{ "systemPrompt"?: "..." }` — fixed single-subject risk-assessment schema, no options/criteria.                                                                                |
| `timeline`      | Optional                      | `{ "systemPrompt"?: "..." }` — fixed event-sequence schema (5+ events).                                                                                                         |

### Field notes

- **`report`** — each `focusAreas[]` entry becomes a schema property;
  `body` is the research-question text for that focus area (80-150
  words, per the length targets below). The draft's Objective renders
  your `--summary` VERBATIM (no wrapper sentence), and a Context
  section appears only when you pass `--context` with genuine
  background — never a restatement of the objective.
- **`comparison`** — `options[].key` and `criteria[].key` must be
  JSON-safe property-name strings (e.g. `"pinecone"`,
  `"query_latency"`). `rubric` is a full 0-1 scoring rubric written as
  `"; "`-separated bands, e.g. `"0.0-0.2: ...; ...; 0.8-1.0: ..."`.
  `description` is 2-3 sentences on what the criterion measures.
- **`discovery`** — same `criteria` shape as `comparison`, but no fixed
  `options` — Exa chooses which options to include itself, bounded by
  `bounds.minOptions`/`maxOptions` (both optional). `categories` is
  REQUIRED (a plain string array, e.g. `["terminal-multiplexer",
"desktop-application"]`): the format has no built-in vocabulary, so
  every discovered option is classified into a bucket YOU named (EVA-231
  retired the old AI-tooling default that once swallowed a
  terminal-multiplexer run). The format bakes in NO domain attributes
  either: every option carries only a name, its canonical source `url`,
  a category, rationale, summary, strengths, weaknesses, and the
  criteria scores. Anything else the run should collect per option —
  a retail price for products, a star count for open-source projects, a
  licence for libraries, a wattage for hardware — is declared in
  `fields`, each `{ "key": "retail_price", "name": "Retail price",
"description": "Manufacturer list price in USD, from the vendor's own
pricing page.", "type": "number", "unit": "USD" }` (`type` is
  `string | number | integer | url`; `unit` is optional). Declared fields
  become required, nullable properties on every option, columns in the
  landscape table, and a line under each option's heading. Options are
  ranked by their mean score across the criteria, never by any field.
- **`due-diligence`** / **`timeline`** — fixed schemas; you almost never
  need `--input`. Only pass it to override the default system prompt.

### Worked example — `report`

This example is at the register real drafts must hit — bodies of
80–150 words each, a 150–300-word summary, 3+ areas. Match its
density, not just its shape; a draft whose bodies are a third this
length reads as topic labels and produces a shallow report.

```json
{
  "focusAreas": [
    {
      "subject": "Pace of model releases",
      "body": "How has the cadence of new frontier model releases changed since 2022 — are the major labs shipping more or less frequently over time, and what forces are driving the change? Candidate drivers worth examining separately: training compute cost curves and hardware availability, competitive pressure between labs (including open-weight challengers forcing faster responses), and safety/regulatory review cycles lengthening the path from trained model to public release. Where possible, ground the answer in dated release timelines per lab rather than commentary, and distinguish flagship releases from incremental point-upgrades, since counting the two together hides the actual cadence shift."
    },
    {
      "subject": "Tooling ecosystem maturity",
      "body": "How has the tooling ecosystem around frontier models (agent frameworks, eval harnesses, fine-tuning and serving platforms) matured since 2022 in production-readiness and adoption? Interesting angles: which categories consolidated around a few winners versus staying fragmented, what production case studies exist at meaningful scale, how enterprise adoption barriers (compliance, reliability, cost predictability) changed, and where the ecosystem is still visibly immature relative to demand. Prefer evidence of real production use — engineering blog posts, incident writeups, adoption surveys — over vendor marketing claims, and note where the two conflict."
    },
    {
      "subject": "Capability-to-deployment lag",
      "body": "How long does it now take for a newly demonstrated model capability to become a dependable production feature, and is that lag shrinking or growing? Trace 2–3 concrete capability cohorts (for example long-context reasoning, tool use / computer use, multimodal input) from first public demonstration through API general availability to documented production deployments at non-lab companies. Identify what dominates the lag — model reliability, cost per call, integration and evaluation work, or organizational trust — and whether the bottleneck has moved over the period under study."
    }
  ]
}
```

```bash
evie-kit research draft \
  --title "AI Tooling Pace Since 2022" \
  --summary "Assess how quickly frontier AI model capability and its surrounding tooling ecosystem have evolved since 2022, and what is driving the pace. The motivating question is planning-oriented: teams building on these models need to know whether the ground will keep shifting under them at the current rate, accelerate, or settle, because that answer changes how much to invest in abstractions versus betting directly on a current provider's surface. Cover the release cadence of frontier models and its drivers, the maturation of the production tooling ecosystem around them, and how quickly demonstrated capabilities become dependable, economically viable production features.

The report should separate observable evidence (dated releases, adoption data, production case studies) from industry commentary, note where the two conflict, and conclude with the two or three strongest signals worth monitoring going forward as leading indicators of pace change. Audience is technical leadership deciding platform investments, so relative magnitudes and inflection points matter more than exhaustive cataloging." \
  --format report \
  --input .scratch/ai-tooling-pace-input.json
```

## Other `draft` flags

| Flag               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--title`          | Required. ≤35 chars, capitalized (see Naming below; the pipeline hard-caps at 40).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--summary`        | Required (the research question sent to Exa). `--query`/bare `--title` are fallbacks, but always pass `--summary` explicitly.                                                                                                                                                                                                                                                                                                                                                                                                |
| `--format`         | One of `report` (default), `comparison`, `discovery`, `due-diligence`, `timeline`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--effort`         | Exa effort tier (`minimal`–`xhigh`; legacy `--model` names map automatically). Defaults to the project's `research.effort` when set.                                                                                                                                                                                                                                                                                                                                                                                         |
| `--input`          | Path to the format's JSON content — **required** in practice for `report`/`comparison`/`discovery`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--context`        | Genuine background Exa won't know — rendered as the draft's Context section. Omit rather than restate the summary.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--focus`          | Pipe-delimited focus-area paragraphs — NOT a substitute for `--input`'s `focusAreas` (never reaches the payload), and since EVA-64 each entry must clear the same 30-word depth floor (it renders the reviewed Focus Areas section; bare labels refuse at draft).                                                                                                                                                                                                                                                            |
| `--desired-output` | `report` only (any other format refuses the flag): overrides the Desired Output REVIEW section's text. Fills the human-review render only — never the dispatch payload; `--input` already derives this section, so you rarely need it.                                                                                                                                                                                                                                                                                       |
| `--out-of-scope`   | `report` only (refused elsewhere): pipe-delimited Out of Scope items — same review-section-only behavior as `--desired-output`.                                                                                                                                                                                                                                                                                                                                                                                              |
| `--tags`           | Comma-delimited tags.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--slug`           | Explicit slug override (otherwise derived from the title). Redrafting an existing slug must keep its TITLE (the Notion mirror is title-keyed; a retitle refuses rather than splitting the record) and refuses outright once the slug was dispatched (a redraft would orphan the paid run).                                                                                                                                                                                                                                   |
| `--category`       | The ONE categorization axis (EVA-151; the old `--namespace` folded into it — passing `--namespace` refuses with a teaching message). Must name a DECLARED category (`storage.research.categories`); an undeclared value refuses listing the vocabulary with a did-you-mean, and a no-categories project refuses with the setup pointer. Names both the local folder (`<drafts>/<category>/<slug>.md`; bare `<drafts>/<slug>.md` when omitted) and the Notion `Category` select value. Redrafting must keep it (id identity). |
| `--notion-db`      | Per-run database override (`id`, pasted URL, or `none` for the local-only stub).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--repo`           | Repo root whose settings route this run (default: cwd).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## ⛔ MANDATORY: approval before execution — the draft IS the proposal

Drafting is always permitted; **executing costs real money and is
consent-gated**. After `draft`, stop and put the go/no-go to the user as
an `AskUserQuestion` picker — with the draft link EMBEDDED in the
question itself (never a separate "review it first" option):

- Question: "Research draft ready: <title> — <url>. Run it?"
- Options: **Approve & run** (recommended once the question is sharp) /
  **Grill the question first** (weak research questions produce weak
  reports — this runs `grill-me` on the research question before
  spending) / **Revise the draft** (say what to change) / **Cancel**.
- This picker is a lifecycle seam already at its full four-option set:
  per grill-me's Go Deeper rule (`grill-me/SKILL.md`, "The standing
  'Go Deeper' option"), the question prose must state that asking for
  more depth is always honored via the picker's built-in "Other".

Per-runtime delivery (EVA-212): on Claude Code the four options fill
one `AskUserQuestion`. On Codex (`request_user_input`, 2–3 options per
question, no preview) the gate splits into two questions. The primary
carries **Approve & run** / **Grill the question first** / **Revise the
draft**, and a secondary "More options" question carries **Cancel**
beside `Go Deeper`. The draft's title and link go INTO the question
text, since there is no preview to carry them. Only a selected **Approve &
run** approves the spend. A "None of the above" note that says
"approve" is free text and never an approval. See the goals skill's
`references/codex-seams.md` (fixture "an Other reply on the research
approval gate never approves the paid run").

Parse the `DRAFT_READY {...}` JSON line from `draft`'s stdout (`slug`,
`title`, `url`, `effort`, `contentHash`) to populate the question —
the link you present is that line's `url`, never one you compose
yourself. `draft` also prints a per-section **self-check** (word
counts, UNFILLED markers) — relay it with the go/no-go so thinness is
visible AT the approval moment. Before presenting the go/no-go, run
`evie-kit humanizer lint` over the draft file (the `humanizer`
skill's countable de-slop checks, EVA-67) and fix what it flags — the
draft is outbound-bound prose, and delivered reports have shipped with
leaked citation artifacts before; lint the DELIVERED report the same
way when relaying it (research output is machine prose, exactly where
the artifact-class errors show up).

**`approve` records the user's reply — so it cannot precede one.**
The turn that runs `draft` ends with the go/no-go question; `approve`
and `start` happen in a LATER turn, after the user has answered it.
Running draft-approve-start in one breath is not a workflow, it's the
agent approving its own homework: `approve` exists to write down a
human decision, and at draft time that decision does not exist yet.
When the go does arrive, record it mechanically — `approve --slug
<slug>` (or `start --approved-hash <contentHash>`) — then `start
--slug <slug>`; the detached worker delivers on completion — watch
`evie-kit research status --slug <slug>` or the artifacts
themselves.

**⛔ Approval binds to the exact draft revision (EVA-64).** The gate is
mechanical now: `draft` checkpoints a content hash, `approve` records
the user's go FOR THAT HASH, and `start` refuses a fresh dispatch whose
working copy hashes differently — naming the sections that changed
since the approved revision. **Any redraft voids prior approval**: a
rebuilt draft is a different artifact, even under the same slug, and an
earlier go does not carry onto content the user never saw. A gate
refusal (dispatch gate or approval gate) STRENGTHENS the need to
re-ask — fixing the draft to satisfy a refusal produces a new revision,
so re-present it and re-approve; never treat the old go as still live,
and never reach for `--pre-approved` to route around a refusal.

**Do not skip the approval even if the user said "go ahead" before the
draft existed** — the draft must exist and its link must be in front of
them. There is NO pre-draft approval that carries over: standalone
`start` runs only after the user has seen THIS draft's `DRAFT_READY`
link (and effort) and approved it — a "go ahead" given before drafting
approved a question, not the artifact that will be executed. This holds
for every phrasing of advance consent — "consider this my approval",
"just run it, don't make me confirm again", "dispatch it once drafted".
Those authorize the _question_; what gets executed is the _draft_, and
they haven't seen it. The honest response is to draft, present the
link, and say why you're asking anyway (approval binds to the artifact
revision, not to intent). In particular, `--pre-approved` is NOT the
mechanism for a user's in-conversation advance consent — it exists
solely for the charting-ratified wayfinder path below, and using it to
honor a "don't ask me again" converts a recorded audit escape into the
exact incident this rule was written after.

**The one autonomous exception — wayfinder research tickets** (the map
is the consent boundary): a charting-ratified research ticket may draft
AND execute within its stated question/scope when the project sets
`research.autoExecute: true`. A ticket's optional `effort` field (or the
project's `research.effort` default) is a ceiling auto-execute must
refuse to exceed. Standalone research keeps the draft-first contract
regardless of the setting. Mechanically this path is what
`--pre-approved` exists for: it bypasses the revision gate **with a
recorded note** on the checkpoint — `--approval-note` is REQUIRED
(name the ratifying ticket; the CLI refuses a noteless bypass) and
`--approved-hash` cannot be combined with it. An audit trail, not a
silent skip.

## `approve`

```bash
evie-kit research approve --slug <slug> [--note <provenance>] [--repo ...]
```

Records the user's go for the draft's CURRENT working copy: prints the
per-section self-check (what is being approved, with word counts and
UNFILLED markers), hashes the body, and persists the approval onto the
checkpoint. Run it AFTER the user has seen the draft and said go —
never before presenting. `APPROVAL_RECORDED {slug, hash, at}` on stdout
confirms it. Refuses when the slug was already dispatched (nothing left
to approve) and when the working copy is missing.

## `start` / `status` / `deliver`

```bash
evie-kit research start --slug <slug> [--timeout <minutes>] [--effort <level>] [--approved-hash <hash>] [--pre-approved [--approval-note ...]] [--notion-db ...] [--repo ...]
```

`start` requires `--slug` (from the `draft` output). It submits the Exa
run, spawns the detached poll worker, and returns immediately — the
actual run (5-40+ minutes) happens out of process; on completion the
worker delivers in-process (local draft + Notion mirror) and writes a
status stub under `~/.evie-kit/cache/exa/`. Pass the same
`--notion-db`/`--repo` you drafted with so delivery targets the same
database.

**The dispatch gate (EVA-54 + EVA-64).** `start` REFUSES before the
billable submit — mechanically, never heuristically — on three
independent checks:

1. **The payload.** The Exa output schema is rebuilt at submit time
   from the checkpoint's `formatInputs` (`--input`) ALONE — the
   rendered draft text is never sent, and neither `--focus`,
   `--desired-output`, `--out-of-scope`, nor hand-edits to the draft
   file reach the run. A content-bearing format whose checkpointed
   inputs cannot steer the schema (`report` without `focusAreas`,
   `comparison` without options + criteria, `discovery` without
   criteria) refuses outright: the only remedy is re-drafting with a
   real `--input`.
2. **The review render.** Sections of the draft's LOCAL working copy
   still carrying the template's exact placeholder strings refuse,
   named one by one — those sections are the record the human approval
   is given on. Edits made on the Notion mirror are never read back;
   the refusal prints the scanned path.
3. **The approval (EVA-64).** The working copy's CURRENT content hash
   must carry a recorded approval — from `approve`, or granted at
   start via `--approved-hash <hash>` (matching revisions only) or
   `--pre-approved` (recorded escape, see above). A mismatch names the
   changed sections and asks for a re-present + re-approve.

`start` also prints the **sanitization lint** (warn-only): internal
names and issue keys found in the dispatched fields — the
curious-stranger rule, mechanized. Warnings never block; they exist so
a leak is a decision, not an accident.

Deliberate exemptions: the comparison/discovery drafts' "system prompt
is generated at submit time" note is not a must-fill (submit really
does generate it), and resuming an already-submitted run never gates —
that run is already paid for.

```bash
evie-kit research status --slug <slug>
```

Ad-hoc, info-only: a TERMINAL disk stub (completed/failed) is
authoritative, and so is `mirror_failed` (EVA-101: the RUN succeeded
and the report is on disk locally — only the Notion mirror push
failed; the printed retry is `deliver --uri <uri>`, which pushes just
the mirror with no Exa involvement); a nonterminal `timeout` stub (the
worker gave up while the run may still be live server-side) falls
through to one non-blocking Exa probe.

```bash
evie-kit research deliver --uri <uri> [--result-path <path>]
```

The idempotent safety net: no-ops when the record is already fully
delivered, retries JUST the Notion mirror for a `delivered_local` run
(no Exa credential or poll needed; a repeated mirror failure still
EXITS NONZERO with a mirror-scoped message — the report is safe on
disk, and the nonzero exit means the MIRROR still needs a retry, never
that the run failed), and RESUMES a run whose worker died mid-flight
or timed out —
`--result-path` is optional because a dead worker wrote no stub. `start`
is likewise retry-safe: a submitted checkpoint reuses its run (one Exa
submission ever — retries re-spawn the delivery worker, never re-bill).

## `bulk` — many reports in one submission (EVA-99)

```bash
evie-kit research bulk <envelope.json> [--dry-run] [--ledger <path>] [--notion-db ...] [--repo ...]
```

The one-item-at-a-time lifecycle costs 3N invocations for N reports,
which is what pushes consumers into one-off scripts that re-implement
this CLI's validation badly. `bulk` takes an **operations envelope** —
one JSON document holding an ORDERED array of namespaced operations,
Elasticsearch-bulk style:

```json
{
  "defaults": { "format": "report", "effort": "medium" },
  "operations": [
    {
      "op": "research.draft",
      "slug": "vector-stores",
      "title": "Vector Store Options",
      "summary": "Which vector store fits agent memory at our scale…",
      "input": { "focusAreas": [{ "subject": "Pricing", "body": "…" }] }
    },
    { "op": "research.approve", "slug": "vector-stores" },
    { "op": "research.start", "slug": "vector-stores" }
  ]
}
```

- **Slugs are explicit and declared.** A `research.draft` item NAMES its
  slug; later items in the same file reference it. That is also what
  makes a re-run idempotent.
- **Validation covers the WHOLE file before any side effect** — title
  grammar, depth floors, effort tiers, the selected format's own `input`
  shape, unknown fields, unread default keys — and reports every broken
  item at once, each named by its position. An invalid envelope creates
  nothing.
- **`defaults` fill unset per-item fields.** Shared `format`, `effort`,
  `category` (validated against the declared vocabulary, EVA-151;
  `namespace` is retired and refuses with a teaching message), `tags`;
  any item may override. `defaults`
  deliberately never reaches `research.start`'s `effort`: that field is a
  submit-time RE-pricing of an already-approved draft, so it must be
  written on the start item itself or the approval would refuse a draft
  nobody edited. A default nothing in the file reads is an error, not a
  no-op.
- **Failure is partial and reported, never atomic.** Each item gets a
  ledger row (`done` / `skipped` / `failed` / `withheld`), streamed as it
  settles; prior items stay done and independent later items still run.
  The ledger is written under `.evie-kit/runs/bulk/` (or
  `--ledger <path>`) — including a PARTIAL one if the run is interrupted,
  so what was already paid for is never lost — and a run with any failure
  exits 1.
- **Re-runs are slug-keyed and safe.** Already-drafted slugs are
  `skipped` — `bulk` NEVER redrafts (that would discard hand-edits and
  void approvals; use `research draft --slug` for a deliberate redraft).
  Already-approved revisions are skipped, and a run that was already
  submitted is RESUMED — its delivery worker re-spawns, with no second
  purchase — so an envelope whose first attempt died after the billable
  submit is repaired by re-running it rather than by leaving bulk for the
  single-item verb. Delivered records are skipped outright.

**Approval is not weakened, only regrouped.** A `research.approve` item
is INTENT, not approval. When the run reaches the first approve item it
renders ONE grouped confirmation listing every affected item with its
own Notion link and its per-section self-check, all pre-selected;
deselecting an item withholds it (recorded `withheld`, and its
`research.start` is then skipped). Every EVA-64 rule still binds: the
link is in the question, a redraft between the confirmation and the
execution VOIDS that item, and dispatched slugs stay immutable. An
approval is only ever recorded for a revision a human confirmed in THIS
run — if a draft moves after the run decided nobody needed to look at it,
that item fails closed rather than being stamped. In a non-interactive
context (no TTY, or `CI` set) the run refuses **before creating
anything** and names the items that needed a human — there is
deliberately no approve-all flag, and no `--pre-approved` on this
surface. Two ordering rules follow from the confirmation showing real
links: every draft an approve item names must appear ABOVE the first
approve item, and one slug may carry only one approve item (the picker is
keyed by item, so a second could never be answered separately). An
envelope breaking either refuses with that instruction.

**`--dry-run` is the billing guard.** It validates, resolves and plans
every item — one line each, including which runs it WOULD pay for — with
zero side effects and zero outbound calls. There is no second
"really dispatch N?" gate: approval already authorizes dispatch, and
re-asking is the nag failure mode.

Only `research.draft` / `research.approve` / `research.start` ship as
operations today. The envelope core is generic and the op names are
namespaced, so a future family reads the very files written now.

## `entity-profile` — quick person/org lookup

A completely separate, synchronous command — not part of the async
lifecycle. One fast Apollo lookup (falling back to an Exa search) that
writes straight to Notion and returns in seconds.

```bash
evie-kit research entity-profile --identifier <email|domain|linkedin-url|name> [--kind person|org] [--title ...] [--context ...] [--category ...] [--tags ...] [--notion-db <id>]
```

- `--identifier` is heuristically classified: contains `@` → email,
  contains `linkedin.com` → LinkedIn URL, bare-domain pattern → domain,
  otherwise a name.
- `--kind` defaults to `org` for domains, else `person`.
- A real Notion database **must** resolve (configured notion output or
  `--notion-db <id>`) — there is no local-only mode; `--notion-db none`
  is rejected here.
- No approval ceremony — it's a direct, immediate, cheap call.

## Writing Good Research Content

Whatever you put into `--summary` and the `--input` JSON's
`body`/`systemPrompt` fields is sent to Exa, which searches the public
web. Keep these rules in mind:

**Explain what Exa won't know.** If the research involves internal
projects, niche organizations, or people who aren't well-known public
figures, provide detailed context directly in the relevant
`body`/`--summary` text. Exa can only find what's publicly indexed.

**Never include sensitive or confidential information.** Research
content is sent to a third-party API. Anything under NDA, trade
secrets, proprietary architecture details, or private personal
information must not appear in `--summary` or `--input`. Frame the
research around the public-facing aspects.

**Abstract away internal names, acronyms, and doc references.** The
research provider has no idea what an internal project name, issue key,
or doc id refers to. Mentioning them pollutes the prompt with noise the
model can't act on and may hallucinate context for. Describe the
_capability_ or _system shape_ abstractly instead:

- ❌ "Research how EVP should handle credential rotation"
- ✅ "Research how a multi-agent platform should handle credential
  rotation for long-lived automation processes"

**Strip internal cost comparisons and benchmarks.** "Provider A cost
$1.46 and provider B produced better output" is internal evaluation
data — it doesn't help answer the question and leaks business
information.

**Rule of thumb:** if a curious stranger read your research question
over your shoulder, they should understand what you're asking without
access to your private docs. About to type an internal acronym? Stop
and describe the underlying concept.

**Ask the user when unsure.** If you can't explain something properly,
or you're uncertain whether a detail is confidential — ask before
proceeding. Don't guess and don't execute research with vague
instructions.

**Estimate in relative effort, never calendar time** (EVA-21, the
goals SKILL.md convention). When a research question asks for
build-vs-buy verdicts or implementation-effort assessments, instruct
the draft to size options RELATIVE to each other (t-shirt sizes on the
fixed Fibonacci scale: XS=1, S=2, M=3, L=5, XL=8, XXL=13), and
translate any calendar-time estimate a delivered report contains
("BUILD at 12–18 weeks") into that scale when summarizing or acting on
it. Public-web sources assume human teams; agent-executed work makes
their wall-clock numbers meaningless, while relative size survives the
translation.

**Be specific in `report` focus areas / `comparison`-`discovery`
criteria.** Each should scope a concrete question, not name a topic.
"Vector stores" is too vague; "Compare Pinecone, pgvector, and Weaviate
for agent memory — pricing, latency, hybrid search support, operational
complexity" gives Exa something to work with.

**Unwrap prose written directly to external surfaces** (EVA-66, the
goals SKILL.md convention). The pipeline's own Notion delivery is
paragraph-correct (`markdownToBlocks` soft-break normalizes via
`@evie-kit/core/prose`), but anything you compose and send
DIRECTLY — a Notion page edit or Linear comment via MCP tools — must
be written unwrapped (one line per paragraph), never pasted from
hard-wrapped repo markdown: Linear and Notion render intra-paragraph
newlines as visible line breaks. When quoting a wrapped file, pass it
through `unwrapProse` first. Better yet, for structured Notion writes
from local markdown, skip raw MCP composition entirely: `evie-kit
notion upsert <file.md>` (paragraph-correct, surgical) and `evie-kit
notion patch --page <id> <selector> …` (edits only addressed blocks)
are the tool-shaped counterpart of this rule (EVA-71; selector grammar
in `packages/notion/docs/selector-grammar.md`).

**Length targets** (based on production examples):

- `--summary`: 150-300 words (two dense paragraphs)
- `report` focus areas (`body`): 80-150 words each, 3-8 areas
- `comparison`/`discovery` criterion `description`: 2-3 sentences
- `comparison` option `description`: enough to explain what it is and
  why it's in scope

**Effort tiers vs format complexity** (EVA-19 finding, recorded for the
cheap-tier follow-up): `report` prompt complexity is tuned for the
default/higher tiers — on the cheaper `exa-agent` tiers (`minimal`/
`low`), prefer FEWER focus areas (2-3 tightly-scoped ones) rather than
the full 3-8. Fewer, not thinner: each body still carries the full
80-150-word register — a cheap tier economizes on breadth (how many
questions), never on depth (how well each is posed), because a
thin question wastes the cheap run just as surely as the expensive
one. Dedicated cheap-tier formats are a candidate follow-up goal, not
something to improvise per run.

## Naming Convention

Titles are ≤35 characters, capitalized (`researchTitleGrammar` in
`@evie-kit/research`'s `research-input.ts` is the authority). No
domain prefix required — grouping is `--category`'s job (the declared
vocabulary; it names the folder AND the Notion Category select value).
