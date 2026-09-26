#!/bin/sh
# SEM-3 Linux fixture administration inside the isolated container: setup,
# teardown, rehearsal, a read-only collision check and the tree listing.
# Runs as container root, which holds only CHOWN, SETUID, SETGID, KILL and
# SETPCAP (setpriv needs SETPCAP to clear a child's bounding set). Without
# DAC_OVERRIDE, root cannot enter another identity's 0700 directory, so
# teardown empties each such directory as its owner.
# Same state-log discipline as macos/admin.sh: intended before created,
# observed right after, and teardown deletes nothing on any mismatch.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 022

PREFIX=/opt/semaphile-sem3
INCOMING=$PREFIX/.incoming
DEFAULT_STATE=/var/lib/semaphile-sem3
ACCOUNTS='sem3a sem3b sem3c'
FIXTURE_GROUPS='sem3a sem3b sem3c sem3ab'
MARK='Semaphile SEM-3 fixture'

fail() {
  echo "container: $*" >&2
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

listing() {
  (
    cd "$1"
    find . \( -path ./home -o -path ./shared -o -path ./checkout/.tmp -o -path ./.incoming -o -path ./checkout/conformance/accounts/node_modules -o -name .sem3-fixture \) -prune \
      -o -type d -print | sed 's/^/d - - /'
    find . \( -path ./home -o -path ./shared -o -path ./checkout/.tmp -o -path ./.incoming -o -path ./checkout/conformance/accounts/node_modules \) -prune -o -type l -print |
      while IFS= read -r path; do printf 'l - %s %s\n' "$(readlink "$path")" "$path"; done
    find . \( -path ./home -o -path ./shared -o -path ./checkout/.tmp -o -path ./.incoming -o -path ./checkout/conformance/accounts/node_modules -o -name .sem3-fixture \) -prune \
      -o -type f -exec sha256sum {} + | while read -r sum path; do
      if [ -x "$path" ]; then mode=x; else mode=-; fi
      printf 'f %s %s %s\n' "$mode" "$sum" "$path"
    done
  ) | LC_ALL=C sort -k4
}

# The image ships no procps: find a UID's live processes through /proc.
# Zombies hold no resources and are reaped by the container's init.
pids_of() {
  for proc_status in /proc/[0-9]*/status; do
    awk -v u="$1" '
      $1 == "Uid:" && ($2 == u || $3 == u || $4 == u) { owned = 1 }
      $1 == "State:" && $2 == "Z" { zombie = 1 }
      END { exit !(owned && !zombie) }' "$proc_status" 2>/dev/null || continue
    pid=${proc_status#/proc/}
    echo "${pid%/status}"
  done
}

empty_owned_dirs() {
  find "$PREFIX" -mindepth 1 -type d ! -user 0 -prune -print | while IFS= read -r dir; do
    setpriv --reuid="$(stat -c %u "$dir")" --regid="$(stat -c %g "$dir")" --clear-groups \
      --inh-caps=-all --bounding-set=-all --no-new-privs -- find "$dir" -mindepth 1 -delete
  done
}

record() { printf '%s\t%s\t%s\t%s\t%s\n' "$(now)" "$1" "$2" "$3" "$4" >>"$STATE/state.tsv"; }
latest() { awk -F '\t' -v c="$1" -v n="$2" '$3 == c && $4 == n { line = $0 } END { print line }' "$STATE/state.tsv"; }
field() { printf '%s\n' "$1" | awk -F '\t' -v i="$2" '{ print $i }'; }

prefix_empty() {
  awk -v p="$PREFIX" '$2 == p && $3 == "tmpfs" { found = 1 } END { exit !found }' /proc/mounts || return 1
  [ -z "$(find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name .incoming -print -quit)" ]
}

collisions() {
  found=0
  for name in $ACCOUNTS $EXTRA_NAMES; do
    if getent passwd "$name" >/dev/null; then
      echo "collision: user $name exists"
      found=1
    fi
  done
  for name in $FIXTURE_GROUPS $EXTRA_NAMES; do
    if getent group "$name" >/dev/null; then
      echo "collision: group $name exists"
      found=1
    fi
  done
  for id in 3601 3602 3603 3610 $EXTRA_IDS; do
    if getent passwd "$id" >/dev/null; then
      echo "collision: uid $id in use"
      found=1
    fi
    if getent group "$id" >/dev/null; then
      echo "collision: gid $id in use"
      found=1
    fi
  done
  if [ -e "$STATE" ]; then
    echo "collision: $STATE exists"
    found=1
  fi
  if ! prefix_empty; then
    echo "collision: $PREFIX is not an empty fixture tmpfs"
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

create_group() {
  name=$1
  gid=$(id_of "$name")
  record intended group "$name" "gid=$gid"
  groupadd -g "$gid" "$name"
  record observed group "$name" "entry=$(getent group "$name" | cut -d: -f1,3)"
}
create_user() {
  name=$1
  uid=$(id_of "$name")
  record intended user "$name" "uid=$uid gid=$uid home=$PREFIX/home/$name"
  useradd -u "$uid" -g "$uid" -M -d "$PREFIX/home/$name" -s /usr/sbin/nologin -c "$MARK user $name" "$name"
  maybe_fail "user-created:$name"
  record observed user "$name" "entry=$(getent passwd "$name")"
}

# Install the verified bundle's tree, create identities and the layout.
setup() {
  [ "$(id -u)" -eq 0 ] || fail 'run as container root'
  [ "$(uname -m)" = x86_64 ] || [ -n "${ALLOW_ARCH:-}" ] || fail 'Linux x64 only'
  [ -f "$INCOMING/x/STAGED-FILES.txt" ] || fail 'unpacked bundle missing'
  actual=$(sha256sum "$INCOMING/x/STAGED-FILES.txt" | cut -d' ' -f1)
  [ "$actual" = "${MANIFEST_SHA256:-}" ] || fail "staged listing $actual is not the reviewed $MANIFEST_SHA256"
  listing "$INCOMING/x/tree" | cmp -s - "$INCOMING/x/STAGED-FILES.txt" || fail 'unpacked tree differs from the reviewed listing'
  # Sticky shared temporary directories are expected (participants use
  # their private TMPDIR); a non-sticky world-writable one is refused.
  wide=$(find / -xdev -type d -perm -0002 ! -perm -1000 -print 2>/dev/null | head -5)
  [ -z "$wide" ] || fail "non-sticky world-writable directories on the container disk: $wide"
  if ! collisions; then
    fail 'refusing: fixture resources already exist; nothing was changed'
  fi
  RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -m 0755 "$STATE"
  printf '%s run %s\n' "$MARK" "$RUN" >"$STATE/.sem3-fixture"
  : >"$STATE/state.tsv"
  record observed state "$STATE" "run=$RUN manifest=$MANIFEST_SHA256"
  say "setup $RUN: groups"
  for name in $FIXTURE_GROUPS; do create_group "$name"; done
  maybe_fail groups
  say 'users'
  for name in $ACCOUNTS; do create_user "$name"; done
  for name in sem3a sem3b; do
    record intended member sem3ab:"$name" 'group=sem3ab'
    usermod -a -G sem3ab "$name"
    record observed member sem3ab:"$name" 'group=sem3ab'
  done
  maybe_fail users
  say 'tree'
  record intended prefix "$PREFIX" "run=$RUN"
  printf '%s run %s\n' "$MARK" "$RUN" >"$PREFIX/.sem3-fixture"
  for entry in bin runtime checkout; do
    mv "$INCOMING/x/tree/$entry" "$PREFIX/$entry"
  done
  chown -R -h 0:0 "$PREFIX/bin" "$PREFIX/runtime" "$PREFIX/checkout"
  chmod -R u+rwX,go+rX,go-w "$PREFIX/bin" "$PREFIX/runtime" "$PREFIX/checkout"
  record observed prefix "$PREFIX" "run=$RUN"
  say 'offline install of the candidate archives'
  (
    cd "$PREFIX/checkout/conformance/accounts"
    # Archive hashes immediately before installation.
    (cd "$PREFIX/checkout/releases/candidates/redis-messaging/0.3.0/800c8c53b8548250da6bf4a684bf796f1e9e1a73" && sha256sum -c SHA256SUMS)
    HOME=$INCOMING/home PATH="$PREFIX/runtime/node/bin:$PATH" npm_config_update_notifier=false \
      "$PREFIX/runtime/node/bin/npm" ci --offline --ignore-scripts --omit=dev --no-audit --no-fund \
      --cache "$INCOMING/x/npm-cache" --logs-max=0
  )
  chown -R -h 0:0 "$PREFIX/checkout/conformance/accounts/node_modules"
  chmod -R u+rwX,go+rX,go-w "$PREFIX/checkout/conformance/accounts/node_modules"
  find "$PREFIX" -xdev \( -perm -4000 -o -perm -2000 \) -print | grep -q . && fail 'set-id bit in the installed tree'
  listing "$PREFIX" | cmp -s - "$INCOMING/x/STAGED-FILES.txt" || fail 'installed tree differs from the reviewed listing'
  record observed tree "$PREFIX" "sha256=$MANIFEST_SHA256"
  maybe_fail tree
  say 'homes, scratch and handoff share'
  mkdir -m 0755 "$PREFIX/home" "$PREFIX/shared" "$PREFIX/checkout/.tmp" "$PREFIX/checkout/.tmp/participants" "$PREFIX/checkout/.tmp/redis"
  mkdir -m 0700 "$PREFIX/checkout/.tmp/controller"
  for name in $ACCOUNTS; do
    uid=$(id_of "$name")
    for dir in "$PREFIX/home/$name" "$PREFIX/checkout/.tmp/participants/$name"; do
      mkdir -m 0700 "$dir"
      chown "$uid:$uid" "$dir"
    done
  done
  chmod 0750 "$PREFIX/shared"
  chown 0:3610 "$PREFIX/shared"
  printf 'synthetic SEM-3 handoff data\n' >"$PREFIX/shared/handoff.txt"
  chmod 0640 "$PREFIX/shared/handoff.txt"
  chown 0:3610 "$PREFIX/shared/handoff.txt"
  record observed layout "$PREFIX" 'homes=0700 shared=0750 handoff=0640'
  rm -rf "$INCOMING"
  record observed complete "$RUN" 'setup finished'
  cat "$STATE/state.tsv"
  say "setup $RUN complete"
}

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
      user)
        entry=$(getent passwd "$name" || true)
        if [ -z "$entry" ]; then
          verdict=absent
        elif [ "$status" = observed ] && [ "entry=$entry" != "$attrs" ]; then
          verdict=mismatch
        elif [ "$status" = intended ]; then
          uid=$(id_of "$name")
          [ "$entry" = "$name:x:$uid:$uid:$MARK user $name:$PREFIX/home/$name:/usr/sbin/nologin" ] || verdict=mismatch
        fi
        ;;
      group)
        entry=$(getent group "$name" | cut -d: -f1,3 || true)
        if [ -z "$entry" ]; then
          verdict=absent
        elif [ "$entry" != "$name:$(id_of "$name")" ]; then
          verdict=mismatch
        fi
        ;;
      prefix)
        if [ ! -f "$PREFIX/.sem3-fixture" ]; then
          verdict=absent
        elif ! grep -qx "$MARK run ${attrs#run=}" "$PREFIX/.sem3-fixture"; then
          verdict=mismatch
        fi
        ;;
      member)
        id -nG "${name#*:}" 2>/dev/null | tr ' ' '\n' | grep -qx sem3ab || verdict=absent
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
  [ "$(id -u)" -eq 0 ] || fail 'run as container root'
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
  if [ "$clean" -ne 1 ]; then
    record observed refused "$STATE" 'identity mismatch; nothing deleted'
    echo 'container: identity mismatch: nothing deleted (see verdicts above)' >&2
    exit 4
  fi
  for name in $ACCOUNTS; do
    if printf '%s\n' "$verdicts" | grep -q "^user $name [a-z]* ours$"; then
      for pid in $(pids_of "$(id_of "$name")"); do
        kill -KILL "$pid" 2>/dev/null || true
      done
    fi
  done
  for name in $ACCOUNTS; do
    if [ -n "$(pids_of "$(id_of "$name")")" ]; then
      fail "processes of $name survived; nothing further deleted"
    fi
  done
  if printf '%s\n' "$verdicts" | grep -q "^prefix $PREFIX [a-z]* ours$"; then
    empty_owned_dirs
    find "$PREFIX" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    record removed prefix "$PREFIX" 'emptied'
  fi
  for name in $ACCOUNTS; do
    if printf '%s\n' "$verdicts" | grep -q "^user $name [a-z]* ours$"; then
      userdel "$name"
      record removed user "$name" 'deleted'
    fi
  done
  for name in $FIXTURE_GROUPS; do
    if printf '%s\n' "$verdicts" | grep -q "^group $name [a-z]* ours$"; then
      groupdel "$name"
      record removed group "$name" 'deleted'
    fi
  done
  record removed complete "$STATE" 'teardown finished'
  cat "$STATE/state.tsv"
  rm -f "$STATE/.sem3-fixture" "$STATE/state.tsv"
  rmdir "$STATE"
  if ! collisions; then
    fail 'fixture resources remain after teardown'
  fi
  say 'teardown complete; no fixture name, id or path remains'
}

