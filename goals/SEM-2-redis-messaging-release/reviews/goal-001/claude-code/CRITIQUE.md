---
agent: claude-code
model: claude-opus-5-5
reasoning_effort: high
round: 1
timestamp: 2026-09-23T13:45:46-05:00
verdict: not_ready
findings: 24
---

## Summary

The goal is the right shape: extract a finished increment, prove it again on
fresh evidence, and hand off a candidate without merging or publishing. The
owner decisions (Chore, messaging only, 0.3.0) are recorded and I do not
re-ask them. Four things stop me from calling it ready. First, "0.3.0" is
already the identity of the HTTP proxy checkpoint. It is pushed to origin as
`checkpoint/0.3.0`, has archives under `releases/0.3.0/` with the same file
names the new candidate will produce, and was an earlier owner decision.
The Q3 briefing checked npm only. Second, green gate 5 cannot pass as
written: this repo sets no `tools.lint`, and the evie-kit gate formula
returns red whenever that key is unset. Third, the proxy range before
`baa06dc` contains non-proxy fixes (OTel export budgets, Redis observer
fencing, a messaging telemetry diagnostic). The spec says nothing about
whether they ship, and at least one increment test depends on one of them.
Fourth, gate 6 builds release archives before landing, but the repository's
release process tags the verified commit on main. Unless landing preserves
that commit, the archive evidence is thrown away. Most other points are
engineering details the executor can resolve, provided the goal names the
rule in advance.

## Plan holes and risks

Evidence refs: main `3ec254e`, feature `5b565ac`, messaging base `baa06dc`,
merge base `67ed8cc` (= `v0.2.0`). Paths prefixed `F:` are read with
`git show 5b565ac:<path>`.

**Promotion blockers**

