# Non-goals and follow-ups

> Moved verbatim from `SKILL.md` (EVA-78 progressive-disclosure
> restructure). Mentions of other sections may point at `SKILL.md`'s
> summaries or at sibling files in `references/`.

## Non-goals (explicitly deferred, this pass)

- Notion as a review surface (only Linear in this pass; EVA-19 wired
  Notion only as a research-artifact DESTINATION via
  `storage.research.outputs`).
- Hindsight write-through on goal/research completion (retrieval landed
  in EVA-19 — `evie-kit hindsight recall`, the grounding ladder's
  episodic rung; the WRITE path stays deferred).
- Codex/OpenCode/Pi as _executors_ (only Claude Code executes goals in this
  pass; Codex participates only as a **reviewer**).
- Spawning reviewers as managed tmux sessions when the executor runs
  outside herdr (only the herdr path is wired in this pass).
- Tracker-canonical wayfinder maps (map/tickets living natively in Linear,
  as upstream wayfinder does) — a per-project config axis later; local
  file-tree maps only in this pass.
- Tailscale port exposure / SQLite-vs-Postgres storage flexibility (tracked
  separately; not required for this pass while Postgres is already
  available).
- Composable Basic Memory + Hindsight memory layering (EVA-19 made the
  config shape ready — `tools.memory.basicMemory` is a recognized
  settings kind — but the search-client integration is its own
  follow-up goal).
- The "subprocess authenticates back to the OpenClaw gateway to notify/wake a
  channel" primitive — for this pass, notify/wake for a goal running under
  direct OpenClaw orchestration can rely on OpenClaw's existing in-process
  cron/message-wake mechanisms; a detached-subprocess-calls-back-in variant
  is out of scope.

## Follow-ups (tracked, not in this skill's current scope)

- **`loopFolder` → `goalFolder` rename** in `@evie-kit/coding-agent`
  (breaking API change to a reviewed, tested package — file, types,
  function names, and possibly the `loop-YYYYMMDD-HHmmSS-slug` naming
  pattern itself). Needs its own goal.
