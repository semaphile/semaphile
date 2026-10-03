#!/usr/bin/env bash
# SEM-3 disposable Linux x86_64 cloud leg: the single operator entry point.
#
# Private inputs come only from the environment, never from this repository
# or an ambient gcloud configuration:
#   SEM3_GCP_PROJECT         project ID (required)
#   SEM3_GCP_PROJECT_NUMBER  its project number; plan refuses on mismatch
#   SEM3_CLOUD_DIR           private 0700 run directory outside the repository
#   SEM3_RUN_ID              run identity, e.g. linux-20261001a
# host and fixture also need the staged Linux bundle:
#   SEM3_STAGING             staging directory (STAGED-FILES.txt, tree/, bundle.tgz)
#   SEM3_LISTING_SHA256      reviewed SHA-256 of STAGED-FILES.txt
#   SEM3_BUNDLE_SHA256       reviewed SHA-256 of bundle.tgz
#   SEM3_RECEIPTS            private receipts directory outside the repository
# Every gcloud call passes --project; Terraform receives the project as a
# variable and the ambient project variables are cleared. Every query whose
# answer means "absent" fails the command when the query itself fails.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH
umask 077

here=$(cd "$(dirname "$0")" && pwd)
tf_dir=$here/terraform
ansible_dir=$here/ansible
repo=$(git -C "$here" rev-parse --show-toplevel)

