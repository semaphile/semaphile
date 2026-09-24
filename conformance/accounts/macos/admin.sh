#!/bin/sh
# SEM-3 macOS account fixture administration: setup, teardown, rehearsal,
# a read-only collision check and the tree listing used to verify installs.
#
# The owner runs a root-private copy verified against the reviewed SHA-256
# (conformance/accounts/README.md). Setup refuses any pre-existing fixture
# name, id or path before changing anything; every resource is recorded as
# intended before it is created and as observed right after. Teardown
# verifies every recorded identity first and deletes nothing if any differs.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 022

PREFIX=/opt/semaphile-sem3
SUDOERS=/private/etc/sudoers.d/semaphile-sem3
DEFAULT_STATE=/var/db/semaphile-sem3
ACCOUNTS='sem3a sem3b sem3c'
FIXTURE_GROUPS='sem3a sem3b sem3c sem3ab'
MARK='Semaphile SEM-3 fixture'

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
  (
    cd "$1"
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

collisions() {
  found=0
  for name in $ACCOUNTS $EXTRA_NAMES; do
    if dscl . -read "/Users/$name" >/dev/null 2>&1; then
      echo "collision: user $name exists"
      found=1
    fi
  done
  for name in $FIXTURE_GROUPS $EXTRA_NAMES; do
    if dscl . -read "/Groups/$name" >/dev/null 2>&1; then
      echo "collision: group $name exists"
      found=1
    fi
  done
  for id in 3601 3602 3603 3610 $EXTRA_IDS; do
    if [ -n "$(dscl . -search /Users UniqueID "$id")" ]; then
      echo "collision: uid $id in use"
      found=1
    fi
    if [ -n "$(dscl . -search /Groups PrimaryGroupID "$id")" ]; then
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
export_receipts() {
  target="$RECEIPTS/$(basename "$STATE")-$1-$(date -u +%Y%m%dT%H%M%SZ).tsv"
  cp "$STATE/state.tsv" "$target"
  chown "$CONTROLLER" "$target"
  chmod 0600 "$target"
  say "state exported to $target"
}

create_group() {
  name=$1
  gid=$(id_of "$name")
  record intended group "$name" "gid=$gid"
  dseditgroup -o create -n . -i "$gid" -r "$MARK group $name" "$name"
  record observed group "$name" "gid=$(attr "/Groups/$name" PrimaryGroupID) guid=$(attr "/Groups/$name" GeneratedUID)"
}
create_user() {
  name=$1
  uid=$(id_of "$name")
  record intended user "$name" "uid=$uid gid=$uid home=$PREFIX/home/$name"
  dscl . -create "/Users/$name"
  dscl . -create "/Users/$name" UniqueID "$uid"
  dscl . -create "/Users/$name" PrimaryGroupID "$uid"
  dscl . -create "/Users/$name" RealName "$MARK user $name"
  dscl . -create "/Users/$name" NFSHomeDirectory "$PREFIX/home/$name"
  dscl . -create "/Users/$name" UserShell /usr/bin/false
  dscl . -create "/Users/$name" Password '*'
  dscl . -create "/Users/$name" IsHidden 1
  maybe_fail "user-created:$name"
  record observed user "$name" "uid=$(attr "/Users/$name" UniqueID) gid=$(attr "/Users/$name" PrimaryGroupID) guid=$(attr "/Users/$name" GeneratedUID)"
}

setup() {
  require_root
  controller_checks
  receipts_checks
  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail 'native macOS arm64 only'
  grep -Eq '^[#@]includedir /private/etc/sudoers\.d$' /private/etc/sudoers || fail 'sudoers does not include sudoers.d'
  [ -n "${STAGING:-}" ] && [ -d "$STAGING/tree" ] || fail '--staging DIR with tree/ is required'
  [ "$(stat -f %u "$STAGING")" = "$CONTROLLER_UID" ] || fail 'staging is not owned by the controller'
  actual=$(shasum -a 256 "$STAGING/STAGED-FILES.txt" | awk '{ print $1 }')
  [ "$actual" = "${MANIFEST_SHA256:-}" ] || fail "staged listing $actual is not the reviewed $MANIFEST_SHA256"
  if ! collisions; then
    fail 'refusing: fixture resources already exist; nothing was changed'
  fi
  RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -m 0755 "$STATE"
  printf '%s run %s\n' "$MARK" "$RUN" >"$STATE/.sem3-fixture"
  : >"$STATE/state.tsv"
  record observed state "$STATE" "run=$RUN controller=$CONTROLLER manifest=$MANIFEST_SHA256"
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
  ditto --noextattr --noqtn --norsrc --noacl "$STAGING/tree" "$PREFIX"
  chown -R -h root:wheel "$PREFIX"
  chmod -R u+rwX,go+rX,go-w "$PREFIX"
  find "$PREFIX" -perm -4000 -o -perm -2000 | grep -q . && fail 'set-id bit in staged tree'
  listing "$PREFIX" >"$STATE/installed-files.txt"
  cmp -s "$STATE/installed-files.txt" "$STAGING/STAGED-FILES.txt" || fail 'installed tree differs from the reviewed listing'
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
        dir=/Groups
        [ "$class" = user ] && dir=/Users
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
      tree | layout | complete | refused) verdict=info ;;
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
  if printf '%s\n' "$verdicts" | grep -q "^prefix $PREFIX [a-z]* ours$"; then
    rm -rf "$PREFIX"
    record removed prefix "$PREFIX" 'deleted'
  fi
  for name in $ACCOUNTS; do
    if printf '%s\n' "$verdicts" | grep -q "^user $name [a-z]* ours$"; then
      dscl . -delete "/Users/$name"
      record removed user "$name" 'deleted'
    fi
  done
  for name in $FIXTURE_GROUPS; do
    if printf '%s\n' "$verdicts" | grep -q "^group $name [a-z]* ours$"; then
      dscl . -delete "/Groups/$name"
      record removed group "$name" 'deleted'
    fi
  done
  visudo -c >/dev/null || fail 'sudoers invalid after teardown'
  if sudo -l -U "$CONTROLLER" 2>/dev/null | grep -q sem3-participant; then
    fail 'controller still holds a fixture grant'
  fi
  record removed complete "$STATE" 'teardown finished'
  export_receipts teardown
  rm -f "$STATE/.sem3-fixture" "$STATE/state.tsv" "$STATE/installed-files.txt" "$STATE/sudoers.candidate"
  rmdir "$STATE"
  if ! collisions; then
    fail 'fixture resources remain after teardown'
  fi
  say 'teardown complete; no fixture name, id or path remains'
}

# Rehearsal on an isolated state directory: collision refusal, a crashed
# partial setup, identity-mismatch refusal, recovery and a repeated no-op.
rehearse() {
  require_root
  controller_checks
  receipts_checks
  real_state=$STATE
  STATE=/var/db/semaphile-sem3-rehearsal
  say "rehearsal 1: collision refusal using existing account $CONTROLLER"
  if (EXTRA_NAMES=$CONTROLLER EXTRA_IDS=$CONTROLLER_UID collisions); then
    fail 'rehearsal: collision check missed an existing account'
  fi
  [ ! -e "$STATE" ] || fail 'rehearsal state already exists'
  say 'rehearsal 2: setup crashes after creating user sem3b, before observing it'
  if (FAIL_AFTER=user-created:sem3b setup); then
    fail 'rehearsal: injected failure did not stop setup'
  fi
  say 'rehearsal 3: teardown of a manifest whose recorded identity differs'
  tampered=/var/db/semaphile-sem3-rehearsal-tampered
  rm -rf "$tampered"
  cp -Rp "$STATE" "$tampered"
  sed 's/uid=3601 gid=3601 guid=[^	]*/uid=3601 gid=3601 guid=00000000-0000-0000-0000-000000000000/' \
    "$STATE/state.tsv" >"$tampered/state.tsv"
  if (STATE=$tampered teardown); then
    fail 'rehearsal: mismatched identity was not refused'
  fi
  dscl . -read /Users/sem3a >/dev/null 2>&1 || fail 'rehearsal: refusal deleted sem3a'
  rm -rf "$tampered"
  say 'rehearsal 4: recovery teardown reconciles the unobserved user'
  teardown
  say 'rehearsal 5: repeated teardown is a verified no-op'
  teardown
  STATE=$real_state
  say 'rehearsal passed; the real setup may now run'
}

command=${1:-}
[ "$#" -gt 0 ] && shift
STATE=$DEFAULT_STATE
EXTRA_NAMES=
EXTRA_IDS=
while [ "$#" -gt 0 ]; do
  case $1 in
    --controller) CONTROLLER=$2 ;;
    --receipts) RECEIPTS=$2 ;;
    --staging) STAGING=$2 ;;
    --manifest-sha256) MANIFEST_SHA256=$2 ;;
    --state) STATE=$2 ;;
    --fail-after) FAIL_AFTER=$2 ;;
    *) fail "unknown option $1" ;;
  esac
  shift 2
done
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
