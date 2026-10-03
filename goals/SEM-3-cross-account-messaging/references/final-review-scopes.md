# Final finding-round scopes

Planner resolution of October 3, 2026, accepted by the owner, applied by the
executor at the orchestrator's request. The source is the planner's private
planning record in the primary checkout. This reference carries its contract.
It amends review organization only: no provisioning, merge, completion or
budget extension is granted. The gate-6 text it adds is in `GOAL.md`.

## Units

The final finding round covers three bounded units, all at the same frozen
commit and diff base.

| Unit | Primary surfaces | Required focus |
| --- | --- | --- |
| Administrator scripts and identities | `conformance/accounts/macos/admin.sh`, `linux/container.sh`, `bin/sem3-participant`; overlapping `stage.mjs` and `lib/layout.mjs` | Trust from unprivileged staging to privileged installation; symlinks and path substitution; account/group collisions, including nested supplementary groups; ownership and permissions; narrowly scoped identity switching; removal limited to manifest-owned resources. |
| Cloud provisioning and teardown | `conformance/accounts/cloud/**`, `linux/host.sh`; overlapping `linux/container.sh` | Terraform/Ansible/`run.sh` agree on resource identity and bounds; partial applies, expired or externally absent resources, and query errors remain distinguishable; receipt export precedes destructive cleanup; credentials and project inputs stay private; teardown proves absence without touching unrelated resources. |
| Harness, candidates and evidence | `conformance/accounts/controller.mjs`, `participant.mjs`, `lib/**`, `stage.mjs`, `candidate-pins.json`, `package.json`, `package-lock.json`, `README.md`; relevant docs and result summaries | Exact candidate/runtime identity; real UID/config loading; fixed case inventory; deadline/error propagation; service and credential cleanup after failures; no false pass; reported evidence matches commands and platform actually exercised. |

These paths seed the coverage manifest; they are not an exclusion list. Newly
changed paths and shared helpers are assigned explicitly. Goal and result
documents are included in the consistency audit without being treated as
product code. A unit that remains too large is subdivided into inspection
tasks within this round; no file is silently omitted and the review budget is
not reset.

## Coverage manifest

A coverage manifest assigns every changed implementation, configuration and
documentation file to at least one unit and identifies boundary overlaps.

## Review lanes and independence

- Each unit receives fresh blind Codex review and the configured independent
  review lanes. CodeRabbit and Sonar remain separate evidence, with their
  scope and any unsupported surface stated.
- Reviewers work independently on the frozen source before seeing other
  findings. Unit prompts include the goal, the relevant contract and the
  caller/callee boundary context. A reviewer may read outside its primary
  paths to test a boundary.
- A fresh integrated review pass covers the complete lifecycle, preferably by
  a critic who did not author fixes. It is part of the same final finding
  round.

## Cross-unit audit

The aggregate review includes an explicit cross-unit audit of staging,
installation, identity switching, participant launch, Redis operations,
interruption recovery, evidence export and teardown. No unit's pass
substitutes for another unit or for the integration audit.

## Reconciliation and record

All unit and integration findings reconcile into one final finding round.
Every accepted finding has a disposition and verification at the final head.
The final record names the base and head, the scope manifest, each lane's
actual model, effort and prompt, the reviewer output and the dispositions.
Raw evidence stays in the primary checkout; the goal results carry a sanitized
summary. Optional arena lanes record the same inputs and may not replace
required review engines. More reviewer opinions do not constitute proof of
live account behavior.

## Budget

- `results-005` is the first finding round for the current implementation.
- `results-006` is a verification round, declared at
  `d9ce1e4baddff90f9318d61c04dd18ca485cfa10` for the C1–C6 fixes. Its actual
  scope and findings are preserved: it is not relabelled, it does not claim to
  have verified later fixes, and it neither spends nor replenishes the final
  finding round. New findings are reconciled transparently before the final
  freeze.
- The remaining broad finding pass uses the three units above and is the
  second finding round under the repository's two-round budget. Targeted
  checks of accepted fixes are verification, not a hidden discovery pass.
- If the second round is as long as the first, AGENTS.md applies: split the
  deliverable and return the resulting scope decision to the planner. Broad
  reviews are not rerun under a verification label.

## Unchanged completion and authority

The fixed candidate archives, both native platforms, three actual OS accounts,
the Node/Bun matrix, two passes, cleanup, the SEM-2 debt mapping and every
other gate remain mandatory. Owner-assisted macOS administrator steps and
approval of the concrete bounded cloud plan remain required. Review fixes may
continue under the existing authorization. A provisioning packet must not be
activated after its trusted code changed. Applying this amendment and running
the reviews are operational work, not completed evidence.