fail() {
  echo "run.sh: $*" >&2
  exit 2
}
need() { [ -n "${!1:-}" ] || fail "$1 is required"; }
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
outside_repo() {
  case $1/ in "$repo"/*) fail "$2 must be outside the repository" ;; esac
}

need SEM3_GCP_PROJECT
need SEM3_GCP_PROJECT_NUMBER
need SEM3_CLOUD_DIR
need SEM3_RUN_ID
[[ $SEM3_RUN_ID =~ ^[a-z][a-z0-9-]{5,19}$ ]] || fail 'SEM3_RUN_ID must be 6-20 lowercase characters'
dir=$(cd "$SEM3_CLOUD_DIR" && pwd -P)
outside_repo "$dir" SEM3_CLOUD_DIR
[ "$(mode_of "$dir")" = 700 ] || fail 'SEM3_CLOUD_DIR must be mode 0700'
project=$SEM3_GCP_PROJECT
zone=${SEM3_ZONE:-us-central1-a}
name=sem3-$SEM3_RUN_ID
key=$dir/id_ed25519
known_hosts=$dir/known_hosts
tfvars=$dir/run.tfvars.json
plan_file=$dir/create.tfplan
destroy_file=$dir/destroy.tfplan

unset CLOUDSDK_CORE_PROJECT CLOUDSDK_PROJECT GOOGLE_PROJECT GOOGLE_CLOUD_PROJECT GCLOUD_PROJECT
export TF_DATA_DIR=$dir/tfdata TF_IN_AUTOMATION=1 TF_INPUT=0
export ANSIBLE_CONFIG=$ansible_dir/ansible.cfg ANSIBLE_LOCAL_TEMP=$dir/ansible-tmp

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$dir/run.log" >&2; }
gc() { gcloud --project="$project" --quiet "$@"; }
tf() {
  # A fresh token from the operator's gcloud login; nothing is written to
  # disk. An empty token would let the provider fall back to other
  # credentials, so it is an error.
  local token
  token=$(gcloud auth print-access-token) || fail 'gcloud auth print-access-token failed'
  [ -n "$token" ] || fail 'gcloud returned an empty access token'
  GOOGLE_OAUTH_ACCESS_TOKEN=$token terraform -chdir="$tf_dir" "$@"
}

inputs() {
  [ -f "$key" ] || ssh-keygen -q -t ed25519 -N '' -C "sem3ops@$SEM3_RUN_ID" -f "$key"
  jq -n --arg project "$project" --arg number "$SEM3_GCP_PROJECT_NUMBER" --arg run "$SEM3_RUN_ID" \
    --arg zone "$zone" --arg pub "$(cat "$key.pub")" \
    '{project: $project, project_number: $number, run_id: $run, zone: $zone, ssh_public_key: $pub}' >"$tfvars"
  log "inputs written for $name"
}

init() {
  tf init -input=false -reconfigure -backend-config="path=$state_file" >/dev/null
  log 'terraform initialised with private state'
}

# The pre-apply checks the amendment requires, from a separate data dir.
validate() {
  TF_DATA_DIR=$dir/tfdata-validate terraform -chdir="$tf_dir" init -backend=false -input=false >/dev/null
  terraform -chdir="$tf_dir" fmt -check -recursive
  TF_DATA_DIR=$dir/tfdata-validate terraform -chdir="$tf_dir" validate -no-color
  local playbook
  for playbook in host.yml fixture.yml teardown.yml; do
    ansible-playbook -i "$ansible_dir/inventory.example.ini" --syntax-check "$ansible_dir/$playbook" >/dev/null
  done
  log 'validate: terraform fmt and validate, ansible syntax checks passed'
}

creates=$(printf '%s\n' \
  'create google_compute_firewall egress_deny' \
  'create google_compute_firewall egress_web' \
  'create google_compute_firewall iap_ssh' \
  'create google_compute_instance host' \
  'create google_compute_network fixture' \
  'create google_compute_subnetwork fixture')
deletes=${creates//create /delete }

# Print a saved plan's actions, one per line, and keep a copy beside it.
plan_actions() {
  local json
  json=$(tf show -json "$1") || fail "terraform show $1 failed"
  jq -r '[.resource_changes[]? | select(.change.actions != ["no-op"]) | "\(.change.actions | join("+")) \(.type) \(.name)"] | sort | join("\n")' <<<"$json" |
    tee "$1.actions.txt"
}
# A create plan must be exactly the six reviewed creates.
check_create() {
  local got
  got=$(plan_actions "$1") || fail "could not read the actions of $1"
  [ "$got" = "$creates" ] || fail 'plan actions differ from the reviewed six creates; nothing applied'
}
# A destroy plan may be any non-empty subset of the six reviewed deletes:
# after a partial apply or after the deletion deadline removed the VM,
# fewer resources remain. Any other action refuses.
# It is called in an if condition, where errexit is off, so every failure
# path is explicit.
check_destroy() {
  local got line
  got=$(plan_actions "$1") || fail "could not read the actions of $1"
  [ -n "$got" ] || return 1
  while IFS= read -r line; do
    grep -qxF -- "$line" <<<"$deletes" || fail "destroy plan contains an unreviewed action: $line"
  done <<<"$got"
}
# Before the first apply there is no state file, which means no resources;
# afterwards a missing file is an error, never an empty answer.
state_file=$dir/terraform.tfstate
state_resources() {
  if [ ! -f "$state_file" ]; then
    [ "${1:-}" = allow-missing ] || fail "no Terraform state at $state_file; cannot confirm it is empty"
    return 0
  fi
  tf state list || fail 'terraform state list failed'
}

plan() {
  local existing
  existing=$(state_resources allow-missing)
  [ -z "$existing" ] || fail "state already holds resources; recover with destroy, then plan again: $existing"
  tf plan -input=false -var-file="$tfvars" -out="$plan_file" -no-color >"$plan_file.txt"
  check_create "$plan_file"
  log "saved plan $(shasum -a 256 "$plan_file" | cut -d' ' -f1)"
}

apply() {
  [ -f "$plan_file" ] || fail 'no saved plan'
  check_create "$plan_file"
  tf apply -input=false -no-color "$plan_file" | tee "$dir/apply.txt"
  tf output -json >"$dir/outputs.json"
  log "applied; instance id $(jq -r .instance_id.value "$dir/outputs.json")"
}

# A second plan after setup must be empty (exit 0 with -detailed-exitcode).
replan() {
  local rc=0
  tf plan -input=false -var-file="$tfvars" -detailed-exitcode -no-color >"$dir/replan.txt" || rc=$?
  log "replan exit $rc (0 = no changes)"
  [ "$rc" -eq 0 ]
}

# Pin the host key the guest agent publishes through the Compute API.
known() {
  gc compute instances get-guest-attributes "$name" --zone="$zone" --query-path=hostkeys/ \
    --format=json | jq -r --arg alias "$name" '.[] | select(.key == "ssh-ed25519") | "\($alias) \(.key) \(.value)"' >"$known_hosts"
  [ -s "$known_hosts" ] || fail 'the VM has not published an ed25519 host key yet'
  log "host key pinned: $(ssh-keygen -lf "$known_hosts" | cut -d' ' -f2)"
}

inventory() {
  local proxy="gcloud compute start-iap-tunnel $name 22 --listen-on-stdin --project=$project --zone=$zone --verbosity=warning"
  {
    echo '[sem3]'
    printf '%s ansible_user=sem3ops ansible_ssh_private_key_file=%s ' "$name" "$key"
    printf "ansible_ssh_common_args='-o UserKnownHostsFile=%s -o StrictHostKeyChecking=yes -o HostKeyAlias=%s -o ProxyCommand=\"%s\"'\n" \
      "$known_hosts" "$name" "$proxy"
  } >"$dir/inventory.ini"
  log 'inventory written'
}

playbook() {
  mkdir -p "$ANSIBLE_LOCAL_TEMP"
  ansible-playbook -i "$dir/inventory.ini" "$ansible_dir/$1" "${@:2}" 2>&1 | tee -a "$dir/ansible-${1%.yml}.log"
}

# The staged bundle the owner reviewed: its listing and bundle hashes are
# checked here, and the host driver is installed from the staged tree.
staging() {
  need SEM3_STAGING
  need SEM3_LISTING_SHA256
  staged=$(cd "$SEM3_STAGING" && pwd -P)
  [ "$(shasum -a 256 "$staged/STAGED-FILES.txt" | cut -d' ' -f1)" = "$SEM3_LISTING_SHA256" ] ||
    fail 'STAGED-FILES.txt is not the reviewed listing'
}

# host.yml twice: the second run must change nothing.
host() {
  staging
  local vars recap
  vars=$(jq -n --arg staging "$staged" --arg lsha "$SEM3_LISTING_SHA256" \
    '{sem3_staging: $staging, sem3_listing_sha256: $lsha}')
  playbook host.yml -e "$vars"
  recap=$(playbook host.yml -e "$vars" | grep -E "^$name +: ") || fail 'no recap line from the second host run'
  grep -Eq ' changed=0 .* failed=0 ' <<<"$recap " || fail "the second host run was not idempotent: $recap"
  log "host configured; second run changed nothing: $recap"
}

fixture() {
  staging
  need SEM3_BUNDLE_SHA256
  need SEM3_RECEIPTS
  local extra parent receipts
  [ "$(shasum -a 256 "$staged/bundle.tgz" | cut -d' ' -f1)" = "$SEM3_BUNDLE_SHA256" ] ||
    fail 'bundle.tgz is not the reviewed bundle'
  case $SEM3_RECEIPTS in /*) ;; *) fail 'SEM3_RECEIPTS must be an absolute path' ;; esac
  parent=$(cd "$(dirname "$SEM3_RECEIPTS")" && pwd -P) || fail 'the parent of SEM3_RECEIPTS must exist'
  outside_repo "$parent" SEM3_RECEIPTS
  mkdir -p "$SEM3_RECEIPTS"
  receipts=$(cd "$SEM3_RECEIPTS" && pwd -P)
  outside_repo "$receipts" SEM3_RECEIPTS
  extra=$(jq -n --arg run "$SEM3_RUN_ID" --arg bundle "$staged/bundle.tgz" --arg bsha "$SEM3_BUNDLE_SHA256" \
    --arg lsha "$SEM3_LISTING_SHA256" --arg state "$dir" --arg receipts "$receipts" \
    '{sem3_run_id: $run, sem3_passes: [($run + "-p1"), ($run + "-p2")], sem3_bundle: $bundle,
      sem3_bundle_sha256: $bsha, sem3_listing_sha256: $lsha, sem3_state_dir: $state, sem3_receipts: $receipts}')
  playbook fixture.yml -e "$extra"
}

teardown_host() { playbook teardown.yml -e "$(jq -n --arg state "$dir" '{sem3_state_dir: $state}')"; }

destroy() {
  init
  tf plan -input=false -destroy -var-file="$tfvars" -out="$destroy_file" -no-color >"$destroy_file.txt"
  if ! check_destroy "$destroy_file"; then
    log 'nothing left in state: repeated destroy is a no-op'
    return 0
  fi
  tf apply -input=false -no-color "$destroy_file" | tee "$dir/destroy.txt"
  log "destroyed: $(paste -sd ',' "$destroy_file.actions.txt")"
}

# Read-only: every run-created resource must be gone; nothing else is read.
audit() {
  local found=0 kind out
  for kind in 'compute instances' 'compute disks' 'compute firewall-rules' 'compute networks subnets' 'compute networks'; do
    # shellcheck disable=SC2086 # kind is a fixed two- or three-word gcloud group
    out=$(gc $kind list --filter="name~^$name(-|$)" --format='value(name)') || fail "gcloud $kind list failed"
    if [ -n "$out" ]; then
      echo "audit: $kind named $name* remain: $out"
      found=1
    fi
  done
  out=$(state_resources)
  if [ -n "$out" ]; then
    echo "audit: Terraform state still lists resources: $out"
    found=1
  fi
  [ "$found" -eq 0 ] && log "audit clean: no $name resource remains"
  return "$found"
}

# After a clean audit only: delete the run's key, inventory, inputs, plans
# and state. The run log and the exported receipts are kept.
forget() {
  audit
  rm -rf "$key" "$key.pub" "$known_hosts" "$dir/inventory.ini" "$tfvars" "$dir/outputs.json" \
    "$plan_file" "$plan_file".* "$destroy_file" "$destroy_file".* "$state_file"* \
    "$dir/tfdata" "$dir/tfdata-validate" "$dir/ansible-tmp"
  log 'key, inventory, inputs, plans and state deleted after a clean audit'
}

command=${1:-}
case $command in
  inputs | init | validate | plan | apply | replan | known | inventory | host | fixture | destroy | audit | forget) "$command" ;;
  teardown-host) teardown_host ;;
  *) fail 'usage: run.sh inputs|init|validate|plan|apply|known|inventory|host|replan|fixture|teardown-host|destroy|audit|forget' ;;
esac
