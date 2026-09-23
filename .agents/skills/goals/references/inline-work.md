# Inline work: the ask, the record, the candidate issue (EVA-92)

The rule itself — an interactive session asks before doing work it
judges small enough to finish inline, and the two silences that count
as failures — lives in `SKILL.md` ("Proportionality: not every edit is
goal-sized"). The canonical option set lives in that file's
"Lifecycle seams are pickers" list. This file holds the operating
detail: what belongs in the briefing, what each record shape is for,
how the candidate related issue gets resolved, and what happens after
the answer.

## The briefing before the picker

Seam pickers carry the did/deciding/impact briefing (`grill-me`'s
explain-first discipline). For this seam the briefing states, as
prose:

- **What would be done inline** — the concrete scope: which files,
  what the edit is, and anything it deletes or reverses. Concrete
  scope is what lets the user judge whether a small change is
  consequential; a bare "it's tiny" does not.
- **BOTH costs, sized against each other, plus the inline path's turn
  horizon** — the inline size and the goal size on the relative-effort
  scale (XS=1, S=2 …), and how much of this session the inline path
  eats: "inline XS, done in this turn; as a goal, S". Both sizes,
  because the user is choosing between them and one number alone is
  not a comparison. The turn horizon, because "how long" is the
  question the rule was born from and turns are what it means here —
  the agent's private "small enough to finish in a turn" is worthless
  until it is said out loud. Never a wall-clock estimate: scope
  discussions size in relative effort (EVA-21), and "about five
  minutes" smuggles in the human-team assumptions that scale exists to
  keep out — a turn count says the same thing in the unit that
  actually applies to an agent session.
- **Why this record shape is recommended** — one line, since the
  recommended option is per instance rather than fixed.
- The standing note that a reply asking for more depth is always
  honored through the picker's free-text channel, whenever the
  rendered set has no free slot for `Go Deeper`.

## Small is not the same as safe

The agent is the party least able to tell whether a small change is
consequential, so the briefing's scope line is written AFTER checking,
not before. Before calling a deletion or a flag flip trivial, run the
repo-wide check that would falsify it (who else reads this file, what
else references this value). The pattern that motivated the rule: a
two-line compose-file deletion read as obviously safe and had its
conclusion nearly reversed by one repo-wide grep.

## The record shapes

The inline path splits into three record shapes beside the full-goal
escape. There is no fixed policy about which applies — the human
decides per instance, at the seam the ask already creates (grilled
decision, EVA-92 session-002). What each one is for:

**Inline, comment on `<KEY>`** — the work is a clarification, a
correction, or a small tweak of something an ALREADY-TRACKED change
shipped. This is the common shape for post-lock touch-ups: a goal
merged, reality disagreed slightly, the fix is two lines. The comment
goes on that issue, so the issue's own thread keeps the whole story
and no new record competes with it. Resolution of the candidate is
the agent's job, below.

**Inline, new issue** — the work stands on its own and is likely to be
looked up later: it touches code, it changes something user-visible,
or a future goal will want to cite it. The write goes through the
active tracker (`tools.tracker.*`) — the Linear MCP issue/comment
call, or `gh issue …` for a GitHub-tracked project — never through
`goals promote`, which is goal machinery and would want a goal folder
that does not exist here.

**Inline, no record** — the commit message is the record. Correct for
work with no future reader: a typo, a wrapping fix, a comment
rewording. Choosing this is a decision, not an omission; it just
leaves no tracker artifact behind.

**Open a goal instead** — the escape. It is never dropped from the
rendered set, with one exception: a user directive that already ruled
the goal path out ("just fix it inline") leaves the record-only
question, and re-offering the path they just declined would be the nag
failure — see Boundaries. Chosen, it drops straight into `/goals
draft` with the same description the briefing already stated; nothing
about the inline ask short-circuits intake, grilling, or the review
gate.

### Order of operations, per record shape

The tracker write and the commit have to be sequenced, because this
project's commit convention carries the issue key in the subject
(`{type}({scope}): … (EVA-N)`). Left unsaid, two of the three shapes
have no key at the moment the commit is written. So:

| Shape          | Sequence                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| comment on KEY | The key is known before the work starts: do the work, commit carrying `(KEY)`, then comment on that issue linking the commit.                                                                                                                                                                                                                                                                                                 |
| new issue      | Create the issue FIRST — one tracker call — then do the work, commit carrying its key, then close the issue with a comment linking the commit. It is still a record of work performed rather than a request; creating it first is what makes the commit's key real.                                                                                                                                                           |
| no record      | Commit with NO key. Among POST-promotion work this is the one sanctioned keyless commit — sanctioned precisely because the user chose "no tracker artifact", and a fabricated key would be worse. (Pre-promotion draft commits are keyless too, for the different reason that the key does not exist yet — EVA-62's draft policy.) Everything else about the convention (type, scope, imperative subject, 50/72) still holds. |

**Where the commit lands** is part of what the briefing states, not
something this file can decide: inline work commits on whatever branch
the session is on, and when that is the default branch the briefing
says so plainly — committing straight to the default branch is exactly
what the live precedent below did, and it is the user's call to make
knowingly rather than the agent's to make quietly.

## Resolving the candidate related issue

The comment option NAMES its issue rather than asking the user to
remember which goal shipped the thing being tweaked (user addendum,
EVA-92 session-002).

**A candidate is an already-tracked change that MERGED.** Two kinds
qualify, and they are checked differently:

- **A goal that is both MERGED and LOCKED.** The settled scope is
  "work that was just recently performed and MERGED but needs to be
  tweaked a little after the goal has locked", and both halves carry
  weight. Locked (`completed` in its frontmatter) is why a comment is
  the right shape: the record is immutable, so a follow-up has nowhere
  else to go. Merged is why the follow-up exists at all — until a
  goal's changes reach the default branch there is nothing on that
  branch to tweak, so the locked-but-unmerged window (routine, since
  the executor stops at lock and the merge is the orchestrator's later
  step) is NOT a candidate: a comment there would attribute work to a
  diff the reader cannot see yet.
- **A tracker-only issue that merged.** Small work recorded through
  this rule's own "inline, new issue" shape has an issue and no goal
  folder. A later tweak of that work is the plainest possible "related
  existing issue", so it stays eligible — nothing about the goal
  lifecycle applies to it, and there is no lock to check.

The trigger is work that touches the FILES OR THE BEHAVIOR such a
change shipped. Those are two different searches, and the behavior one cannot
be run with `git log`: a follow-up that corrects what a goal shipped
often lands in a different file than the goal did (its config, its
test, its docs, its caller). Route 1 is the behavior route; route 2 is
the file route; they are independent, and route 1 is not a fast path
for route 2.

1. **The session's own recent context — a BEHAVIOR match, no file
   overlap required.** When this conversation just MERGED or cleaned
   up a goal, and the work in front of you adjusts what that goal
   shipped, that goal is the candidate even when the edit lands
   somewhere its diff never touched. This is the route that catches
   "we just merged that threshold retune and one of the numbers is
   wrong", and no log query would have found it. Merge or cleanup
   only: a goal this session merely REVIEWED, or watched lock, has not
   shipped anything to the default branch, and step 3 will reject it —
   route 1 is a way to find a candidate, never a way to skip the
   checks.
2. **The commit history of the touched paths — a FILE match.** Issue
   keys ride commit subjects (`{type}({scope}): … (EVA-N)`) and merge
   subjects (`merge: EVA-N — …`), so the default branch's log for the
   paths the inline work touches yields keys newest-first — and
   reading the DEFAULT BRANCH is what makes every key it returns a
   merged one:

   ```bash
   git log -n 15 --format='%h %ad %s' --date=short main -- <touched paths>
   ```

   **When the two routes disagree, route 1 wins**: a behavior match
   says what the work is FOR, while a file match is circumstantial —
   the same file gets touched by unrelated goals. The other route's
   key goes in the briefing as a runner-up, one free-text reply away.
   Within route 2, several distinct keys are taken newest-first, and
   the first one that survives step 3 is the candidate — not the
   newest key regardless of what it turns out to be.

3. **Check the key, in three steps.** A key in a commit subject
   proves nothing on its own — it may name a goal, or a tracker-only
   issue this very rule minted through "inline, new issue".

   **3a — is it merged?** Something carrying the key has to be
   reachable from the default branch. Route 2 has already shown this
   when it fired; route 1 has not, so check:

   ```bash
   git log -n 1 --format='%h %s' main --grep='<KEY>'
   ```

   Silence means not merged. For a goal, that is the locked-but-
   unmerged window — recommend waiting for the merge rather than
   walking to an older key. For anything else, it is not a candidate.

   **3b — is there a goal behind it?**

   ```bash
   ls -d goals/<KEY>-*/ 2>/dev/null
   ```

   Run this before the frontmatter read: with no such folder, a glob
   passed straight to `awk` fails loudly under the default shell (zsh
   refuses an unmatched glob outright) instead of producing the
   silence the next step reads. No directory means a TRACKER-ONLY key
   — an issue with no goal folder. That is still a candidate: an
   earlier inline "new issue" is exactly the "related existing issue"
   this option exists to keep the story on, so offer it when the work
   plainly relates to what that issue recorded. Only 3c applies to
   goals.

   **3c — for a goal, is it locked?** Read its own frontmatter, scoped
   to the frontmatter block so a body line mentioning `completed:`
   cannot fake a lock:

   ```bash
   awk '/^---$/{n++; next} n==1 && /^completed:/{print FILENAME; exit}' goals/<KEY>-*/GOAL.md
   ```

   Output means locked, and with 3a already passed the goal is a
   candidate. Silence means the goal is still EXECUTING — the work
   belongs inside it, on its branch. Do not ask `evie-kit goals
completed` this question: it is a paged VIEW (10 per page), so it
   answers "no" for every locked goal past the first page.

When nothing survives, the comment option does not render: the picker
shows the three-option set (_Inline, new issue / Inline, no record /
Open a goal instead_) and the briefing says why in one line — no
candidate at all, a goal still executing (recommend folding the work
into it), or a locked goal not yet merged (recommend waiting for the
merge). The picker never asks the user to supply an issue key from
memory.

Live precedent, from the day the rule was decided (2026-08-04): the
EVA-85 post-merge threshold retune landed as an inline commit on main
plus a follow-up comment on EVA-85's issue — the exact shape the
comment option canonizes, resolved by route 1.

## Boundaries

- **Interactive sessions only.** Executors never raise this seam; an
  adjacent small fix inside an executing goal's own scope is scope
  discipline (`SKILL.md`, the NON-pickers list).
- **A human instruction is already the answer — for the axis it
  actually answers.** The seam decides TWO things: the size question
  (inline or goal) and, on the inline side, the record shape. "Open a
  goal for this" settles everything, since the goal path has no record
  choice. "Just fix it inline" settles only the size question: it
  names none of the three record shapes, so the turn skips the
  inline-vs-goal comparison and asks the record question alone (the
  applicable inline shapes, no _Open a goal instead_ — the user just
  ruled it out). "Fix it inline, no issue" settles both and the work
  simply proceeds. Asking a question the user already answered is the
  nag failure mode; answering one they did not is the silent-decision
  failure this rule exists to remove — an unwanted tracker write is a
  real cost, and so is a missing record they expected.
- **Once per piece of work.** Follow-on tweaks inside a scope the user
  already approved ride that approval rather than re-asking.
- **The inline path is still ordinary repo work**: house conventions
  (conventional commits, prettier on every edited markdown file, the
  branch rules) apply unchanged, with the single documented exception
  of the keyless commit the "no record" shape requires — see Order of
  operations. What the inline path skips is the goal LIFECYCLE, not
  the standards.
