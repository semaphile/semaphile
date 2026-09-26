#!/usr/bin/env bash
# SEM-3 disposable Linux x86_64 cloud leg: the single operator entry point.
#
# Private inputs come only from the environment, never from this repository
# or an ambient gcloud configuration:
#   SEM3_GCP_PROJECT         project ID (required)
#   SEM3_GCP_PROJECT_NUMBER  its project number; plan refuses on mismatch
#   SEM3_CLOUD_DIR           private run directory outside the repository
#   SEM3_RUN_ID              run identity, e.g. linux-20261001a
# Every gcloud call passes --project; Terraform receives the project as a
# variable and the ambient project variables are cleared.
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

need SEM3_GCP_PROJECT
need SEM3_GCP_PROJECT_NUMBER
need SEM3_CLOUD_DIR
need SEM3_RUN_ID
[[ $SEM3_RUN_ID =~ ^[a-z][a-z0-9-]{5,19}$ ]] || fail 'SEM3_RUN_ID must be 6-20 lowercase characters'
dir=$(cd "$SEM3_CLOUD_DIR" && pwd -P)
case $dir/ in "$repo"/*) fail 'SEM3_CLOUD_DIR must be outside the repository' ;; esac
[ "$(stat -f %Lp "$dir" 2>/dev/null || stat -c %a "$dir")" = 700 ] || fail 'SEM3_CLOUD_DIR must be mode 0700'
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
  # A fresh token from the operator's gcloud login; nothing is written to disk.
  GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) terraform -chdir="$tf_dir" "$@"
}

inputs() {
  [ -f "$key" ] || ssh-keygen -q -t ed25519 -N '' -C "sem3ops@$SEM3_RUN_ID" -f "$key"
  jq -n --arg project "$project" --arg number "$SEM3_GCP_PROJECT_NUMBER" --arg run "$SEM3_RUN_ID" \
    --arg zone "$zone" --arg pub "$(cat "$key.pub")" \
    '{project: $project, project_number: $number, run_id: $run, zone: $zone, ssh_public_key: $pub}' >"$tfvars"
  log "inputs written for $name"
}

init() {
  tf init -input=false -reconfigure -backend-config="path=$dir/terraform.tfstate" >/dev/null
  log 'terraform initialised with private state'
}

# Show the saved plan's actions and refuse anything but the six creates.
check_plan() {
  local file=$1 want=$2 got
  got=$(tf show -json "$file" | jq -r '[.resource_changes[] | select(.change.actions != ["no-op"]) | "\(.change.actions | join("+")) \(.type) \(.name)"] | sort | join("\n")')
  printf '%s\n' "$got" | tee "$file.actions.txt"
  [ "$got" = "$want" ] || fail "plan actions differ from the reviewed set; nothing applied"
}
creates=$(printf '%s\n' \
  'create google_compute_firewall egress_deny' \
  'create google_compute_firewall egress_web' \
  'create google_compute_firewall iap_ssh' \
  'create google_compute_instance host' \
  'create google_compute_network fixture' \
  'create google_compute_subnetwork fixture')
deletes=${creates//create /delete }

plan() {
  tf plan -input=false -var-file="$tfvars" -out="$plan_file" -no-color >"$plan_file.txt"
  check_plan "$plan_file" "$creates"
  log "saved plan $(shasum -a 256 "$plan_file" | cut -d' ' -f1)"
}

apply() {
  [ -f "$plan_file" ] || fail 'no saved plan'
  check_plan "$plan_file" "$creates"
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

host() { playbook host.yml; }

fixture() {
  need SEM3_BUNDLE
  need SEM3_BUNDLE_SHA256
  need SEM3_LISTING_SHA256
  need SEM3_RECEIPTS
  local extra
  extra=$(jq -n --arg run "$SEM3_RUN_ID" --arg bundle "$SEM3_BUNDLE" --arg bsha "$SEM3_BUNDLE_SHA256" \
    --arg lsha "$SEM3_LISTING_SHA256" --arg state "$dir" --arg receipts "$SEM3_RECEIPTS" \
    '{sem3_run_id: $run, sem3_passes: [($run + "-p1"), ($run + "-p2")], sem3_bundle: $bundle,
      sem3_bundle_sha256: $bsha, sem3_listing_sha256: $lsha, sem3_state_dir: $state, sem3_receipts: $receipts}')
  playbook fixture.yml -e "$extra"
}

teardown_host() { playbook teardown.yml -e "$(jq -n --arg state "$dir" '{sem3_state_dir: $state}')"; }

destroy() {
  init
  tf plan -input=false -destroy -var-file="$tfvars" -out="$destroy_file" -no-color >"$destroy_file.txt"
  if [ -z "$(tf show -json "$destroy_file" | jq -r '.resource_changes[]? | select(.change.actions != ["no-op"]) | .address')" ]; then
    log 'nothing left in state: repeated destroy is a no-op'
    return 0
  fi
  check_plan "$destroy_file" "$deletes"
  tf apply -input=false -no-color "$destroy_file" | tee "$dir/destroy.txt"
  log 'destroyed'
}

# Read-only: every run-created resource must be gone; nothing else is read.
audit() {
  local found=0 kind
  for kind in 'compute instances' 'compute disks' 'compute firewall-rules' 'compute networks subnets' 'compute networks'; do
    # shellcheck disable=SC2086 # kind is a fixed two- or three-word gcloud group
    if [ -n "$(gc $kind list --filter="name~^$name(-|$)" --format='value(name)')" ]; then
      echo "audit: $kind named $name* remain"
      found=1
    fi
  done
  [ -z "$(tf state list 2>/dev/null)" ] || {
    echo 'audit: Terraform state still lists resources'
    found=1
  }
  [ "$found" -eq 0 ] && log "audit clean: no $name resource remains"
  return "$found"
}

command=${1:-}
case $command in
  inputs | init | plan | apply | replan | known | inventory | host | fixture | destroy | audit) "$command" ;;
  teardown-host) teardown_host ;;
  *) fail 'usage: run.sh inputs|init|plan|apply|known|inventory|host|replan|fixture|teardown-host|destroy|audit' ;;
esac
