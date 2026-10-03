# Review results-006

Blind multi-tool review wave for `SEM-3-cross-account-messaging` (2026-10-03T18:48:15.528Z).
Each reviewer ran as a labeled tab in the executing session's own herdr
workspace. Model/effort/summary/args columns record per-reviewer
provenance (summary = codex `model_reasoning_summary`, EVA-58; effort =
`claude --effort`, codex reasoning, or pi's `--thinking` level, EVA-243);
`(default)` means nothing was passed and the harness kept its own default.
Per-tool output dirs are machine-local since EVA-59 (gitignored raw
dumps) — the FINDINGS.md links resolve only on the machine that ran the
wave, and only until the goal worktree is reaped; the committed record
is this INDEX and its merged findings, so reconcile BEFORE the record
outlives the raw output.

**ROSTER NARROWED** — this round ran with fewer engines than its configured baseline roster (claude-code, codex, sonarqube, coderabbit, fable): claude-code (excluded by the frontmatter engines override). A narrowed round is a recorded, visible act — never a silently shrunken gate.

Round purpose: **verification** — this round checked a fix batch rather than hunting fresh defects, so it is EXEMPT from the results-round budget (EVA-90, grill Q4; the earning-through-rounds-3-4 shape of EVA-40/EVA-80). What it verified: C1-C6 fix batch

All reviewers completed.

Wave notes:

- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/BRIEF.md:39:1 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:16:43 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:17:18 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:18:19 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:19:22 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:24:28 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/PROMPT.md:47:25 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/screen.txt:2:10 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/screen.txt:4:17 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/claude-code/screen.txt:49:9 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:16:43 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:17:18 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:18:19 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:19:22 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:24:28 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/codex/PROMPT.md:47:25 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:16:43 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:17:18 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:18:19 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: goals/SEM-3-cross-account-messaging/reviews/goal-001/pi-gemini/PROMPT.md:19:22 adds a home-folder path — rewrite it repo-relative before the lock
- home paths: … 107 more (`evie-kit names home-paths --base main` lists them)
- codex: AUTO-ANSWERED interactive prompt (EVA-157 allowlist): codex-updater: answered "2" to › 1. Update now (runs `npm install -g @openai/codex`) | 2. Skip
- SHORT round (EVA-273): codex never started reviewing, and nothing else failed — this round is recorded short in ROUND.json and does not consume the round budget (up to the hard ceiling of short rounds). Rerun the leg in place before committing anything, so it reviews the same HEAD: `evie-kit goals review retry-leg --tool codex`.
- retry-leg (EVA-273): codex rerun in place at 2026-10-03T19:06:00.936Z — it was stalled, now completed. The failed attempt's evidence is kept in .retries/codex-attempt-1/. The round now stands as an ordinary round of its purpose and counts toward its ceiling. RECONCILE: merge codex's new findings into the merged table below. It is an interactive reviewer that audited the gate receipts: add its posture to the Gate evidence roll-up, and rewrite any observations it added under Reviewer observations as neutral summaries.
- codex: AUTO-ANSWERED interactive prompt (EVA-157 allowlist): codex-updater: answered "2" to › 1. Update now (runs `npm install -g @openai/codex`) | 2. Skip


| Tool | Outcome | Findings | Model | Effort | Summary | Args | Detail |
|---|---|---|---|---|---|---|---|
| codex | completed | [FINDINGS.md](codex/FINDINGS.md) | gpt-6-astra | high | detailed |  |  |
| sonarqube | completed | [FINDINGS.md](sonarqube/FINDINGS.md) | (default) | (default) | (default) |  |  |
| coderabbit | completed | [FINDINGS.md](coderabbit/FINDINGS.md) | (default) | (default) | (default) |  |  |
| fable | completed | [FINDINGS.md](fable/FINDINGS.md) | claude-fable-5-1 | high | (default) |  |  |
| claude-code | excluded | — | | | | | excluded by the frontmatter engines override — see the roster banner |

## Merged findings

Reconciled by the executor on 2026-10-03. This round verified the C1–C6 fix
batch (`6891407`, `edc02f2`, `8ceb6de`, `3545680`, `37a914d`, `b528b5c`)
against head `d9ce1e4`. Every engine ran: fable, CodeRabbit and SonarQube in
the wave, and codex on its in-place retry. On its first attempt, codex's
startup updater dialog was answered by typing the menu into the composer, so
the agent never received the review; the retry, on the pinned codex-cli
0.159.3, reviewed the same head. No reviewer found C1–C6 unfixed. The round
raised two new majors from codex, two minors and two nits from fable, and one
minor from CodeRabbit. All were accepted and fixed after the round, at
`51ffef1` through `7481cbe`. Those fixes have not been re-reviewed. That
review belongs to the split review the planner has pending.

| # | Severity | Category | Location | Finding | Raised by | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | major | risk | `linux/container.sh:316` | `userdel` removes each fixture user's empty private group (`USERGROUPS_ENAB yes`, confirmed in the pinned image's `login.defs`), so the following `groupdel` exits 6 and teardown, including the rehearsal's recovery teardown, stops. | codex #1 | Fixed `51ffef1`: each group is reconciled after its user goes (absent is recorded as removed with its user; present must still be ours). The macOS script gets the same reconcile. Mock-tested with `userdel` modelled to remove the group. |
| 2 | major | risk | `controller.mjs:398` | A signal during Redis startup saw no handle, skipped the stop and wrote a clean receipt; a signal mid-provisioning could purge while the main flow kept writing. | codex #2 | Fixed `eb6943f`: the child is reported the moment it spawns and is stopped by cleanup; a signal cancels the run, cleanup waits for in-flight provisioning, and purges only if provisioning began. A dev run interrupted during readiness exits 143, stops the child and writes a clean receipt. |
| 3 | minor | footprint | `results/GATES.md:13` | Not-yet-run gates were labelled WAIVER with no recorded waiver. | fable #1 | Fixed `7481cbe`: relabelled PENDING. Gate 6 keeps the WAIVER shape, which the receipts template prescribes for a review in flight. |
| 4 | minor | footprint | `lib/service.mjs:212` | On Linux, container root cannot search the service's 0700 directory, so the ownership receipt recorded EACCES for two entries. | fable #2 | Fixed `809e5d9`: those entries are stat-ed as the service identity. |
| 5 | nit | risk | `lib/checks.mjs:384` | The identity-switch check rebuilt the launch argv by hand. | fable #3 | Fixed `a365b5d`: it takes the argv from `launch.mjs`. |
| 6 | nit | risk | `linux/container.sh:48` | A listing exits 0 with no file lines when its hash tool is missing. | fable #4 | Fixed `c6ba294`: both listings refuse a missing tool and staging refuses a listing without file lines. |
| 7 | minor | footprint | `reviews/goal-002/pi-gemini/PROMPT.md:16` | The planner's goal-review records carry home-folder paths. | CodeRabbit #1 | Fixed `144cb6b`: repo-relative or `<home>/…`; `evie-kit names home-paths --base main` now reports none. |

SonarQube reported 0 open issues in this goal's diff; the 12 S2970 issues from
results-005 closed with the helper rename. Its 71 other open issues are
preexisting in `packages/*`. The quality gate passed.

## Notes for the next agent

Each lane's observations about the codebase that did not become findings
(EVA-264), copied from its FINDINGS.md. At reconciliation, route the ones
that outlast this goal through the retrospective's "What I learned" table
(`evie-kit learnings add`), phrased as facts about the code, never as
what a reviewer said; the rest stay here as the round's record.

- **fable**: `checks.mjs` treats GIDs 12 and 61 as the only implicit macOS memberships; a `dscl`-created account may carry other computed groups on a given host, and the identity check reports any other group as a manifest mismatch.
- **fable**: The `personal-home-boundary` check expects every personal home under `/Users` to deny a directory listing; a home created with mode 755 fails it, and the contract forbids changing home modes to pass.
- **fable**: Container root in the Linux leg has no DAC_OVERRIDE or DAC_READ_SEARCH: anything root must read or delete beneath a non-root 0700 directory has to go through `setpriv` as that uid, as `empty_owned_dirs` already does.
- **fable**: The candidate archives live under the gitignored `releases/` tree; the consumer `package-lock.json` resolves its `file:` entries only inside a staged checkout that carries them.
- **fable**: `linux/container.sh listing` runs on the macOS staging host for the Linux leg, so it depends on the Mac's own `sha256sum` on the script's fixed PATH.
- **fable**: `lib/tar.mjs` reads ustar entries and GNU long-name headers; a pax extended header is skipped and the following entry keeps the truncated name from its ustar header, which only matters if an archive path exceeds the ustar limits.
- **fable**: `redis.clientList()` filters out the administrator's own connections, so a case that counts connections sees only participant users.

## Reviewer observations

Judgments about past choices the diff cannot fix (EVA-284) — the model's
expense, whether the goal should have been inline — copied from each
lane's FINDINGS.md with a stable id. They are NOT findings: they stay out
of the merged findings and their totals, and out of advisory scoring. At
reconciliation, rewrite each Observation cell as a neutral one-line
summary (what was observed, never who is to blame) and keep every id;
the retrospective's "Observation responses" answers each one before the
lock, and answering one never opens another review round.

| Id | Raised by | Observation |
| --- | --- | --- |
| results-006/fable/1 | fable | GOAL.md has no risk-register section; the code's visible risks are handled in prose. |
| results-006/fable/2 | fable | The SonarQube slot covers `packages/`, so for a change confined to `conformance/accounts` it reports not-applicable. |
| results-006/fable/3 | fable | The fixture has not run under a real identity, and post-provisioning fixes, reruns and the teardown audit will need review beyond the two-round results budget. |
| results-006/fable/4 | fable | The Linux cloud leg is a self-contained deliverable that could have been reviewed and landed separately. |

## Gate evidence

Asked: fable and codex, the interactive reviewers. CodeRabbit and SonarQube
are headless and were not asked to audit gates (not applicable). Both read
the receipts at `d9ce1e4`, whose tested commit was `b528b5c`.

| Gate | Re-verified by | Accepted on evidence by | Missing or stale |
| --- | --- | --- | --- |
| 1 Identities | — | fable, codex | pending; no live run |
| 2 Access checks | — | fable, codex | pending; no live run |
| 3 Matrix | codex counted 100 inventory ids (not execution evidence) | fable, codex | pending; no live run |
| 4 Static checks | fable and codex re-ran ShellCheck and `sh -n`/`bash -n`; fable re-ran `terraform fmt`/`validate` and the Ansible syntax checks | both, on ancestry (delta touched `goals/**` only); fable could not run `ansible-lint` in its environment | live lifecycle, cleanup and audit pending; codex noted #1 and #2 affect this gate |
| 5 Lint gate | codex re-ran `npm run check:docs`; fable re-ran `prettier --check` | both, on ancestry and scope | — |
| 6 Review | — | fable, codex | in flight |
| 7 SEM-2 mapping | — | fable, codex | pending; depends on gates 1–4 |

Fable flagged the WAIVER label on pending gates (#3). Both noted that the
receipts carry no claim of a live pass. The receipts were refreshed at
`144cb6b` after the round's fixes (`7481cbe`).
