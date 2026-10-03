#!/bin/sh
# SEM-3 macOS account fixture administration: setup, teardown, rehearsal,
# a read-only audit (collisions) and the tree listing used to verify installs.
#
# The owner runs a root-private copy verified against the reviewed SHA-256
# (conformance/accounts/README.md). Setup refuses any pre-existing fixture
# name, id, path or process before changing anything; every resource is
# recorded as intended before it is created and as observed right after.
# Teardown verifies every recorded identity first and deletes nothing if any
# differs.
#
# The controller account is untrusted here. Root never writes into, follows
# a link inside, or widens access to anything the controller owns: receipts
# are written as the controller, and the staged tree stays root-private
# until its listing matches the reviewed hash.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 077

PREFIX=/opt/semaphile-sem3
SUDOERS=/private/etc/sudoers.d/semaphile-sem3
DEFAULT_STATE=/var/db/semaphile-sem3
REHEARSAL_STATE=/var/db/semaphile-sem3-rehearsal
TAMPERED_STATE=/var/db/semaphile-sem3-rehearsal-tampered
ACCOUNTS='sem3a sem3b sem3c'
FIXTURE_GROUPS='sem3a sem3b sem3c sem3ab'
MARK='Semaphile SEM-3 fixture'
USERS_DIR=/Users
GROUPS_DIR=/Groups
SELF=$0

fail() {
  echo "admin: $*" >&2
  exit 2
}
id_of() {
  case $1 in
    sem3a) echo 3601 ;;
    sem3b) echo 3602 ;;
    sem3c) echo 3603 ;;
    sem3ab) echo 3610 ;;
    *) return 1 ;;
  esac
}
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '%s %s\n' "$(now)" "$*"; }

# ---- tree listing (also used unprivileged by the staging tool) ----------
# One sorted line per entry: d - - PATH | l - TARGET PATH | f x|- SHA PATH
listing() {
  # The pipeline's status is sort's, so a missing hash tool would otherwise
  # yield a listing with no file lines.
  command -v shasum >/dev/null || fail 'shasum is required on PATH'
  (
    cd "$1" || exit 1
    find . \( -path ./home -o -path ./shared -o -path ./checkout/.tmp -o -name .sem3-fixture \) -prune \
      -o -type d -print | sed 's/^/d - - /'
    find . \( -path ./home -o -path ./shared -o -path ./checkout/.tmp \) -prune -o -type l -print |
      while IFS= read -r path; do printf 'l - %s %s\n' "$(readlink "$path")" "$path"; done
    find . \( -path ./home -o -path ./shared -o -path ./checkout/.tmp -o -name .sem3-fixture \) -prune \
      -o -type f -exec shasum -a 256 {} + | while read -r sum path; do
      if [ -x "$path" ]; then mode=x; else mode=-; fi
      printf 'f %s %s %s\n' "$mode" "$sum" "$path"
    done
  ) | LC_ALL=C sort -k4
}

# ---- state log: tab-separated, append-only; the last line per key wins ---
record() { printf '%s\t%s\t%s\t%s\t%s\n' "$(now)" "$1" "$2" "$3" "$4" >>"$STATE/state.tsv"; }
latest() { awk -F '\t' -v c="$1" -v n="$2" '$3 == c && $4 == n { line = $0 } END { print line }' "$STATE/state.tsv"; }
field() { printf '%s\n' "$1" | awk -F '\t' -v i="$2" '{ print $i }'; }
# dscl prints values containing spaces on a continuation line.
attr() {
  dscl . -read "$1" "$2" 2>/dev/null | awk -v k="$2:" '
    NR == 1 && $1 == k { $1 = ""; sub(/^ /, ""); value = $0; next }
    NR > 1 { sub(/^ /, ""); value = value == "" ? $0 : value " " $0 }
    END { print value }'
}

# Processes whose working directory or executable lies inside the prefix:
# "PID UID PATH" per process. The fixture Redis rewrites its own argv, so
# its run directory (Redis chdirs to it) is what identifies it.
fixture_processes() {
  lsof -nP -w -d cwd,txt -Fpun 2>/dev/null | P="$PREFIX/" SELF_PID=$$ awk '
    /^p/ { pid = substr($0, 2) }
    /^u/ { uid = substr($0, 2) }
    /^n/ && pid != ENVIRON["SELF_PID"] && index(substr($0, 2), ENVIRON["P"]) == 1 && !seen[pid]++ {
      print pid, uid, substr($0, 2)
    }'
}

