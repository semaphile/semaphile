# Final finding round: coverage manifest

The contract is `../final-review-scopes.md`. This manifest assigns every file
the change touches to at least one review unit and names the boundaries the
units share.

## Frozen inputs

| Input | Value |
| --- | --- |
| Diff base | `main` at `d585cf9b8ff5ad521673d4ffd56af6705242aadb` (the merge base; `main` has not moved) |
| Last product change | `1cb3dcc2682b4e80082e10cac38cf0df556f00a6` |
| Frozen head | the commit that adds this file; later commits void the freeze |
| Change set | `git diff --name-only d585cf9b8ff5ad521673d4ffd56af6705242aadb <frozen head>`: 112 files |

Every commit after `1cb3dcc` changes only `.evie-kit/learnings/` and
`goals/SEM-3-cross-account-messaging/`. All units review the same frozen head.

## Units

| Unit | Prompt | Primary surfaces |
| --- | --- | --- |
| Admin | `units/admin.md` | administrator scripts, the identity runner, and the staging and layout they trust |
| Cloud | `units/cloud.md` | Terraform, Ansible, `run.sh`, `linux/host.sh`, and the container script they drive |
| Harness | `units/harness.md` | controller, participant, library, candidate pins and consumer, README, learnings |
| Integration | `integration.md` | the complete lifecycle across all three units, run after the unit lanes |

## Assignment

`all` means every unit and the integration pass read the file as context or
evidence. `context` is background only. `integration-last` is read only by the
integration pass, after the unit lanes have finished, because the executor's
narrative summarizes earlier rounds and would unblind a unit lane. A
`lifecycle record` is earlier review output, which no lane reads under the
standard blindness rules; the orchestrator audits it at reconciliation.

