# Prose written to external surfaces is unwrapped (EVA-66)

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

Repo markdown is hard-wrapped at ~72 columns (the house prettier
style). CommonMark reads those intra-paragraph newlines as spaces, but
Linear renders them as HARD breaks and Notion keeps them visible — so
wrapped prose pasted verbatim onto an external surface renders with
mid-sentence line breaks. The RUNTIME seams are already covered:
promote-path issue bodies and the notion package's block conversion
pass through `@evie-kit/core/prose`'s `unwrapProse` (join lines
within a paragraph; structure — lists, tables, code, quotes, hard
breaks, frontmatter — preserved).

What the seams CANNOT catch is content an agent composes and sends
DIRECTLY — an issue body or comment via the Linear MCP tools, a page
edit via a Notion MCP call, an `--issue`-escape issue drafted by the
orchestrator. For those, **compose the prose unwrapped in the first
place** (one line per paragraph — never paste hard-wrapped file
content into an MCP call). That composing rule is the portable one:
it needs no tooling and holds in every repo this skill ships to.

**Structured Notion writes go through the CLI, not raw MCP** (EVA-71 —
the composing rule's tool-shaped counterpart). When the content already
lives in (or belongs in) a local markdown file, `evie-kit notion
upsert <file.md>` pushes it paragraph-correct (the unwrap pass is baked
into the render) and surgically (minimal block ops, never a page
rewrite), and `evie-kit notion patch --page <id> <selector> …` edits
only the blocks a selector addresses (grammar:
`packages/notion/docs/selector-grammar.md`); `evie-kit notion diff`
and `evie-kit notion history` show what drifted between local and
live since the last sync stamp. Raw Notion MCP calls remain for what
the verbs don't cover
(reads, comments, databases-as-databases) — hand-composing block JSON
for a page write when a verb could have done it is the mistake to
avoid.

Inside the evie-kit workspace itself (the only place
`@evie-kit/core` resolves — consumer repos get just the linked
CLI), quoting a wrapped file can go through the helper instead. It
preserves frontmatter by design, so strip that before pasting a
GOAL.md body into an external surface:

```bash
bun -e 'import { unwrapProse } from "@evie-kit/core/prose";
const body = (await Bun.file("GOAL.md").text()).replace(/^---[\s\S]*?\n---\n+/, "");
console.log(unwrapProse(body));'
```

Local files stay hard-wrapped (prettier owns the authoring style);
unwrapping happens at the export moment, never in the repo.