# Pre-existing accounts, groups, memberships and sudoers files.
inventory() {
  dscl . -list "$USERS_DIR" UniqueID
  echo '--'
  dscl . -list "$GROUPS_DIR" PrimaryGroupID
  echo '--'
  dscl . -list "$GROUPS_DIR" GroupMembership
  echo '--'
  for file in /private/etc/sudoers /private/etc/sudoers.d/*; do
    if [ -f "$file" ]; then shasum -a 256 "$file"; fi
  done
}

collisions() {
  found=0
  for name in $ACCOUNTS $EXTRA_NAMES; do
    if dscl . -read "$USERS_DIR/$name" >/dev/null 2>&1; then
      echo "collision: user $name exists"
      found=1
    fi
  done
  for name in $FIXTURE_GROUPS $EXTRA_NAMES; do
    if dscl . -read "$GROUPS_DIR/$name" >/dev/null 2>&1; then
      echo "collision: group $name exists"
      found=1
    fi
  done
  for id in 3601 3602 3603 3610 $EXTRA_IDS; do
    if [ -n "$(dscl . -search "$USERS_DIR" UniqueID "$id")" ]; then
      echo "collision: uid $id in use"
      found=1
    fi
    if [ -n "$(dscl . -search "$GROUPS_DIR" PrimaryGroupID "$id")" ]; then
      echo "collision: gid $id in use"
      found=1
    fi
  done
  for path in "$PREFIX" "$STATE" "$SUDOERS"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      echo "collision: $path exists"
      found=1
    fi
  done
  procs=$(fixture_processes)
  if [ -n "$procs" ]; then
    printf 'collision: process inside the prefix: %s\n' "$procs"
    found=1
  fi
  return "$found"
}

maybe_fail() {
  if [ "${FAIL_AFTER:-}" = "$1" ]; then
    say "injected failure after $1 (rehearsal)"
    exit 99
  fi
}

require_root() { [ "$(id -u)" -eq 0 ] || fail 'run as root through sudo'; }
controller_checks() {
  [ -n "${CONTROLLER:-}" ] || fail '--controller is required'
  CONTROLLER_UID=$(id -u "$CONTROLLER") || fail "no such controller account $CONTROLLER"
  [ "$CONTROLLER_UID" -ge 500 ] || fail 'controller must be an ordinary account'
  case " $ACCOUNTS " in *" $CONTROLLER "*) fail 'controller cannot be a fixture identity' ;; esac
}
receipts_checks() {
  [ -n "${RECEIPTS:-}" ] || fail '--receipts is required'
  [ -d "$RECEIPTS" ] && [ ! -L "$RECEIPTS" ] || fail 'receipts directory missing'
  [ "$(stat -f %u "$RECEIPTS")" = "$CONTROLLER_UID" ] || fail 'receipts directory is not owned by the controller'
}
# Written AS the controller, without clobbering: a link the controller
# planted can reach only what the controller could already write.
export_receipts() {
  stem="$RECEIPTS/$(basename "$STATE")-$1-$(date -u +%Y%m%dT%H%M%SZ)"
  for file in state.tsv inventory-before.txt inventory-after.txt; do
    [ -f "$STATE/$file" ] || continue
    # Root reads its own state file; only the writer runs as the controller.
    # shellcheck disable=SC2024
    sudo -n -u "$CONTROLLER" /bin/sh -c 'umask 077; set -C; cat >"$1"' sh "$stem-$file" <"$STATE/$file" ||
      fail "could not export $file to the receipts directory"
  done
  say "state exported to $stem-*"
}

create_group() {
  name=$1
  gid=$(id_of "$name")
  record intended group "$name" "gid=$gid"
  dseditgroup -o create -n . -i "$gid" -r "$MARK group $name" "$name"
  record observed group "$name" "gid=$(attr "$GROUPS_DIR/$name" PrimaryGroupID) guid=$(attr "$GROUPS_DIR/$name" GeneratedUID)"
}
create_user() {
  name=$1
  uid=$(id_of "$name")
  record intended user "$name" "uid=$uid gid=$uid home=$PREFIX/home/$name"
  dscl . -create "$USERS_DIR/$name"
  dscl . -create "$USERS_DIR/$name" UniqueID "$uid"
  dscl . -create "$USERS_DIR/$name" PrimaryGroupID "$uid"
  dscl . -create "$USERS_DIR/$name" RealName "$MARK user $name"
  dscl . -create "$USERS_DIR/$name" NFSHomeDirectory "$PREFIX/home/$name"
  dscl . -create "$USERS_DIR/$name" UserShell /usr/bin/false
  dscl . -create "$USERS_DIR/$name" Password '*'
  dscl . -create "$USERS_DIR/$name" IsHidden 1
  maybe_fail "user-created:$name"
  record observed user "$name" "uid=$(attr "$USERS_DIR/$name" UniqueID) gid=$(attr "$USERS_DIR/$name" PrimaryGroupID) guid=$(attr "$USERS_DIR/$name" GeneratedUID)"
}

# The staging paths belong to the controller: refuse links, and never
# dereference them except into root-private places that are checked.
staging_checks() {
  [ -n "${STAGING:-}" ] || fail '--staging DIR is required'
  for path in "$STAGING" "$STAGING/tree" "$STAGING/STAGED-FILES.txt"; do
    [ ! -L "$path" ] || fail "$path is a symbolic link"
  done
  [ -d "$STAGING" ] && [ -d "$STAGING/tree" ] && [ -f "$STAGING/STAGED-FILES.txt" ] ||
    fail '--staging DIR must hold tree/ and STAGED-FILES.txt'
  [ "$(stat -f %u "$STAGING")" = "$CONTROLLER_UID" ] || fail 'staging is not owned by the controller'
  [ -n "${MANIFEST_SHA256:-}" ] || fail '--manifest-sha256 is required'
}

setup() {
  require_root
  controller_checks
  receipts_checks
  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail 'native macOS arm64 only'
  grep -Eq '^[#@]includedir /private/etc/sudoers\.d$' /private/etc/sudoers || fail 'sudoers does not include sudoers.d'
  staging_checks
  if ! collisions; then
    fail 'refusing: fixture resources already exist; nothing was changed'
  fi
  RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -m 0700 "$STATE"
  printf '%s run %s\n' "$MARK" "$RUN" >"$STATE/.sem3-fixture"
  : >"$STATE/state.tsv"
  record observed state "$STATE" "run=$RUN controller=$CONTROLLER manifest=$MANIFEST_SHA256"
  inventory >"$STATE/inventory-before.txt"
  record observed inventory before "sha256=$(shasum -a 256 "$STATE/inventory-before.txt" | awk '{ print $1 }')"
  # Hash the root-private copy, never the controller's file: whatever the
  # controller swaps in lands in a 0700 directory and fails this check.
  cp "$STAGING/STAGED-FILES.txt" "$STATE/reviewed-files.txt"
  actual=$(shasum -a 256 "$STATE/reviewed-files.txt" | awk '{ print $1 }')
  [ "$actual" = "$MANIFEST_SHA256" ] || fail "staged listing $actual is not the reviewed $MANIFEST_SHA256"
  say "setup $RUN: groups"
  for name in $FIXTURE_GROUPS; do create_group "$name"; done
  maybe_fail groups
  say 'users'
  for name in $ACCOUNTS; do create_user "$name"; done
  for name in sem3a sem3b; do
    record intended member sem3ab:"$name" 'group=sem3ab'
    dseditgroup -o edit -n . -a "$name" -t user sem3ab
    record observed member sem3ab:"$name" 'group=sem3ab'
  done
  maybe_fail users
  say 'tree'
  record intended prefix "$PREFIX" "run=$RUN"
  mkdir -m 0700 "$PREFIX"
  printf '%s run %s\n' "$MARK" "$RUN" >"$PREFIX/.sem3-fixture"
  record observed prefix "$PREFIX" "run=$RUN"
  # The prefix stays 0700 until the copy matches the reviewed listing, so
  # nothing the copy picked up is reachable by anyone but root.
  ditto --noextattr --noqtn --norsrc --noacl "$STAGING/tree" "$PREFIX"
  chown -R -h root:wheel "$PREFIX"
  find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name .sem3-fixture -exec chmod -R u+rwX,go+rX,go-w {} +
  listing "$PREFIX" >"$STATE/installed-files.txt"
  if [ -n "$(find "$PREFIX" \( -perm -4000 -o -perm -2000 \) -print)" ] ||
    ! cmp -s "$STATE/installed-files.txt" "$STATE/reviewed-files.txt"; then
    find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name .sem3-fixture -exec rm -rf {} +
    fail 'installed tree differs from the reviewed listing; the copy was removed'
  fi
  record observed tree "$PREFIX" "sha256=$(shasum -a 256 "$STATE/installed-files.txt" | awk '{ print $1 }')"
  maybe_fail tree
  say 'homes, scratch and handoff share'
  mkdir -m 0755 "$PREFIX/home" "$PREFIX/shared" "$PREFIX/checkout/.tmp" "$PREFIX/checkout/.tmp/participants"
  for name in $ACCOUNTS; do
    uid=$(id_of "$name")
    for dir in "$PREFIX/home/$name" "$PREFIX/checkout/.tmp/participants/$name"; do
      mkdir -m 0700 "$dir"
      chown "$uid:$uid" "$dir"
    done
  done
  for dir in "$PREFIX/checkout/.tmp/controller" "$PREFIX/checkout/.tmp/redis"; do
    mkdir -m 0700 "$dir"
    chown "$CONTROLLER" "$dir"
  done
  chown root:sem3ab "$PREFIX/shared"
  chmod 0750 "$PREFIX/shared"
  printf 'synthetic SEM-3 handoff data\n' >"$PREFIX/shared/handoff.txt"
  chown root:sem3ab "$PREFIX/shared/handoff.txt"
  chmod 0640 "$PREFIX/shared/handoff.txt"
  chmod 0755 "$PREFIX"
  record observed layout "$PREFIX" 'homes=0700 shared=0750 handoff=0640'
  maybe_fail layout
  say 'sudoers'
  rule="$STATE/sudoers.candidate"
  {
    echo "# $MARK run $RUN: the controller may start only the fixed runner"
    echo '# as the three fixture identities. Removed by teardown.'
    echo "Cmnd_Alias SEM3_PARTICIPANT = $PREFIX/bin/sem3-participant node, $PREFIX/bin/sem3-participant bun"
    echo 'Defaults!SEM3_PARTICIPANT env_reset, !env_keep, secure_path="/usr/bin:/bin"'
    echo "$CONTROLLER ALL = (sem3a, sem3b, sem3c) NOPASSWD: SEM3_PARTICIPANT"
  } >"$rule"
  visudo -c -f "$rule" >/dev/null || fail 'candidate sudoers rule failed validation'
  record intended sudoers "$SUDOERS" "sha256=$(shasum -a 256 "$rule" | awk '{ print $1 }')"
  install -o root -g wheel -m 0440 "$rule" "$SUDOERS"
  visudo -c >/dev/null || {
    rm -f "$SUDOERS"
    fail 'sudoers failed validation after install; rule removed'
  }
  record observed sudoers "$SUDOERS" "sha256=$(shasum -a 256 "$SUDOERS" | awk '{ print $1 }')"
  maybe_fail sudoers
  record observed complete "$RUN" 'setup finished'
  export_receipts setup
  say "setup $RUN complete"
}

# Verify every recorded resource; print one verdict line per resource.
verify_recorded() {
  mismatches=0
  keys=$(awk -F '\t' '$3 != "state" { print $3 "|" $4 }' "$STATE/state.tsv" | awk '!seen[$0]++')
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    class=${key%%|*}
    name=${key#*|}
    line=$(latest "$class" "$name")
    status=$(field "$line" 2)
    attrs=$(field "$line" 5)
    verdict=ours
    case $class in
      group | user)
        dir=$GROUPS_DIR
        [ "$class" = user ] && dir=$USERS_DIR
        if ! dscl . -read "$dir/$name" >/dev/null 2>&1; then
          verdict=absent
        else
          real=$(attr "$dir/$name" RealName)
          [ "$real" = "$MARK $class $name" ] || verdict=mismatch
          if [ "$class" = user ]; then
            want="uid=$(attr "$dir/$name" UniqueID) gid=$(attr "$dir/$name" PrimaryGroupID)"
          else
            want="gid=$(attr "$dir/$name" PrimaryGroupID)"
          fi
          case "$attrs " in "$want "*) ;; *) verdict=mismatch ;; esac
          if [ "$status" = observed ]; then
            case $attrs in *"guid=$(attr "$dir/$name" GeneratedUID)") ;; *) verdict=mismatch ;; esac
          fi
        fi
        ;;
      prefix)
        if [ ! -e "$name" ] && [ ! -L "$name" ]; then
          verdict=absent
        elif [ -L "$name" ] || [ "$(stat -f %u "$name")" != 0 ] ||
          ! grep -qx "$MARK run ${attrs#run=}" "$name/.sem3-fixture" 2>/dev/null; then
          verdict=mismatch
        elif mount | awk -v p="$name" '$3 == p || index($3, p "/") == 1 { found = 1 } END { exit !found }'; then
          verdict=mismatch
        fi
        ;;
      sudoers)
        if [ ! -e "$name" ]; then
          verdict=absent
        elif [ "sha256=$(shasum -a 256 "$name" | awk '{ print $1 }')" != "$attrs" ]; then
          verdict=mismatch
        fi
        ;;
      member)
        dseditgroup -o checkmember -m "${name#*:}" sem3ab >/dev/null 2>&1 || verdict=absent
        ;;
      inventory | redis | tree | layout | complete | refused) verdict=info ;;
      *) verdict=mismatch ;;
    esac
    echo "$class $name $status $verdict"
    if [ "$verdict" = mismatch ]; then
      mismatches=1
    fi
  done <<KEYS
$keys
KEYS
  return "$mismatches"
}

# Stop every process tied to the fixture before anything is deleted:
# fixture identities by UID, and the controller's Redis by its run
# directory. Any other process inside the prefix stops the teardown.
stop_fixture_processes() {
  for name in $ACCOUNTS; do
    if printf '%s\n' "$verdicts" | grep -q "^user $name [a-z]* ours$"; then
      pkill -KILL -U "$(id_of "$name")" 2>/dev/null || true
    fi
  done
  for name in $ACCOUNTS; do
    if pgrep -U "$(id_of "$name")" >/dev/null 2>&1; then
      fail "processes of $name survived; nothing further deleted"
    fi
  done
  redis=$(fixture_processes | awk -v d="$PREFIX/checkout/.tmp/redis/" -v u="$CONTROLLER_UID" \
    '$2 == u && index($3, d) == 1 { print $1 }')
  for pid in $redis; do
    say "stopping fixture Redis $pid left by a controller run"
    kill -TERM "$pid" 2>/dev/null || true
  done
  if [ -n "$redis" ]; then
    sleep 3
    for pid in $redis; do kill -KILL "$pid" 2>/dev/null || true; done
    record removed redis "pids $(printf '%s\n' "$redis" | tr '\n' ' ')" 'stopped'
  fi
  left=$(fixture_processes)
  [ -z "$left" ] || fail "processes inside the prefix remain; nothing further deleted: $left"
}

teardown() {
  require_root
  controller_checks
  receipts_checks
  if [ ! -d "$STATE" ]; then
    say "no state at $STATE: verifying that no fixture resource remains"
    if collisions; then
      say 'repeated teardown: nothing recorded and nothing left; no change made'
      return 0
    fi
    fail 'unrecorded fixture resources exist; not deleting them'
  fi
  grep -q "^$MARK run " "$STATE/.sem3-fixture" 2>/dev/null || fail "$STATE is not a fixture state directory"
  say 'verifying recorded identities'
  verdicts=$(verify_recorded) && clean=1 || clean=0
  printf '%s\n' "$verdicts"
  # Revocation is always safe for a grant whose content we recorded.
  if printf '%s\n' "$verdicts" | grep -q "^sudoers $SUDOERS [a-z]* ours$"; then
    rm -f "$SUDOERS"
    visudo -c >/dev/null || fail 'sudoers invalid after revocation'
    record removed sudoers "$SUDOERS" 'revoked'
    say 'sudoers grant revoked'
  fi
  if [ "$clean" -ne 1 ]; then
    record observed refused "$STATE" 'identity mismatch; nothing deleted'
    export_receipts refused
    echo 'admin: identity mismatch: nothing deleted (see verdicts above)' >&2
    exit 4
  fi
  stop_fixture_processes
  if printf '%s\n' "$verdicts" | grep -q "^prefix $PREFIX [a-z]* ours$"; then
    rm -rf "$PREFIX"
    record removed prefix "$PREFIX" 'deleted'
  fi
  for name in $ACCOUNTS; do
    if printf '%s\n' "$verdicts" | grep -q "^user $name [a-z]* ours$"; then
      dscl . -delete "$USERS_DIR/$name"
      record removed user "$name" 'deleted'
    fi
  done
  # Reconciled after the users go, as in linux/container.sh: an absent
  # group is recorded as removed, a present one must still be ours.
  for name in $FIXTURE_GROUPS; do
    if printf '%s\n' "$verdicts" | grep -q "^group $name [a-z]* ours$"; then
      if ! dscl . -read "$GROUPS_DIR/$name" >/dev/null 2>&1; then
        record removed group "$name" 'already absent'
      elif [ "$(attr "$GROUPS_DIR/$name" PrimaryGroupID)" = "$(id_of "$name")" ] &&
        [ "$(attr "$GROUPS_DIR/$name" RealName)" = "$MARK group $name" ]; then
        dscl . -delete "$GROUPS_DIR/$name"
        record removed group "$name" 'deleted'
      else
        fail "group $name changed during teardown; not deleting it"
      fi
    fi
  done
  visudo -c >/dev/null || fail 'sudoers invalid after teardown'
  if sudo -l -U "$CONTROLLER" 2>/dev/null | grep -q sem3-participant; then
    fail 'controller still holds a fixture grant'
  fi
  inventory >"$STATE/inventory-after.txt"
  unchanged=1
  if [ -f "$STATE/inventory-before.txt" ]; then
    cmp -s "$STATE/inventory-before.txt" "$STATE/inventory-after.txt" || unchanged=0
  fi
  record observed inventory after "matches-before=$unchanged"
  record removed complete "$STATE" 'teardown finished'
  export_receipts teardown
  rm -f "$STATE/.sem3-fixture" "$STATE/state.tsv" "$STATE/installed-files.txt" "$STATE/reviewed-files.txt" \
    "$STATE/sudoers.candidate" "$STATE/inventory-before.txt" "$STATE/inventory-after.txt"
  rmdir "$STATE"
  if ! collisions; then
    fail 'fixture resources remain after teardown'
  fi
  if [ "$unchanged" -ne 1 ]; then
    echo 'admin: fixture removed, but accounts, groups or sudoers differ from before setup; see the exported inventories' >&2
    exit 5
  fi
  say 'teardown complete; no fixture name, id, path or process remains'
}

# Each rehearsal step runs this script again as a fresh process, so its
# own set -e applies, and asserts the exact exit status the step needs.
step() {
  want=$1
  shift
  rc=0
  /bin/sh "$SELF" "$@" --controller "$CONTROLLER" --receipts "$RECEIPTS" --state "$REHEARSAL_STATE" || rc=$?
  [ "$rc" -eq "$want" ] || fail "rehearsal: $1 exited $rc, expected $want"
}

# Rehearsal on an isolated state directory: setup's collision refusal, a
# crashed partial setup, identity-mismatch refusal, recovery and a repeated
# no-op teardown.
rehearse() {
  require_root
  controller_checks
  receipts_checks
  staging_checks
  for path in "$REHEARSAL_STATE" "$TAMPERED_STATE"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] || fail "rehearsal path $path already exists"
  done
  staging="--staging $STAGING --manifest-sha256 $MANIFEST_SHA256"
  say "rehearsal 1: setup refuses a collision with existing account $CONTROLLER and changes nothing"
  # shellcheck disable=SC2086 # staging holds two option pairs without spaces
  step 2 setup $staging --assume-existing "$CONTROLLER"
  [ ! -e "$REHEARSAL_STATE" ] || fail 'rehearsal: the refused setup created state'
  dscl . -read "$USERS_DIR/sem3a" >/dev/null 2>&1 && fail 'rehearsal: the refused setup created sem3a'
  say 'rehearsal 2: setup crashes after creating user sem3b, before observing it'
  # shellcheck disable=SC2086
  step 99 setup $staging --fail-after user-created:sem3b
  say 'rehearsal 3: teardown of a manifest whose recorded identity differs'
  cp -Rp "$REHEARSAL_STATE" "$TAMPERED_STATE"
  sed 's/uid=3601 gid=3601 guid=[^	]*/uid=3601 gid=3601 guid=00000000-0000-0000-0000-000000000000/' \
    "$REHEARSAL_STATE/state.tsv" >"$TAMPERED_STATE/state.tsv"
  rc=0
  /bin/sh "$SELF" teardown --controller "$CONTROLLER" --receipts "$RECEIPTS" --state "$TAMPERED_STATE" || rc=$?
  [ "$rc" -eq 4 ] || fail "rehearsal: tampered teardown exited $rc, expected 4"
  dscl . -read "$USERS_DIR/sem3a" >/dev/null 2>&1 || fail 'rehearsal: the refusal deleted sem3a'
  rm -rf "$TAMPERED_STATE"
  say 'rehearsal 4: recovery teardown reconciles the unobserved user'
  step 0 teardown
  say 'rehearsal 5: setup crashes after installing the tree and the 0700 homes'
  # shellcheck disable=SC2086
  step 99 setup $staging --fail-after layout
  [ -d "$PREFIX/home/sem3a" ] || fail 'rehearsal: the crashed setup did not reach the homes'
  say 'rehearsal 6: recovery teardown removes the partly installed tree'
  step 0 teardown
  [ ! -e "$PREFIX" ] || fail 'rehearsal: the recovery left the prefix behind'
  say 'rehearsal 7: repeated teardown is a verified no-op'
  out=$(/bin/sh "$SELF" teardown --controller "$CONTROLLER" --receipts "$RECEIPTS" --state "$REHEARSAL_STATE") ||
    fail 'rehearsal: repeated teardown failed'
  printf '%s\n' "$out"
  case $out in *'no change made'*) ;; *) fail 'rehearsal: repeated teardown was not a no-op' ;; esac
  say 'rehearsal passed; the real setup may now run'
}

