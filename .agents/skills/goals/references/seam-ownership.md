<!-- GENERATED — do not edit; bun run --filter @evie-kit/goals build -->

# Seam ownership matrix (EVA-218, ADR 0022)

Which ROLE owns each seam the goals skill names, what the owning
session may do there, and where the answer goes when it is planning
work. The canonical record is `packages/goals/src/seamOwnership.ts`;
this file is its projection, and `seamOwnership.test.ts` asserts set
equality against the seam bullets in `SKILL.md`.

The rule: operational investigation and launch configuration stay
with the orchestrator; a requirements change produces a written
planning request the user opens in the planner. The lifecycle verbs'
own operational metadata writes to `GOAL.md` (`plan --accept`'s
`execution`/`review` fields, the completion stamps) are orchestrator
work; problem, scope and gate changes are the planner's. A seam that
fires in the wrong role is a DEFECT, never a fallback. Every
orchestrator picker is written for a cold reader: the facts listed
per seam go INSIDE the question text, absent cases stated.

### Inline-vs-goal ask (`inline-vs-goal`)

- **Trigger owner:** either interactive role
- **Decision owner:** either interactive role
- **Permitted action:** Raise the size ask before doing the work, in whichever interactive role the work reached; a PLANNER may then do inline work or draft, an ORCHESTRATOR may do inline OPERATIONAL work (a launch config fix, an env repair) but never inline planning work
- **Planning handoff:** a planning request for NEW work (`goals requests write`, no `--goal`)
- **Wrong role:** An orchestrator asked to change requirements inline is a wrong-role trigger: it writes a planning request (no goal key yet for new work) instead of drafting; an executor raising this ask at all is a defect (executors never ask, EVA-92)
- **Cold-reader facts inside the question text:**
  - the concrete scope: which files, what edit
  - both paths sized on the relative-effort scale plus the inline turn horizon
  - absent cases stated: 'no goal or branch exists yet for this work'

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Inline, comment on <KEY> | `inline-comment` | a merged tracked change (locked goal or tracker-only issue) is the candidate | Do the work, commit carrying (KEY), comment on that issue linking the commit | none — the answer is operational |
| Inline, new issue | `inline-new-issue` | always | Create the issue first through the tracker, do the work, commit carrying its key, close it with a comment | none — the answer is operational |
| Inline, no record | `inline-no-record` | always | Do the work; commit with no key — the commit message is the record | none — the answer is operational |
| Open a goal instead | `open-goal` | always | In a PLANNER: drop into /goals draft with the same description. In an ORCHESTRATOR: write a planning request for new work; the planner drafts | a planning request for NEW work (`goals requests write`, no `--goal`) |

### Hybrid-intake confirmation (`hybrid-intake`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Echo the understanding and ask whether to create the draft
- **Planning handoff:** none — the answer is operational
- **Wrong role:** Intake in an orchestrator is a defect: it never drafts; it writes a planning request for new work

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Create the draft | `create-draft` | always | Capture intake byte-for-byte and scaffold the draft | none — the answer is operational |
| Just thoughts, don't create | `just-thoughts` | always | Create nothing | none — the answer is operational |
| Let me rephrase | `rephrase` | always | Wait for the restated description | none — the answer is operational |

### Post-intake (`post-intake`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Flow into the first grill question; offer a goal review only when an engine is staged
- **Planning handoff:** none — the answer is operational
- **Wrong role:** Never fires in an orchestrator (it has no intake)

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Straight to grilling | `straight-to-grilling` | an engine is staged for goal reviews | Ask the first grill question | none — the answer is operational |
| Run a goal review on the raw draft first | `goal-review-raw` | an engine is staged for goal reviews | Run a goal-review round on the unrefined draft | none — the answer is operational |

### Grill ending (`grill-ending`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Promote, keep grilling, run an ADHD pass or a goal review, park
- **Planning handoff:** none — the answer is operational
- **Wrong role:** Grilling in an orchestrator is a defect: it never grills; a re-grill need becomes a planning request on the existing goal

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Promote now | `promote-now` | always | Run the intake review gate and goals promote | none — the answer is operational |
| Keep grilling (name the sub-topic) | `keep-grilling` | always | Continue the interview | none — the answer is operational |
| Run an ADHD pass | `adhd-pass` | the refinement is open-ended | Spawn the ideation frames on the draft | none — the answer is operational |
| Run a goal review | `goal-review` | an engine is staged for goal reviews | Run a goal-review round | none — the answer is operational |
| Park the draft | `park-draft` | always | Leave the draft local | none — the answer is operational |

