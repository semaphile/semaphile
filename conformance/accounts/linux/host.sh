#!/usr/bin/env bash
# SEM-3 host driver on the disposable Linux x64 VM. cloud/ansible installs
# it root-owned and runs its subcommands as root. It controls only the one
# labelled fixture container and the pinned image, never prunes, and never
# forces removal of anything shared.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

IMAGE="redis@sha256:0a0f28c99ae50da4e0504499d2cd5b41746135c64f28ec42c88dafad93f60d41"
LABEL=org.semaphile.fixture=sem3
PREFIX=/opt/semaphile-sem3
ADMIN_DIR=/run/sem3-admin
# Reserved capacity, checked before anything is created.
NEED_CPUS=4
NEED_MEMORY_KIB=$((6 * 1024 * 1024))
NEED_DISK_BYTES=$((2 * 1024 * 1024 * 1024))
# Growth ceiling for the container's writable disk layer.
MAX_LAYER_BYTES=$((32 * 1024 * 1024))

fail() {
  echo "host: $*" >&2
  exit 2
}
name_of() { echo "semaphile-sem3-$1"; }
checked_run() { [[ $1 =~ ^[a-z0-9-]{6,48}$ ]] || fail 'bad run id'; }
docker_root() { docker info --format '{{.DockerRootDir}}'; }

# Every presence question is asked with a query whose failure stops the
# script: an empty answer from a failed command must never read as
# "absent" (that is how an audit passes while Docker is broken).
containers_labelled() { docker ps -a -q --no-trunc --filter "label=$LABEL" || fail 'docker ps failed'; }
volumes_labelled() { docker volume ls -q --filter "label=$LABEL" || fail 'docker volume ls failed'; }
networks_labelled() { docker network ls -q --no-trunc --filter "label=$LABEL" || fail 'docker network ls failed'; }
container_exists() {
  local out
  out=$(docker ps -a -q --no-trunc --filter "id=$1") || fail 'docker ps failed'
  [ -n "$out" ]
}
container_named() {
  local out
  out=$(docker ps -a -q --no-trunc --filter "name=^/$1\$") || fail 'docker ps failed'
  [ -n "$out" ]
}
# The pinned image by digest; prints its id when present.
pinned_image_id() {
  local rows
  rows=$(docker image ls --digests --no-trunc --format '{{.Repository}}@{{.Digest}} {{.ID}}') ||
    fail 'docker image ls failed'
  printf '%s\n' "$rows" | awk -v want="$IMAGE" '$1 == want { print $2; exit }'
}
image_present() {
  local ids
  ids=$(docker image ls -q --no-trunc) || fail 'docker image ls failed'
  printf '%s\n' "$ids" | grep -qx "$1"
}

preflight() {
  checked_run "$1"
  local name cpus mem disk found id
  name=$(name_of "$1")
  cpus=$(nproc)
  mem=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
  disk=$(df -B1 --output=avail "$(docker_root)" | tail -1)
  echo "arch=$(uname -m) kernel=$(uname -r) cpus=$cpus mem_available_kib=$mem docker_disk_available=$disk"
  echo "docker=$(docker version --format '{{.Server.Version}}') storage=$(docker info --format '{{.Driver}}')"
  [ "$(uname -m)" = x86_64 ] || fail 'host is not x86_64'
  [ "$cpus" -ge "$NEED_CPUS" ] || fail "only $cpus CPUs"
  [ "$mem" -ge "$NEED_MEMORY_KIB" ] || fail "only $mem KiB memory available"
  [ "$disk" -ge "$NEED_DISK_BYTES" ] || fail "only $disk bytes free for Docker"
  found=$(containers_labelled)
  [ -z "$found" ] || fail 'a fixture container already exists'
  found=$(volumes_labelled)
  [ -z "$found" ] || fail 'a fixture volume already exists'
  found=$(networks_labelled)
  [ -z "$found" ] || fail 'a fixture network already exists'
  ! container_named "$name" || fail "container $name exists"
  id=$(pinned_image_id)
  if [ -n "$id" ]; then echo "image=preexisting id=$id"; else echo 'image=absent'; fi
  echo 'preflight=ok'
}

pull() {
  local id os arch
  id=$(pinned_image_id)
  if [ -n "$id" ]; then
    echo "introduced=0 id=$id"
    return
  fi
  docker pull --quiet --platform linux/amd64 "$IMAGE" >/dev/null
  os=$(docker image inspect --format '{{.Os}}' "$IMAGE")
  arch=$(docker image inspect --format '{{.Architecture}}' "$IMAGE")
  [ "$os/$arch" = linux/amd64 ] || fail "pulled $os/$arch"
  id=$(pinned_image_id)
  [ -n "$id" ] || fail 'the pulled image is not listed by its pinned digest'
  echo "introduced=1 id=$id digests=$(docker image inspect --format '{{json .RepoDigests}}' "$IMAGE")"
}

