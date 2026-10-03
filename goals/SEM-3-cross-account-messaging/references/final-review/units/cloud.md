# Unit prompt: cloud provisioning and teardown

This is a scope addendum to the wave's standard blind-review prompt. Every rule
there still applies: blindness, the gate-evidence audit, the retrospective
challenge, never block, and the output format. This addendum only narrows
where you spend your attention. Never run `terraform apply`, `plan` against a
real project, `gcloud` commands that change anything, or Ansible against a
host. `terraform init -backend=false`, `fmt`, `validate`, `ansible-playbook
--syntax-check` and `ansible-lint` are fine.

## Frozen inputs

Review the frozen head named in the round brief, against `main` at
`d585cf9b8ff5ad521673d4ffd56af6705242aadb`. The coverage manifest is
`goals/SEM-3-cross-account-messaging/references/final-review/MANIFEST.md`.

## Your unit

Primary surfaces: everything under `conformance/accounts/cloud/` and
`conformance/accounts/linux/host.sh`. Read `linux/container.sh` for what
`host.sh` installs and runs inside the container, and `controller.mjs` for the
receipts a pass produces. You may read anything else to test a boundary.

Contract: `GOAL.md` (gate 4, the Linux scope and the provisioning
checkpoints), `references/repeatable-cloud-provisioning.md`,
`references/verification-contract.md` (Service and filesystem layout;
Manifest, recovery and cleanup) and `references/final-review-scopes.md`.

## Required focus

- **Agreement.** Terraform, Ansible and `run.sh` must agree on resource
  identity, names, labels and bounds (shape, disk, network, egress, deletion
  deadline), and the README must describe what the code does.
- **State the lifecycle can meet.** Partial applies, a VM removed by its
  deletion deadline, resources removed out of band, a missing or stale state
  file, and failed queries (expired credentials, API errors, Docker errors)
  must each stay distinguishable, and none may read as success.
- **Order.** Receipts must be exported before any destructive step, and a pass
  that fails or times out must still be exported.
- **Privacy.** Project identity, credentials, the per-run key and state must
  stay out of the repository and out of logs, and no command may depend on an
  ambient gcloud project or Docker context.
- **Teardown.** It must prove absence of everything the run created, never
  touch unrelated resources (other instances, networks, images or
  containers), and never prune.

Name the boundary in each finding when it crosses into the Admin or Harness
unit; the integration pass reconciles those.
