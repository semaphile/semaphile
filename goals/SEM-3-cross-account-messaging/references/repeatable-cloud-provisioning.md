# Repeatable Linux cloud provisioning

Owner direction, September 26, 2026: provision the disposable Google Cloud
test VM with Terraform and Ansible so the test is repeatable. Do not put
project-specific Google Cloud information in source control. The selected
project is recorded only in the primary checkout's private planning record.

This amendment replaces the existing shared Linux host requirement. It adds
repeatable host provisioning to SEM-3; it does not replace the native macOS
gate or change candidate archives, the case inventory, or review requirements.
Earlier goal reviews assessed the shared-host design. They are not evidence
that the Terraform/Ansible addition has been reviewed.

## Reusable target pattern

The owner selected these targets for repeatable testing:

| Target | Environment |
| --- | --- |
| Linux amd64 (x86_64) | Disposable Google Cloud VM, Terraform provisioning and Ansible configuration |
| Linux aarch64 (arm64) | Colima on the Apple Silicon macOS host, using an explicitly selected profile and Docker context |
| Native macOS arm64 | The macOS host, with its own reviewed account/setup procedure |

Keep target selection separate from the test scenario. Reuse test commands,
fixture contracts and receipt structure across compatible Linux targets;
select and verify runtime archives and container images for the actual target
architecture. Record kernel, machine architecture and runtime architecture so
an emulated run cannot silently count as native evidence. Never route cloud
commands through an implicit active project or container commands through an
implicit Docker context.

Colima provides Linux evidence, not macOS evidence. Treat its existing profile
and unrelated containers as shared infrastructure: use explicitly owned,
bounded fixture resources and remove only those resources. Do not reset or
delete an existing profile, stop unrelated workloads, or broadly prune images.
Keep concrete profile/host inventory in the private operational record.

SEM-3 delivers the Linux amd64 and native macOS arm64 legs already required.
Document this reusable target split in its provisioning guide; implementing
or running an additional Linux aarch64 leg is future work, not an added SEM-3
completion gate. Colima cannot replace either required SEM-3 platform.

## Responsibilities

- Terraform declares one disposable Linux x64 VM and only the cloud resources
  required for it. Parameterize project, location, machine shape and connection
  settings. Record resource ownership and distinguish existing infrastructure
  from resources introduced by the run. Do not import or alter unrelated
  infrastructure. Pin provider constraints and retain the provider lockfile.
- Ansible configures the dedicated host and orchestrates the existing reviewed
  container fixture. Keep fixture identity switching, isolation and bounded
  resources. The three test UIDs remain inside the container. Any transport
  account and access configuration must be explicit in the provisioning plan.
- The executor prepares scripts and the revised provisioning packet; the
  orchestrator handles activation and resumption. Present the concrete plan,
  VM/disk/network bounds, cost estimate, access method, deletion deadline and
  cleanup procedure at the existing provisioning checkpoint. The design choice
  does not certify an unseen Terraform plan or administrator script.

## Public and private inputs

Commit generic Terraform, Ansible, dependency pins and placeholder examples.
Require the project as an explicit input with no real project default; do not
silently inherit the gcloud active project. Keep project IDs/numbers, account
identities, host addresses, resource inventories, credentials and backend
configuration in ignored local inputs or environment variables. Do not embed
them in source, public documentation, tracker text or tracked review artifacts.

Terraform state, state backups, saved plans, working data directories, real
variable files, generated Ansible inventory and execution logs remain outside
Git. Ignore those paths before generating them and verify the ignores. A
Terraform sensitive annotation alone does not keep values out of state.
Use normal authenticated tooling; do not copy credential files into the repo.
Retain raw operational evidence privately under the primary `.scratch/docs/`
tree and publish only sanitized summaries.

## Verification and cleanup

Validate Terraform formatting/configuration and Ansible syntax before apply.
After initial setup, a second Terraform plan must report no unintended changes;
a second Ansible host-configuration run must make no unintended changes or
duplicate resources. Deliberate test runs are separate from configuration
idempotence. Retain the existing two verification passes and partial-setup,
collision, teardown and harmless repeated-cleanup tests.

Export receipts out of the disposable VM before destructive teardown or its
deletion deadline. Complete fixture review, accepted fixes and affected reruns
before teardown. Destroy the run-owned infrastructure through Terraform, then
audit that its VM, disks and any run-created access/network resources are gone.
Preserve existing resources. A deletion deadline is a backstop, not proof of
cleanup; verify actual deletion and reconcile state after automatic deletion.
Retain private state/evidence needed to recover partial failures until cleanup
is verified. A second complete create/test/destroy cycle is not required, and
must not be claimed without evidence.

## Current status

Planning amendment only. Terraform/Ansible implementation and review remain
outstanding. This does not clear the executor's pause marker. Cloud billing,
API availability and provisioning permissions must be verified before apply;
macOS setup remains a separate
owner-assisted checkpoint.