create() {
  checked_run "$1"
  local name id
  name=$(name_of "$1")
  id=$(docker create --name "$name" \
    --label "$LABEL" --label "org.semaphile.run=$1" \
    --hostname sem3-linux --network none --init --user 0:0 \
    --cpus 2 --memory 3g --memory-swap 3g --pids-limit 512 \
    --ulimit nofile=4096:4096 --shm-size 16m --stop-timeout 5 \
    --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add KILL --cap-add SETPCAP \
    --security-opt no-new-privileges --log-driver none \
    --tmpfs "$PREFIX:rw,exec,nosuid,nodev,size=1536m,mode=0755" \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --tmpfs /var/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --tmpfs /run:rw,noexec,nosuid,nodev,size=16m,mode=0755 \
    --tmpfs /data:rw,noexec,nosuid,nodev,size=1m,mode=0755 \
    --entrypoint /bin/sleep "$IMAGE" infinity)
  docker start "$id" >/dev/null
  echo "container=$id name=$name"
  inspect "$1"
}

inspect() {
  checked_run "$1"
  local name
  name=$(name_of "$1")
  docker container inspect --size --format \
    '{"id":{{json .Id}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"privileged":{{json .HostConfig.Privileged}},"capAdd":{{json .HostConfig.CapAdd}},"capDrop":{{json .HostConfig.CapDrop}},"securityOpt":{{json .HostConfig.SecurityOpt}},"nanoCpus":{{json .HostConfig.NanoCpus}},"memory":{{json .HostConfig.Memory}},"memorySwap":{{json .HostConfig.MemorySwap}},"pidsLimit":{{json .HostConfig.PidsLimit}},"tmpfs":{{json .HostConfig.Tmpfs}},"binds":{{json .HostConfig.Binds}},"mounts":{{json .Mounts}},"portBindings":{{json .HostConfig.PortBindings}},"log":{{json .HostConfig.LogConfig.Type}},"sizeRw":{{json .SizeRw}},"state":{{json .State.Status}}}' \
    "$name"
}

# Growth abort: the writable layer must stay under its ceiling.
size() {
  checked_run "$1"
  local name layer
  name=$(name_of "$1")
  layer=$(docker container inspect --size --format '{{.SizeRw}}' "$name")
  echo "sizeRw=$layer"
  docker exec "$name" df -B1 --output=target,size,used "$PREFIX" /tmp /var/tmp /run /data
  if [ "$layer" -gt "$MAX_LAYER_BYTES" ]; then
    echo 'growth ceiling exceeded: stopping the fixture container' >&2
    docker stop --time 5 "$name" >/dev/null
    exit 6
  fi
}

# stdin carries the bundle; its hash is taken after transfer, inside.
load() {
  checked_run "$1"
  docker exec -i "$(name_of "$1")" /bin/sh -c \
    "umask 077 && mkdir -p $PREFIX/.incoming/x $PREFIX/.incoming/home && cat > $PREFIX/.incoming/bundle.tgz && sha256sum $PREFIX/.incoming/bundle.tgz"
}

# Unpack, then run container.sh only if its bytes match the reviewed listing.
unpack() {
  checked_run "$1"
  [[ $2 =~ ^[0-9a-f]{64}$ ]] || fail 'bad listing hash'
  docker exec "$(name_of "$1")" /bin/sh -c "
    set -eu
    tar -xzf $PREFIX/.incoming/bundle.tgz -C $PREFIX/.incoming/x --no-same-owner
    echo '$2  $PREFIX/.incoming/x/STAGED-FILES.txt' | sha256sum -c -
    want=\$(awk '\$4 == \"./checkout/conformance/accounts/linux/container.sh\" { print \$3 }' $PREFIX/.incoming/x/STAGED-FILES.txt)
    echo \"\$want  $PREFIX/.incoming/x/tree/checkout/conformance/accounts/linux/container.sh\" | sha256sum -c -
    mkdir -m 0700 $ADMIN_DIR
    cp $PREFIX/.incoming/x/tree/checkout/conformance/accounts/linux/container.sh $ADMIN_DIR/container.sh
    echo \"\$want  $ADMIN_DIR/container.sh\" | sha256sum -c -"
}

