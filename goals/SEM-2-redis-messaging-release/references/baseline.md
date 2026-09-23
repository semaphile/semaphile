# Source baseline and prior evidence

Checked 2026-09-23, primary checkout /Users/openclaw/src/divideby0/semaphile.

- Main and fetched origin/main: 3ec254e25a56daab0e2546f75cd38804df40f44c.
- Feature: 5b565ac9bef4ff569ac0e21726947fec279323e6.
- Pre-messaging feature ancestor: baa06dca5a3e764d683a79a88ff99b28bbc41303.
- Divergence: 6 main-only commits, 27 feature-only commits.
- Full feature diff from common main ancestor: 117 files, 9831 additions,
  860 deletions. Messaging after baa06dc: 62 files, 4429 additions,
  561 deletions. Counts establish breadth, not a dependency proof.
- Read feature-only files with git show <feature>:<path>. Start with
  SPEC.md section 20, docs/redis-messaging.md, packages/redis/src/messaging.ts,
  packages/messaging/src/cli.ts and package.json files.
- Historical verification: 109 messaging + 152 Redis scenarios across
  four OS/runtime pairings, plus six cross-host/restart cases = 1050.
  This was not rerun during intake. Its source and version identities
  must not be replaced with those of a new candidate.
- Private receipts: .scratch/docs/receipts/redis-messaging.md;
  .scratch/docs/handoffs/20260914-0922-redis-messaging-complete.md;
  .scratch/docs/reviews/redis-messaging-1-disposition.md and
  redis-messaging-2-disposition.md.
- Private integration assessment:
  .scratch/docs/handoffs/20260922-2242-consumer-feedback.md.
  It identifies separate-account deployment/ACL guidance, readiness
  permission checks and Node 22/macOS coverage as remaining concerns.
- Live checks: git fetch origin; gh pr list --repo semaphile/semaphile
  --state all returned []; git ls-remote --heads origin
  refs/heads/feat/redis-messaging returned no ref; npm view for Redis
  and messaging reported latest 0.2.0. Recheck at execution/promotion.

Historical feature completion excludes merge/publication. Do not infer
release availability from the source checkpoint version 0.4.0.
