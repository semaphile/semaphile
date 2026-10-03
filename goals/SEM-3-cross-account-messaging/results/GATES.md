# SEM-3 Gate evidence

Receipts for `SEM-3-cross-account-messaging`'s green gates, in GOAL.md order.
Each receipt records the run the executor actually made, never a
reconstruction after the fact.

This is an interim file. The fixture has not been provisioned on either
platform yet: the macOS administrator step and the cloud activation are owner
checkpoints that have not run. Gates 1–4 and 7 therefore have no run receipt
yet, and say so. PENDING marks a gate that has not run; no gate has been
waived, and no user waiver exists. Gate 6 uses the WAIVER shape only because
that is the receipts shape for a review in flight. Raw output for every
receipt below is in the primary checkout's private
`.scratch/docs/receipts/sem3-cross-account/` tree.

## Gate 1 — Three unprivileged identities on both architectures (PENDING — owner checkpoint not yet run)

- Status: not yet run. It needs the owner's macOS administrator setup and the
  approved cloud activation; neither has happened.
- Evidence: the controller's `run.json` and `checks.jsonl` per platform and
  pass, under `.scratch/docs/receipts/sem3-cross-account/{macos,linux}/`
  (private), once provisioned.

## Gate 2 — Private-home and shared-fixture access checks (PENDING — owner checkpoint not yet run)

- Status: not yet run, for the same reason as gate 1.
- Evidence: `checks.jsonl` per platform and pass, once provisioned.

## Gate 3 — The fixed matrix on macOS arm64 and Linux x64 (PENDING — owner checkpoint not yet run)

- Status: not yet run, for the same reason as gate 1. Same-UID development
  runs of the harness are not evidence for this gate and are not recorded
  here.
- Evidence: `cases.jsonl` and `summary.json` per platform and pass, once
  provisioned.

## Gate 4 — Setup, verification and cleanup without touching unrelated resources

The setup, teardown and audit procedures cannot run before provisioning;
their static checks can, and are recorded here. The live lifecycle, the
cleanup and the final read-only audit remain to run.

- Command: `shellcheck -s bash cloud/run.sh linux/host.sh && shellcheck -s sh linux/container.sh macos/admin.sh bin/sem3-participant`, plus `sh -n` or `bash -n` on each (from `conformance/accounts`)
- Exit code: 0
- Headline: 5 scripts, 0 ShellCheck findings, syntax clean. Four suppressions, each justified in a comment: `SC2024` once in `macos/admin.sh` (root reads its own file), `SC2086` twice in `macos/admin.sh` (the same deliberately split option string, reason on the first) and once in `cloud/run.sh` (a fixed multi-word gcloud group)
- Timestamp: 2026-10-03T19:35:45Z
- Tested commit: `1cb3dcc2682b4e80082e10cac38cf0df556f00a6`

- Command: `terraform init -backend=false -input=false && terraform fmt -check -recursive && terraform validate` (in `conformance/accounts/cloud/terraform`, with `TF_DATA_DIR` outside the repository and the ambient project variables unset)
- Exit code: 0
- Headline: Terraform 1.9.8, `hashicorp/google` 8.4.0 from the committed lock; format clean; configuration valid
- Timestamp: 2026-10-03T19:35:45Z
- Tested commit: `1cb3dcc2682b4e80082e10cac38cf0df556f00a6`

- Command: `ansible-playbook -i inventory.example.ini --syntax-check {host,fixture,teardown}.yml && ansible-lint --offline --profile production host.yml fixture.yml teardown.yml tasks/pass.yml` (in `conformance/accounts/cloud/ansible`)
- Exit code: 0
- Headline: 3 playbooks syntax-clean; ansible-lint 26.3.0, production profile, 0 failures, 0 warnings in 4 files
- Timestamp: 2026-10-03T19:35:45Z
- Tested commit: `1cb3dcc2682b4e80082e10cac38cf0df556f00a6`

## Gate 4 — Live lifecycle, cleanup and final audit (PENDING — owner checkpoint not yet run)

- Status: not yet run, for the same reason as gate 1.
- Evidence: the admin scripts' exported state logs and inventories, the
  controller's `cleanup.jsonl`, and the cloud leg's `run.log`, destroy plan
  and audit output, once provisioned and torn down.

## Gate 5 — Lint gate

- Command: `evie-kit lint gate --goal SEM-3`
- Exit code: 0
- Headline: typecheck passed (`bun run typecheck`); fast tier clean — packages/ command: clean; conformance/ command: clean; tools/ command: clean; deep tier not-applicable (the change touches nothing in `sonar.sources=packages`)
- Timestamp: 2026-10-03T19:35:40.572Z
- Tested commit: `1cb3dcc2682b4e80082e10cac38cf0df556f00a6`

- Command: `npm run check:docs`
- Exit code: 0
- Headline: 18 public Markdown documents; local links resolve; no private links or machine details
- Timestamp: 2026-10-03T19:35:45Z
- Tested commit: `1cb3dcc2682b4e80082e10cac38cf0df556f00a6`

- Command: `prettier --check conformance/accounts`
- Exit code: 0
- Headline: all files use Prettier style
- Timestamp: 2026-10-03T19:35:45Z
- Tested commit: `1cb3dcc2682b4e80082e10cac38cf0df556f00a6`

## Gate 6 — Fresh blind review (WAIVER)

- Status: in-flight. The final finding round, organized by
  `references/final-review-scopes.md`, has not run.
- Evidence: `reviews/results-005/INDEX.md` and `reviews/results-006/INDEX.md`
  (reconciled), and the final round's coverage manifest in
  `references/final-review/MANIFEST.md`.

## Gate 7 — Evidence mapped to every SEM-2 deferred criterion (PENDING — depends on gates 1–4)

- Status: not yet run; it depends on gates 1–4.
- Evidence: `results/RESULT.md`, at completion.