### Promotion seam (goal-review offer) (`promotion-offer`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Offer one goal-review round before promotion when engines are staged and none consumed the latest spec
- **Planning handoff:** none — the answer is operational
- **Wrong role:** Promotion in an orchestrator is a defect; promotion is the planner's user-triggered act

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Run a goal-review round first | `review-first` | always | Run the round, then return to promotion | none — the answer is operational |
| Promote directly | `promote-directly` | always | goals promote | none — the answer is operational |

### Goal-review consensus (`goal-review-consensus`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Read the consensus; promotion stays a user action
- **Planning handoff:** none — the answer is operational
- **Wrong role:** Never fires in an orchestrator (goal rounds are pre-promotion planning)

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Promote now | `consensus-promote` | always | goals promote | none — the answer is operational |
| Another goal-review round | `another-round` | always | Run one more round | none — the answer is operational |
| Keep refining | `keep-refining` | always | Return to grilling or direct edits | none — the answer is operational |

### Map shape (`map-shape`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Fires inside goals promote (EVA-236). It needs a draft with wayfinder/MAP.md and a declared tools.tracker.linear.hierarchy. The verb stops with exit 2, the four shapes, and the team's epics with descriptions. The PLANNER briefs the user and recommends the best-matching epic, saying why. It then re-runs promote with --map-shape, plus --epic or --initiative. It never creates an epic unasked, and never creates an initiative.
- **Planning handoff:** none — the answer is operational
- **Wrong role:** An orchestrator promoting is a defect (the post-promotion row). An executor never promotes. Under hierarchy.mode "always" the seam does not render, and a map whose ## Tracker records a shape is placed, so neither raises it.
- **Cold-reader facts inside the question text:**
  - the map's title and destination, and its tickets (name, type, size, blocked-by)
  - each shape's consequence: an epic created (named, described from the destination) / an existing epic joined / the map as an issue with related or sub-issues per ticket
  - the candidate epics BY NAME WITH THEIR DESCRIPTIONS, and which one the planner recommends and why
  - the initiative the epic would be linked under, or 'no initiative declared'
  - absent cases stated: 'the team has no epics yet', 'no default shape is declared'

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Create a new epic for the map | `create-epic` | always | Re-run goals promote --map-shape create-epic [--epic <name>] [--initiative <name>]: a Linear project named from the map is minted and the map's issue filed into it | none — the answer is operational |
| Attach the map to an existing epic | `attach-epic` | always | Re-run goals promote --map-shape attach-epic --epic <name> [--initiative <name>]: the map's issue files into that project; an unknown name refuses, never creates | none — the answer is operational |
| One issue for the map, related issues for its waypoints | `related-issues` | always | Re-run goals promote --map-shape related-issues: one issue per ticket, related to the map's issue, blocks edges from the blocked-by notes | none — the answer is operational |
| One issue for the map, sub-issues for its waypoints | `sub-issues` | always | Re-run goals promote --map-shape sub-issues: one sub-issue per ticket under the map's issue, blocks edges from the blocked-by notes | none — the answer is operational |

### Post-promotion (`post-promotion`)

- **Trigger owner:** planner
- **Decision owner:** either interactive role
- **Permitted action:** The PLANNER raises it right after promotion. 'Execute now' hands the goal to the orchestrator's launch seam; 'Review on the issue first' keeps the planner on the tracker issue; 'Hold' parks it
- **Planning handoff:** none — the answer is operational
- **Wrong role:** An orchestrator promoting is a defect; an orchestrator executing a promoted goal is its ordinary work

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Execute now | `execute-now` | always | Hand off to the orchestrator: goals plan then goals execute run there (the launch right-sizing seam) | none — the answer is operational |
| Review on the issue first | `review-on-issue` | always | The PLANNER stays with the user on the tracker issue: read comments, revise the spec through a re-grill, re-promote nothing (the issue already exists) — spec edits are planning work | none — the answer is operational |
| Hold | `hold` | always | Leave the goal promoted and unlaunched | none — the answer is operational |

### The re-grill seam (`re-grill`)

- **Trigger owner:** either interactive role
- **Decision owner:** planner
- **Permitted action:** The ORCHESTRATOR observes the trigger (an adoption landed, an unblock event woke the holder) and writes a planning request on the existing goal; the PLANNER offers the picker and re-grills
- **Planning handoff:** a planning request on the existing goal (`goals requests write --goal <KEY>`)
- **Wrong role:** An orchestrator re-grilling is a defect: it records the request; the planner grills

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Re-grill it (name what changed) | `regrill` | always | PLANNER: run grill-me against the goal with the change named | a planning request on the existing goal (`goals requests write --goal <KEY>`) |
| Execute as specced | `execute-as-specced` | always | ORCHESTRATOR: proceed to the launch seam | none — the answer is operational |
| Park | `park` | always | Leave the goal promoted | none — the answer is operational |