1. **The version 0.3.0 collides with an existing, pushed identity.**
   `git branch -a` shows `remotes/origin/checkpoint/0.3.0` and local
   `checkpoint/0.3.0`, both at `72292c5` ("test(proxy): stabilize
   cross-runtime regressions"). Every package in that tree is version
   0.3.0 and includes `@semaphile/proxy`. The local
   `releases/0.3.0/manifest.json` records `"commit": "72292c5…"` with
   `semaphile-core-0.3.0.tgz`, `semaphile-redis-0.3.0.tgz`,
   `semaphile-messaging-0.3.0.tgz` and `semaphile-otel-0.3.0.tgz`. The new
   candidate will produce those exact file names with different bytes.
   `.scratch/docs/PROGRESS.md:60` marks "HTTP proxy 0.3.0 source
   checkpoint" complete. `.scratch/docs/decisions.md:1328` records the
   earlier owner decision "Use 0.3.0 for the HTTP milestone and 0.4.0 for
   MCP". The feature's `CHANGELOG.md` ("## 0.3.0 — source checkpoint"),
   `README.md:62,202` and `SPEC.md:728` ("## 18. HTTP proxy (0.3.0)") say
   the same. The grilling Q3 briefing (`grilling/session-001-20260923.md:44-46`)
   rested on "live npm version listings contain no 0.3.0", and baseline.md
   says no remote feature branch exists but leaves out that origin carries
   `checkpoint/0.3.0`, `checkpoint/0.4.0`, `feat/http-proxy` and
   `feat/mcp-proxy`. I am not re-asking the version. The goal still needs
   safeguards: never overwrite or reuse `releases/0.3.0/` (it is copied
   into worktrees; this draft worktree has one); write the new archives to
   a distinct path; state in the handoff that two different 0.3.0 source
   identities exist; say what version the proxy line would take if it
   lands later. Whether the planner re-confirms with the owner, given the
   omitted fact, is the planner's and owner's call. It should not be left
   to the executor.
2. **Green gate 5 is unachievable in this repo as written.**
   `.evie-kit/settings.ts` and `.evie-kit/settings.local.ts` define no
   `tools.lint`. The linked evie-kit `decideGateStatus` returns
   `red: "no fast tier is configured (tools.lint is unset) — nothing was
   linted"` (`packages/goals/src/lintReceipt.ts:151`), and `runFastTier`
   is `ok` only when `runs.length > 0` (`packages/lint/src/fastTier.ts`).
   The gate also treats `bun run lint` as that fast tier. Here,
   `bun run lint` is the root `package.json` script: an npm-per-package
   oxlint chain (`package.json:10`), which is a different thing. So
   `evie-kit lint gate` can never exit 0 or 3 on this repo today.
   Configuring `tools.lint` means editing a committed settings file, which
   is outside this goal's product scope. Either do it as a prerequisite
   change before promotion, or rewrite gate 5 around the repo's own
   commands. Separately, `lint:types` and `format:check`, both part of the
   historical verification (`.scratch/docs/handoffs/20260914-0922-redis-messaging-complete.md`
   "Verify" block), appear in no gate.
3. **Non-proxy fixes in the proxy ancestry are left undecided, and one
   increment test depends on them.** The 17 commits in `67ed8cc..baa06dc`
   include `ca43c96` (fix(telemetry): separate export and close budgets),
   `1b56123` (isolate retries and fence observers), `780406a` (unref idle
   exporter) and `c9ac5cc` (fix(redis): invalidate lost observer
   ownership). None of them is proxy work and none is on main. An
   extraction starting at `baa06dc` drops them. The 0.3.0 candidate would
   then lack fixes that were present in every tested build of the feature
   line, and neither CHANGELOG would say so. Step 1 of the scope only
   covers dependencies messaging *needs*. There is a concrete one:
   `F:conformance/otel/messaging.mjs:183-191` (blamed to `ca43c96`) asserts
   `invalidDiagnostics` equals `['trace-dropped']` for an invalid baggage
   allowlist. The increment runs that same file against Redis through
   `F:conformance/redis/messaging-otel.mjs` (`process.argv.push('--redis');
   await import('../otel/messaging.mjs')`). Copying the file from the
   feature ref without `ca43c96`'s `packages/messaging/src/telemetry.ts`
   hunk fails the suite. Deleting the assertion silently drops coverage.
   Whether these fixes ship is a scope decision (see open question 1).
4. **Archives are built before landing, but the release process tags the
   verified commit on main.** On main, `docs/releases.md` step 1 is "Merge
   reviewed changes…", step 2 builds "the same commit" on both platforms,
   and step 6 is "Tag the verified commit `vX.Y.Z`, push main and the
   tag". Gate 6 builds archives from the candidate head, before the
   orchestrator lands it. If landing is a squash or a merge commit,
   `release.json`'s commit never appears on main. The owner then has to
   rebuild, and gate 6's evidence is discarded. Any commit made after
   packing (a review fix, a results summary) causes the same problem. The
   goal must either require a landing strategy that preserves the
   candidate commit (fast-forward), or move archive assembly after landing
   (open question 5).

**Risks the executor can resolve if the goal names the rule**

5. **Proxy residue lives inside the increment's own files, not only in its
   ancestry.** 14 files overlap between `67ed8cc..baa06dc` and
   `baa06dc..5b565ac`: `CHANGELOG.md`, `README.md`, `SPEC.md`,
   `package.json`, `conformance/run.mjs`, `conformance/otel/messaging.mjs`,
   `docs/README.md`, `docs/comparison.md`, `packages/messaging/package.json`,
   `packages/messaging/package-lock.json`, `packages/messaging/src/cli.ts`,
   `packages/messaging/src/cli-options.ts`, `packages/redis/package.json`
   and `packages/redis/package-lock.json`. The increment's
   `packages/redis/package-lock.json` hunk adds a `../messaging` entry that
   lists `"@semaphile/proxy": "file:../proxy"` as a devDependency and
   `"@semaphile/proxy": "0.4.0"` as a peer. The root `package.json` build,
   lint and typecheck lines name `packages/proxy`. `conformance/run.mjs`
   carries the `proxy` suite and `export-timeouts`. `F:tools/check-docs.mjs`
   lists `packages/proxy/*.md`. None of this cherry-picks cleanly. Gate 4's
   leak check ("exports, commands or peers") should extend to lockfiles,
   root scripts, the conformance runner, SPEC, CHANGELOG, README and docs
   text.
6. **Lockfile regeneration can drift the tested dependency set.** The
   per-package npm lockfiles need 0.3.0 and proxy removal. A plain
   `npm install` re-resolves transitive dependencies, including
   `@redis/client` and the OTel SDK. Require
   `npm install --package-lock-only` (or an equivalent), plus a lockfile
   diff showing that only `@semaphile/*` entries changed.
7. **Strict readiness conflicts with least-privilege accounts.**
   `F:packages/redis/src/messaging-connection.ts:189-239` runs
   `CONFIG GET appendonly appendfsync no-appendfsync-on-rewrite maxmemory-policy`
   and `INFO persistence` on every `open()`. Restricted ACL users normally
   lack `+config|get`, which is in `@admin`/`@dangerous`. Redis ACLs cannot
   limit `CONFIG GET` by parameter, and `CONFIG GET` can return sensitive
   values such as `requirepass` and `masterauth`. Many managed Redis
   offerings disable `CONFIG` entirely. So the worked two-account recipe
   hits a predictable fork. Strict mode either refuses every restricted
   participant, or the recipe tells operators to grant a command that can
   reveal secrets. Warn mode emits a readiness warning on every open. This
   is a documentation-posture decision the executor should not make alone
   (open question 4). Also, `recover()` does not re-run readiness
   (`messaging-connection.ts:246-290`); the docs should say so.
8. **What happens when a permission is denied is not defined.**
   `recover()` treats only `STATE_LOST`, `FORMAT` and `CONFIG_MISMATCH` as
   fatal (`messaging-connection.ts:~267-273`). A `NOPERM` on the notify
   channel or on `EVALSHA`, or `WRONGPASS` after an ACL change, retries
   forever at the 10-second cap. On initial `open()`, a denied subscribe
   surfaces whatever `@redis/client` throws, which may not be a stable
   `MessagingError` code. Gate 3 says "including readiness permission
   failures" without listing the expected results. List them per case:
   missing key pattern (`~<root>` / `~<root>:*`), missing `&<root>:notify`,
   missing scripting commands, missing `CONFIG|GET`/`INFO` under warn and
   under strict, and permissions revoked mid-session. Otherwise the
   executor finds this mid-flight and has to decide whether normalizing
   errors counts as new product contract (open question 7).
9. **Cross-host evidence depends on private, off-worktree infrastructure.**
   The historical six cross-host cases used
   `/Users/openclaw/src/divideby0/semaphile/.scratch/run-messaging-crosshost.py`
   with a remote Linux host and SSH tunnels (completion handoff, "Verify").
   The goal does not name that host setup or check it is available at the
   start. The stop clause covers an unavailable platform, but that is only
   discovered at the end. Add a preflight step at the start.
10. **There is no rule for which suites rerun after review fixes.** Gates 4
    and 6 require "final source identity", and round-2 review fixes change
    the head. Historically, only the CLI and installed-consumer suites were
    rerun after fixes. Lint has an eligibility rule ("descent plus nothing
    exercised changed"); conformance and archives have none. Either require
    the full matrix on the final head, or state which suites must rerun for
    which changed paths.
11. **"Native-free Redis-only installation" needs a checkable definition.**
    `F:packages/redis/src/messaging-connection.ts:3` imports `MessagingError`
    at runtime from `@semaphile/messaging/client`, so a Redis-only install
    must include `@semaphile/messaging`. Per main's `docs/releases.md`, that
    tarball ships native targets. Redis and messaging now declare each
    other as optional exact peers, a cycle
    (`F:packages/redis/package.json`, `F:packages/messaging/package.json`).
    Gate 6 should adopt the historical definition: the installed consumer
    runs with native binaries and SQLite implementation files deleted and
    core absent (completion handoff, "Current state").
12. **SPEC section numbering.** Main's `SPEC.md` ends at §17. The feature's
    §20 comes after proxy §18 and §19 (`F:SPEC.md:728,799,844`). Keeping
    the number 20 leaves a gap. Renumbering breaks "§20" references in
    receipts, decisions and docs. The goal should pick one rule. It should
    also say that §18's `startExecution()` note stays out.
13. **Upgrade instructions must cover the pilot's 0.4.0 artifacts, not only
    0.2.0.** The managed-session handoff
    (`.scratch/docs/handoffs/20260922-2242-evie-managed-session.md:77-79`)
    records pilot use of matching 0.4.0 artifacts. Going to 0.3.0 is a
    numeric downgrade. Semver ranges will not select it, and exact peers
    force replacing all packages at once. The 0.4.0 identity is also
    already doubled: `releases/0.4.0` was built from `c7a8795`, while the
    feature packages at `5b565ac` also say 0.4.0. Gate 6 and step 5 mention
    "upgrade instructions" but name only the 0.2.0 path.
14. **The docs gate checks the wrong things.** `tools/check-docs.mjs`
    checks only links and privacy (home paths, IPv4, private links). It
    does not compare docs against exports. Gate 2's "public docs and
    exports match the candidate" needs a real comparison, for example each
    package's `exports` map and the imported module keys against the
    feature minus proxy and `http-policy`. Main's `README.md` and
    `docs/releases.md` also say "0.2.0 is published". The candidate docs
    must describe 0.3.0 without claiming it is published, and the handoff
    must list flipping that wording as an owner action at publication.
15. **Review gate and push authority depend on unstated or machine-local
    state.** Gate 7 mixes the AGENTS.md §5 `codex exec` blind review with a
    "configured review gate". The engine roster (codex, claude-code,
    sonarqube, coderabbit) lives in gitignored `.evie-kit/settings.local.ts`,
    which the planner handoff says is temporarily overridden for this
    critique round. The goal does not say whether the executor may push
    the candidate branch to origin and open the PR. Main's
    `docs/releases.md` says "The repository and release assets are public",
    so pushing makes unreleased source public. Step 5 only says "an
    accessible PR is the orchestrator's landing seam".
16. **The goal lacks the metadata that goal-conditions requires.**
    `.evie-kit/conventions/goal-conditions.md` asks for a turn- or
    time-bounded stop clause, and every gate's proof must appear in the
    transcript. The stop clause has no bound, and the frontmatter has no
    size.

## Green-gate checkability

1. **Extraction and baseline preserved.** Checkable, but "shared
   dependencies accounted for" is vague. Sharpen it to a table covering
   all 17 commits in `67ed8cc..baa06dc`, plus every hunk in the 14 files
   listed in hole 5. Each row gets included, excluded or rewritten, with
   the reason. Also require
   `git diff 3ec254e <head> -- .evie-kit .claude .agents .codex AGENTS.md EVIE-KIT.md`
   to be empty, to show main's setup survived.
2. **SPEC §20 and docs/exports.** Only partly checkable. "Contract
   comparison" should mean: the diff of the §20 text between `F:SPEC.md`
   and the candidate is empty apart from listed cross-reference or
   numbering edits, plus an export-map comparison script. "Passing
   documentation checks" should name `check:docs` and `format:check`. As
   hole 14 explains, `check:docs` cannot prove that docs match exports.
3. **Separate-account ACL recipe.** Checkable once the expected result of
   each permission case is listed (hole 8), and the Redis server version
   is pinned. Locally it is `redis-server v=8.4.0`; the Lua preflight
   needs Redis 7+ (`F:docs/redis-messaging.md:194`). Without that list,
   "works" cannot be decided.
4. **Regressions on macOS/Linux × Node/Bun, cross-host, SQLite 1.2.**
   Checkable in principle. Gaps: the runtime pins are left to "the
   execution plan". Locally, macOS has Node 22.21.1 and 22.11.0 via mise,
   and 22.11.0 is below `engines >=22.18.0`. Pin 22.21.1 or name the
   version to install. "Applicable" and "prior limiter regressions" do not
   name suites; list the `conformance/run.mjs` suites (core, redis,
   messaging, administration, otel). There is no rerun rule after fixes
   (hole 10), the cross-host host has no preflight (hole 9), and the leak
   check is too narrow (hole 5).
5. **Typecheck, fast tier, deep tier.** Not achievable today (hole 2). The
   formula is precise; the repo config cannot satisfy it. Sonar is set up
   only in machine-local settings (`sources: "packages"`), so the change
   set is in scope and "not applicable" cannot be claimed. That needs a
   reachable server or a disclosed waiver.
6. **Archives at 0.3.0.** Checkable (hashes, metadata, install receipts),
   but it needs: a distinct output path so `releases/0.3.0/` is never
   overwritten (hole 1), a definition of native-free (hole 11), landing
   that preserves the commit (hole 4), and a check that no archive lists
   an `@semaphile/proxy` peer or dependency.
7. **Fresh review and configured review gate.** Only partly checkable,
   because "the configured review gate" is not named and depends on
   machine-local settings (hole 15). Name the engines and the pass
   condition. Also define "as large as the first" (finding count, or
   accepted-finding count) so the split trigger can be evaluated.
8. **No publication, merge, proxy, Sentinel, adapter or registry.**
   Checkable from the final diff, the tag list and `npm view`. Add "no
   new pushed tags" and "no write to or deletion of `releases/0.3.0/`,
   `releases/0.4.0/`, `checkpoint/*` or `feat/*` refs". Whether pushing
   the candidate branch is allowed must be stated (hole 15).

## Sizing sanity

No size is declared: the frontmatter has no t-shirt or Fibonacci field, so
nothing can be checked against it. My estimate is L, about 13 points. The
reasons: a 62-file extraction where 14 files overlap the excluded range and
need hand reconciliation; lockfile regeneration; new ACL, readiness and
two-account documentation with tested permission cases; a five-cell
runtime matrix (four historical pairings plus Node 22/macOS) and six
cross-host cases on off-worktree infrastructure; archives assembled from
native binaries on two platforms; two review rounds; a Sonar deep tier.
It would drop to about 8 if archive assembly and the release handoff moved
after landing (hole 4). It would grow if the non-proxy fixes are included
(open question 1), because their OTel suites (`export-timeouts`,
`redis-observer`) join the matrix.

## Open questions and grill suggestions

1. The proxy history before `baa06dc` contains four non-proxy fixes that
   are not on main: OTel export and close budgets (`ca43c96`), exporter
   retry isolation (`1b56123`), idle exporter unref (`780406a`) and Redis
   collector ownership fencing (`c9ac5cc`). Should 0.3.0 include them with
   their tests? If excluded, the release ships without fixes that every
   tested feature build had, and one Redis messaging telemetry test must
   be adjusted.
2. Version 0.3.0 is already used by the pushed `checkpoint/0.3.0` branch
   (the HTTP proxy) and by local archives in `releases/0.3.0/` with the
   same file names the new candidate will produce. Keeping 0.3.0 as
   decided, how should the old identity be handled? Options: leave the
   branch and archives as they are and disclose two 0.3.0 identities;
   archive the old artifacts under another name; or have the owner rename
   or annotate the remote checkpoint branch. And what version would the
   proxies take if they land later?
3. The lint gate needs `tools.lint` configured, and this repo has none.
   Options: add it as a separate committed settings change before this
   goal is promoted; allow this goal's executor to add it; or replace gate
   5 with the repo's own `lint`, `lint:types`, `typecheck`, `format:check`
   and `check:docs` commands plus Sonar evidence.
4. For restricted separate-account Redis users, strict readiness needs
   `CONFIG GET`, which can also reveal server secrets such as
   `requirepass`. What should the recipe recommend? Options: grant
   `+config|get +info` and document the exposure; use warn mode for
   participants and have the operator verify persistence once with an
   admin account; or treat it as a gap needing a product change and
   return.
5. Should release archives be built on the candidate head, which requires
   the orchestrator to land it by fast-forward so the tag matches the
   verified commit? Or should archives and the release handoff be built
   after landing, in a follow-up step or goal?
6. May the executor push the candidate branch to the public
   `semaphile/semaphile` origin and open the PR? Or does the orchestrator
   own every push, given that pushing publishes unreleased source?
7. If a restricted account hits an ACL denial, some paths currently retry
   forever or surface a raw driver error. Is changing that to a stable,
   terminal error in scope as a bug fix? Or must behavior stay as it is,
   documented, with any change going back to the owner?
8. Is the Linux host used for the historical cross-host runs available for
   this goal, and should the executor check it at the start rather than
   discover it at the end?

## Wayfinder signal

`consider-wayfinder`. The work is not foggy; the dependency audit above
already maps most of it. It does have a natural seam: landing. Phase A
(extraction, SPEC, docs, ACL recipe, source matrix, review, PR) is one
coherent deliverable. Phase B (0.3.0 archives on both platforms, installed
checks against the exact archives, release handoff) is only valid once
the landed commit is known, per `docs/releases.md` steps 1, 2 and 6. Run
as one session, the likely failure is that phase B evidence gets
invalidated by a review fix or a non-fast-forward landing. The goal's own
stop clause already expects a possible split.

## Promote-readiness verdict

`not_ready`. What blocks promotion: (1) the 0.3.0 identity collision with
the pushed `checkpoint/0.3.0` and the local `releases/0.3.0/` archives has
no handling rule, and the owner's choice was briefed on npm evidence
alone; (2) green gate 5 cannot pass because `tools.lint` is unset and the
gate formula returns red; (3) whether the non-proxy fixes in the excluded
range ship is undecided, and an increment test depends on one of them;
(4) archive evidence can be invalidated by how the branch lands. Holes
5–16 are engineering details the executor can resolve once the goal
states the rule.

CRITIQUE COMPLETE
