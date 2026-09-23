# Handoffplan Mode (handoff + executable plan)

Escalation mode for turning a handoff into an executable plan for the next
session. Read this only when the trigger in SKILL.md's "Escalation:
handoff + plan" section fires — it extends a completed handoff; it never
replaces one.

Do the full handoff (SKILL.md Steps 1–7) first, unabridged, then:

1. Write a paired `plan-<YYYYMMDD-HHmmSS>-<slug>.md` **next to** the
   handoff — `.evie-kit/handoffs/`, same slug, datestamp first. That
   directory is gitignored and excluded from worktree copies (EVA-41), so
   **the plan is machine-local, exactly like the handoff it pairs with**:
   step 2's commit covers the session's WORK, never the plan, and step 3's
   prompt is valid only for a session on this same checkout. Say so when
   handing over. Anything in the plan that must outlive the checkout —
   a decision, a rejected approach, a constraint — belongs in the goal's
   `results/RESULT.md` or an ADR, per SKILL.md's don't-duplicate rule; the
   plan is the executable scratch copy, not the record. The plan is an
   _action_ document — phased, specific enough to execute without the
   conversation, each phase tracing back to evidence in the handoff ("See
   Evidence & Data in {handoff file}" rather than duplicating tables).
   Include per-phase Files/Validates-with/Rollback, an Anti-Goals section
   (approaches explicitly rejected and why, pulled from the handoff's What
   We Tried / Key Decisions), and a Quick Start with the single first
   concrete action.
2. Commit current work (surgically — only files this session touched).
3. Output a ready-to-paste prompt for the next session: point it at both
   files, tell it to start Phase 1 immediately, and say explicitly **not**
   to onboard or re-explore — the plan has everything.
4. This mode always closes the session — the point is a fresh session
   executes with clean context, not that this session keeps going.

**When the plan must outlive this checkout, this mode is the wrong
ending (EVA-226).** A plan another machine, a fresh worktree, or a
reviewer should see is lifecycle work, and the lifecycle's plan record
is a `GOAL.md`. Take SKILL.md's Step 8 option "Draft a goal from this
handoff" instead: the handoff's Where We're Going becomes the ask, its
rejected approaches become anti-goals, its Open Questions become the
draft's open questions, and `evie-kit goals draft --description-file`
carries them into intake and grilling. Handoffplan mode stays for the
case it was built for — the same checkout, the next session, no review
in between.

This mirrors REMvisual's `claude-handoff` plugin's separate `handoffplan`
skill; we fold it in as a mode of `handoff` rather than a fifth skill,
since it's the same mining process with a different Step 5+ ending. See
`references/attribution.md`.