### Launch right-sizing (`launch-right-sizing`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** Run goals plan, brief it cold, accept the plan (an OPERATIONAL GOAL.md write: execution/review fields and plan_accepted — orchestrator work), then goals execute. Never edit problem, scope or gates here
- **Planning handoff:** a planning request on the existing goal (`goals requests write --goal <KEY>`)
- **Wrong role:** A planner launching executors is a defect; a scope change discovered while sizing becomes a planning request
- **Cold-reader facts inside the question text:**
  - the goal key AND title
  - the full <KEY>-<slug> branch name
  - what the goal PROPOSES (scope), marked as proposed — nothing has shipped
  - the plan read: size, code-vs-docs, risk surfaces with excerpts
  - what each option gives up (a skipped wave, a degraded pairing)
  - absent cases stated: 'no plan recorded yet', 'no review has run'

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Launch with this plan | `launch-with-plan` | always | goals plan <KEY> --accept, then goals execute | none — the answer is operational |
| Adjust the plan | `adjust-plan` | always | Re-run goals plan with adjusted flags; a change to the SPEC is a planning request instead | a planning request on the existing goal (`goals requests write --goal <KEY>`) |
| Launch with the defaults | `launch-defaults` | always | goals execute without a recorded plan | none — the answer is operational |

### Post-wave (`post-wave`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** After INDEX.md reconciliation, when the wave is the user's to act on: fix, re-run, or accept — operational
- **Planning handoff:** a planning request on the existing goal (`goals requests write --goal <KEY>`)
- **Wrong role:** A finding that changes requirements (not a defect fix) is planning work: write a planning request on the goal
- **Cold-reader facts inside the question text:**
  - the goal key AND title
  - the full <KEY>-<slug> branch name
  - which round just reconciled and what it found, by severity
  - which findings are defect fixes and which are requirements changes (those become planning requests)
  - how many finding rounds the budget still allows
  - each option's consequence
  - absent cases stated: 'the round found nothing', 'no review has run'

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Fix the merged findings | `fix-findings` | always | Steer the executor (or a follow-up executor) to fix; operational | none — the answer is operational |
| Run another wave | `another-wave` | always | goals review | none — the answer is operational |
| Accept and proceed to completion | `accept-proceed` | always | Let the executor complete | none — the answer is operational |

### Wayfinder escalation (`wayfinder-escalation`)

- **Trigger owner:** planner
- **Decision owner:** planner
- **Permitted action:** Chart a map, keep one goal, or split by hand — drafting-time planning
- **Planning handoff:** none — the answer is operational
- **Wrong role:** An orchestrator discovering an oversized goal mid-execution writes a planning request on the goal; it never charts

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Chart a wayfinder map | `chart-map` | always | Write wayfinder/MAP.md in the draft | none — the answer is operational |
| Keep it one goal anyway | `one-goal` | always | Continue refining as one goal | none — the answer is operational |
| Split it manually | `split-manually` | always | Draft the pieces as separate goals | none — the answer is operational |

### Unisolated-launch refusal (`unisolated-launch`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** Wait, override with the recorded risk, or implement the environment hook — all operational
- **Planning handoff:** none — the answer is operational
- **Wrong role:** A planner never launches, so this seam never fires there
- **Cold-reader facts inside the question text:**
  - the goal key AND title being launched, and the RUNNING goal's key and title
  - the full branch names of both
  - what 'unisolated' risks concretely (shared services, ports)
  - absent cases stated: 'no environment hook exists in this project'

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Wait for the running goal | `wait-running` | always | Defer the launch until the running goal locks | none — the answer is operational |
| Override accepting the risk | `override-risk` | always | goals execute with the override flag; the risk is recorded in the launch report | none — the answer is operational |
| Implement the environment hook | `implement-env-hook` | always | OPERATIONAL configuration: the orchestrator edits the committed settings.ts worktrees() builder (isolated: true and the service members), commits it on main through the ordinary inline-vs-goal ask, and relaunches; no GOAL.md is touched | none — the answer is operational |

### Lock-report arrival (`lock-report-arrival`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** Acknowledge in one line, hand the record read to a background subagent, bring the merge picker at the next pause. Nothing post-lock runs before the answer
- **Planning handoff:** none — the answer is operational
- **Wrong role:** A lock report landing in a PLANNER is the EVA-217 defect: the resolver refuses unrecorded targets (EVA-218 item 7); a planner that still receives one leaves it unanswered and says so — it never merges
- **Cold-reader facts inside the question text:**
  - the goal key AND title
  - the full <KEY>-<slug> branch name
  - what the branch ships and which packages it touches
  - its stacked_on relation, or 'stacks on nothing'
  - what the reviews found, or 'no review has run'
  - each option's consequence
  - absent cases stated: 'already landed — no new merge to offer'
  - proposed scope kept distinct from shipped behavior