# The verified admin script runs from a root-only copy outside the prefix,
# so teardown, which empties the prefix, can run again as a no-op.
admin() {
  checked_run "$1"
  shift
  docker exec "$(name_of "$RUN")" /bin/sh "$ADMIN_DIR/container.sh" "$@"
}

# A full pass only: no filter or skip flag can reach the controller here.
controller() {
  checked_run "$1"
  [[ $2 =~ ^[a-z0-9-]{6,48}$ ]] || fail 'bad controller run id'
  [ "$#" -eq 2 ] || fail 'controller takes only RUN and the pass id'
  docker exec "$(name_of "$1")" "$PREFIX/runtime/node/bin/node" \
    "$PREFIX/checkout/conformance/accounts/controller.mjs" run --run "$2" \
    --receipts "$PREFIX/checkout/.tmp/controller/receipts-$2"
}

export_receipts() {
  checked_run "$1"
  [[ $2 =~ ^[a-z0-9-]{6,48}$ ]] || fail 'bad controller run id'
  docker exec "$(name_of "$1")" tar -C "$PREFIX/checkout/.tmp/controller" -cz "receipts-$2"
}

# The run's containers, found by both labels; used when an interrupted run
# never recorded its container id.
find_run() {
  checked_run "$1"
  docker ps -a -q --no-trunc --filter "label=$LABEL" --filter "label=org.semaphile.run=$1" || fail 'docker ps failed'
}

# teardown RUN CONTAINER|- INTRODUCED: removes the run's container (by id,
# or by its labels when none was recorded) and, when the run introduced the
# pinned image and nothing else uses it, that image.
teardown() {
  checked_run "$1"
  local wanted=$2 introduced=$3 ids id labels image users
  [[ $introduced =~ ^[01]$ ]] || fail 'introduced must be 0 or 1'
  if [ "$wanted" = - ]; then
    ids=$(find_run "$1")
  else
    [[ $wanted =~ ^[0-9a-f]{64}$ ]] || fail 'container id required'
    ids=$wanted
  fi
  for id in $ids; do
    if container_exists "$id"; then
      labels=$(docker container inspect --format '{{index .Config.Labels "org.semaphile.run"}} {{index .Config.Labels "org.semaphile.fixture"}}' "$id")
      [ "$labels" = "$1 sem3" ] || fail "container $id is not this run's fixture ($labels); not removing"
      docker stop --time 5 "$id" >/dev/null
      docker rm "$id" >/dev/null
      echo "container=removed id=$id"
    else
      echo "container=absent id=$id"
    fi
  done
  [ -n "$ids" ] || echo 'container=none recorded or labelled'
  image=$(pinned_image_id)
  if [ "$introduced" = 1 ] && [ -n "$image" ]; then
    users=$(docker ps -a -q --no-trunc --filter "ancestor=$image") || fail 'docker ps failed'
    if [ -n "$users" ]; then
      echo "image=shared id=$image: another container uses it; owner disposition required" >&2
      exit 5
    fi
    docker image rm "$image" >/dev/null || {
      echo "image=refused id=$image: owner disposition required" >&2
      exit 5
    }
    echo "image=removed id=$image"
  else
    echo "image=left introduced=$introduced"
  fi
  audit "$1" "$introduced"
}

audit() {
  checked_run "$1"
  local found=0 out
  out=$(containers_labelled)
  if [ -n "$out" ]; then
    echo 'audit: fixture container remains'
    found=1
  fi
  out=$(volumes_labelled)
  if [ -n "$out" ]; then
    echo 'audit: fixture volume remains'
    found=1
  fi
  out=$(networks_labelled)
  if [ -n "$out" ]; then
    echo 'audit: fixture network remains'
    found=1
  fi
  out=$(pinned_image_id)
  if [ "${2:-0}" = 1 ] && [ -n "$out" ]; then
    echo "audit: introduced image remains ($out)"
    found=1
  fi
  echo "docker_disk_available=$(df -B1 --output=avail "$(docker_root)" | tail -1)"
  [ "$found" -eq 0 ] && echo 'audit=clean'
  return "$found"
}

command=${1:-}
[ "$#" -gt 0 ] && shift
RUN=${1:-}
case $command in
  preflight | create | inspect | size | load | export_receipts | controller | unpack | teardown | audit) "$command" "$@" ;;
  find) find_run "$@" ;;
  pull) pull ;;
  admin) admin "$@" ;;
  *) fail 'usage: host.sh preflight|pull|create|inspect|size|load|unpack|admin|controller|export_receipts|find|teardown|audit RUN ...' ;;
esac