rehearse() {
  real_state=$STATE
  STATE=/var/lib/semaphile-sem3-rehearsal
  say 'rehearsal 1: collision refusal using the image service account'
  if (EXTRA_NAMES=redis EXTRA_IDS=999 collisions); then
    fail 'rehearsal: collision check missed an existing account'
  fi
  say 'rehearsal 2: setup crashes after creating user sem3b, before observing it'
  if (FAIL_AFTER=user-created:sem3b setup); then
    fail 'rehearsal: injected failure did not stop setup'
  fi
  say 'rehearsal 3: teardown of a manifest whose recorded identity differs'
  tampered=/var/lib/semaphile-sem3-rehearsal-tampered
  rm -rf "$tampered"
  cp -Rp "$STATE" "$tampered"
  sed 's/entry=sem3a:x:3601:3601:/entry=sem3a:x:3601:3999:/' "$STATE/state.tsv" >"$tampered/state.tsv"
  if (STATE=$tampered teardown); then
    fail 'rehearsal: mismatched identity was not refused'
  fi
  getent passwd sem3a >/dev/null || fail 'rehearsal: refusal deleted sem3a'
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
    --manifest-sha256) MANIFEST_SHA256=$2 ;;
    --state) STATE=$2 ;;
    --fail-after) FAIL_AFTER=$2 ;;
    --tree) TREE=$2 ;;
    *) fail "unknown option $1" ;;
  esac
  shift 2
done
case $command in
  setup) setup ;;
  teardown) teardown ;;
  rehearse) rehearse ;;
  listing) listing "${TREE:?--tree DIR required}" ;;
  collisions)
    if collisions; then echo 'no fixture resource exists'; else exit 3; fi
    ;;
  *) fail 'usage: container.sh setup|teardown|rehearse|listing|collisions [options]' ;;
esac