command=${1:-}
[ "$#" -gt 0 ] && shift
STATE=$DEFAULT_STATE
EXTRA_NAMES=
EXTRA_IDS=
while [ "$#" -gt 0 ]; do
  [ "$#" -ge 2 ] || fail "option $1 needs a value"
  case $1 in
    --controller) CONTROLLER=$2 ;;
    --receipts) RECEIPTS=$2 ;;
    --staging) STAGING=$2 ;;
    --manifest-sha256) MANIFEST_SHA256=$2 ;;
    --state) STATE=$2 ;;
    --fail-after) FAIL_AFTER=$2 ;;
    --assume-existing)
      EXTRA_NAMES=$2
      EXTRA_IDS=$(id -u "$2") || fail "no such account $2"
      ;;
    *) fail "unknown option $1" ;;
  esac
  shift 2
done
# Rehearsal-only options never touch the real state directory.
if [ -n "${FAIL_AFTER:-}" ] || [ -n "$EXTRA_NAMES" ]; then
  [ "$STATE" = "$REHEARSAL_STATE" ] || fail 'rehearsal options need the rehearsal state directory'
fi
case $command in
  setup) setup ;;
  teardown) teardown ;;
  rehearse) rehearse ;;
  listing) listing "${STAGING:?--staging DIR required}/tree" ;;
  collisions)
    if collisions; then echo 'no fixture resource exists'; else exit 3; fi
    ;;
  *) fail 'usage: admin.sh setup|teardown|rehearse|listing|collisions [options]' ;;
esac
