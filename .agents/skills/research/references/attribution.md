# Attribution

Ported (EVA-19) from the OpenClaw workspace's private research skill —
the only oc skill that referenced evie-kit code. Its `cli.ts`,
`pipeline-factory.ts`, and `poll-worker.ts` moved into
`@evie-kit/research` as the `./cli` export (`evie-kit research …`),
and its SKILL.md instructions were adapted here for Claude Code / codex
agents:

- Discord approval cards became the `AskUserQuestion` go/no-go picker
  (link embedded in the question — the lifecycle-seam contract).
- The `--namespace` → `~/.openclaw/config/notion.yaml` database lookup
  became settings-driven routing (`storage.research.outputs` +
  `tools.notion`), with `--notion-db` as the per-run override.
- The `openclaw cron add` completion wake and `gtimeout` wrapper did not
  port (oc runtime concepts); the detached worker delivers in-process
  and completion is observed via `research status`/the artifacts.
- The operational scar tissue ported intact — above all the #1 rule
  (never bare `draft` for report/comparison/discovery), the discovery
  `categories` gotcha, and the writing-good-research-content rules.
- The oc skill's `RESEARCH-DRAFT-TEMPLATE.md` and `templates/`
  artifact-lifecycle files were retired pre-pipeline machinery
  (superseded by the checkpoint pipeline's own draft path) and stayed
  behind; `schemas/deep-research.ts` ported as the package's
  `research-input.ts`.

The oc-side skill becoming a thin consumer of the same CLI is a
recorded follow-up in that workspace, not this repo's scope.