### The merge moment (`merge-moment`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** Raise the picker with the cold-reader facts inside the question text; after 'Merge now', run the deterministic sequence as one background command
- **Planning handoff:** a planning request on the existing goal (`goals requests write --goal <KEY>`)
- **Wrong role:** A planner merging is a defect (and the merge guard refuses executors); a merge that reveals a requirements gap becomes a planning request
- **Cold-reader facts inside the question text:**
  - the goal key AND title
  - the full <KEY>-<slug> branch name
  - what the branch ships and which packages it touches
  - its stacked_on relation, or 'stacks on nothing'
  - what the reviews found, or 'no review has run'
  - each option's consequence
  - absent cases stated: 'already landed — no new merge to offer'
  - proposed scope kept distinct from shipped behavior

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Merge now | `merge-now` | always | goals merge --push, cleanup, reap, the Sonar scan — one background command; relay one line | none — the answer is operational |
| Review the PR first | `review-pr-first` | always | Hold the landing; the user reads the PR | none — the answer is operational |
| Hold | `merge-hold` | always | Leave the locked goal unmerged | none — the answer is operational |

### Post-lock verification failure (`post-lock-verification-failure`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** Investigate operationally; a send-back is a NEW goal, which is planning work
- **Planning handoff:** a planning request on the existing goal (`goals requests write --goal <KEY>`)
- **Wrong role:** An orchestrator drafting the follow-up goal is a defect: it writes a planning request naming the locked goal; the planner drafts
- **Cold-reader facts inside the question text:**
  - the goal key AND title
  - the full <KEY>-<slug> branch name
  - what the branch ships and which packages it touches
  - its stacked_on relation, or 'stacks on nothing'
  - what the reviews found, or 'no review has run'
  - each option's consequence
  - absent cases stated: 'already landed — no new merge to offer'
  - proposed scope kept distinct from shipped behavior

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Send back to the executor (new goal) | `send-back` | always | Write a planning request on the locked goal; the planner drafts the follow-up | a planning request on the existing goal (`goals requests write --goal <KEY>`) |
| Accept with a recorded caveat | `accept-caveat` | always | Record the caveat on the tracker issue (a comment, not a GOAL.md edit — the goal is locked) | none — the answer is operational |
| Investigate together | `investigate-together` | always | Operational investigation in the orchestrator pane | none — the answer is operational |

### Watcher dead-ends (`watcher-dead-end`)

- **Trigger owner:** orchestrator
- **Decision owner:** orchestrator
- **Permitted action:** Kill and relaunch, wait, or inspect — operational
- **Planning handoff:** none — the answer is operational
- **Wrong role:** A planner never watches executors, so this seam never fires there
- **Cold-reader facts inside the question text:**
  - the goal key AND title, the full branch name
  - what the executor was doing (its last handoff or receipt)
  - how many nudges failed and when
  - absent cases stated: 'no handoff recorded yet'

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Kill and relaunch | `kill-relaunch` | always | goals restart | none — the answer is operational |
| Keep waiting | `keep-waiting` | always | Let the watch continue | none — the answer is operational |
| Inspect the session together | `inspect-together` | always | Read the pane with the user | none — the answer is operational |

### The /goals door (bare) (`bare-goals-door`)

- **Trigger owner:** either interactive role
- **Decision owner:** either interactive role
- **Permitted action:** Render the open-goals list and the pending planning requests, ask the fixed-shape question. In a PLANNER the requests band is how orchestrator-side planning work is discovered; an ORCHESTRATOR reads it too but opens nothing
- **Planning handoff:** none — the answer is operational
- **Wrong role:** An orchestrator choosing 'Start a new goal' is a defect: it writes a planning request for new work instead

| Option | id | Renders when | Accepting it does | Handoff |
| --- | --- | --- | --- | --- |
| Start a new goal | `start-new-goal` | always | PLANNER: /goals draft. ORCHESTRATOR: planning request for new work | a planning request for NEW work (`goals requests write`, no `--goal`) |
| Refine an existing one (name it next) | `refine-existing` | always | PLANNER: open the named goal or planning request; goals requests open <id> | none — the answer is operational |
| Just checking | `just-checking` | always | Nothing | none — the answer is operational |

### A user request made in the wrong role (`wrong-role-request`)

- **Trigger owner:** either interactive role
- **Decision owner:** either interactive role
- **Permitted action:** Say which role the request belongs to and route it: planning work asked of the ORCHESTRATOR becomes a planning request (with the goal key when one exists, without one for new work) and the user is told to open it in the planner; lifecycle work asked of the PLANNER is answered with the orchestrator's pane, never done in the planner
- **Planning handoff:** a planning request (`goals requests write`), with the goal key when one exists
- **Wrong role:** Doing the work in the wrong role — an orchestrator grilling, a planner merging — is the defect this row exists to name