| File | Units | Role |
| --- | --- | --- |
| `.evie-kit/learnings/.gitattributes` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/.gitignore` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/INDEX.md` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/container-root-without-dac.md` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/debian-userdel-private-groups.md` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/macos-inherited-groups.md` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/root-scripts-untrusted-paths.md` | Harness | executor learnings; read with the retrospective challenge |
| `.evie-kit/learnings/shell-absence-queries.md` | Harness | executor learnings; read with the retrospective challenge |
| `conformance/accounts/README.md` | Harness, Admin, Cloud | procedure and contract documentation for all three units |
| `conformance/accounts/bin/sem3-participant` | Admin, Harness | identity runner; launched by lib/launch.mjs |
| `conformance/accounts/candidate-pins.json` | Harness | third-party pins from the candidate locks |
| `conformance/accounts/cloud/.gitignore` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/ansible/ansible.cfg` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/ansible/fixture.yml` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/ansible/host.yml` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/ansible/inventory.example.ini` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/ansible/tasks/pass.yml` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/ansible/teardown.yml` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/run.sh` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/terraform/.terraform.lock.hcl` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/terraform/main.tf` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/terraform/outputs.tf` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/terraform/terraform.tfvars.example` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/terraform/variables.tf` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/cloud/terraform/versions.tf` | Cloud | Terraform, Ansible and run.sh |
| `conformance/accounts/controller.mjs` | Harness | controller: Redis, provisioning, checks, cases, cleanup |
| `conformance/accounts/lib/cases.mjs` | Harness | harness library |
| `conformance/accounts/lib/resp.mjs` | Harness | harness library |
| `conformance/accounts/lib/service.mjs` | Harness | harness library |
| `conformance/accounts/lib/tar.mjs` | Harness | harness library |
| `conformance/accounts/lib/checks.mjs` | Harness, Admin | fixture checks, identity, ownership and switch proofs |
| `conformance/accounts/lib/launch.mjs` | Harness, Admin | participant launch argv for sudo and setpriv |
| `conformance/accounts/lib/layout.mjs` | Harness, Admin | identities, paths, profiles and grants shared by every unit |
| `conformance/accounts/linux/container.sh` | Admin, Cloud | root-run in-container setup, teardown, rehearsal; driven by host.sh |
| `conformance/accounts/linux/host.sh` | Cloud | VM host driver for the container lifecycle |
| `conformance/accounts/macos/admin.sh` | Admin | root-run macOS setup, teardown, rehearsal, audit |
| `conformance/accounts/package-lock.json` | Harness | installed-archive consumer |
| `conformance/accounts/package.json` | Harness | installed-archive consumer |
| `conformance/accounts/participant.mjs` | Harness | participant operations run as each identity |
| `conformance/accounts/stage.mjs` | Harness, Admin | controller-side staging; produces what the admin scripts verify |
| `goals/SEM-3-cross-account-messaging/GOAL.md` | all | goal spec; context for every unit |
| `goals/SEM-3-cross-account-messaging/grilling/session-001-20260924-000322.md` | context | planner interview record; context only |
| `goals/SEM-3-cross-account-messaging/references/INDEX.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/baseline.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/final-review-scopes.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/intake.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/repeatable-cloud-provisioning.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/sem2-baseline.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/sem2-debt.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/verification-contract.md` | all | binding contract and references; context for every unit |
| `goals/SEM-3-cross-account-messaging/references/final-review/MANIFEST.md` | all | this manifest and the unit prompts |
| `goals/SEM-3-cross-account-messaging/references/final-review/integration.md` | all | this manifest and the unit prompts |
| `goals/SEM-3-cross-account-messaging/references/final-review/units/admin.md` | all | this manifest and the unit prompts |
| `goals/SEM-3-cross-account-messaging/references/final-review/units/cloud.md` | all | this manifest and the unit prompts |
| `goals/SEM-3-cross-account-messaging/references/final-review/units/harness.md` | all | this manifest and the unit prompts |
| `goals/SEM-3-cross-account-messaging/results/GATES.md` | all | gate receipts, audited by every lane |
| `goals/SEM-3-cross-account-messaging/results/RESULT.md` | integration-last | executor narrative; carries earlier-round summaries |
| `goals/SEM-3-cross-account-messaging/results/lint/receipt.json` | Harness | lint gate receipt and Sonar evidence |
| `goals/SEM-3-cross-account-messaging/results/lint/sonar-evidence.json` | Harness | lint gate receipt and Sonar evidence |
| `goals/SEM-3-cross-account-messaging/results/retrospective.md` | all | challenged per the standard prompt; tables only |
| `goals/SEM-3-cross-account-messaging/reviews/**` (52 files: goal rounds 001–004 and results rounds 005–006) | lifecycle record | earlier review-round records |

## Boundary overlaps

Files read by more than one unit, and the boundary each crossing tests:

| Boundary | Files | Units | What crosses it |
| --- | --- | --- | --- |
| Staging to privileged install | `stage.mjs`, `lib/layout.mjs`, `macos/admin.sh`, `linux/container.sh` | Harness, Admin | The listing, tree and hashes the controller produces, which root verifies and installs. |
| Identity switching | `bin/sem3-participant`, `lib/launch.mjs`, `lib/checks.mjs`, the sudoers rule in `macos/admin.sh` | Admin, Harness | The exact argv participants run with, the runner's refusals, and the identity proofs that check them. |
| Container lifecycle | `linux/container.sh`, `linux/host.sh`, `cloud/ansible/*.yml` | Admin, Cloud | `host.sh` installs and runs the verified admin script; teardown order across the container, the image and the VM. |
| Service and credentials | `lib/service.mjs`, `controller.mjs`, `macos/admin.sh` teardown, `linux/container.sh` teardown | Harness, Admin | Who stops the fixture Redis and removes credentials after a failure, an interrupt or a crash. |
| Evidence export | `controller.mjs` receipts, `cloud/ansible/tasks/pass.yml`, `cloud/run.sh fixture` | Harness, Cloud | Receipts leave the container and the VM before any destructive step. |
| Documentation | `README.md`, `GOAL.md`, `references/*` | all | Procedure and claims match the code each unit reviews. |

## Separate evidence lanes

- CodeRabbit reviews the whole diff once. Its scope is the committed diff; it
  runs no code.
- SonarQube scans `sonar.sources=packages`, which this change does not touch.
  Its deep tier is therefore not applicable: it covers none of the shell,
  Terraform, Ansible or `conformance/accounts` JavaScript. The gate receipts
  for ShellCheck, `terraform validate`, the Ansible syntax checks,
  `ansible-lint`, oxlint and Prettier cover that surface instead.
- No lane can prove live account behavior. Gates 1 to 4 still need the owner
  checkpoints and the live runs.
