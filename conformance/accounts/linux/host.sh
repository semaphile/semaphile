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

preflight() {
  checked_run "$1"
  local name cpus mem disk
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
  [ -z "$(docker ps -a -q --filter "label=$LABEL")" ] || fail 'a fixture container already exists'
  [ -z "$(docker volume ls -q --filter "label=$LABEL")" ] || fail 'a fixture volume already exists'
  [ -z "$(docker network ls -q --filter "label=$LABEL")" ] || fail 'a fixture network already exists'
  ! docker container inspect "$name" >/dev/null 2>&1 || fail "container $name exists"
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "image=preexisting id=$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  else
    echo 'image=absent'
  fi
  echo 'preflight=ok'
}

pull() {
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "introduced=0 id=$(docker image inspect --format '{{.Id}}' "$IMAGE")"
    return
  fi
  docker pull --quiet --platform linux/amd64 "$IMAGE" >/dev/null
  local os arch
  os=$(docker image inspect --format '{{.Os}}' "$IMAGE")
  arch=$(docker image inspect --format '{{.Architecture}}' "$IMAGE")
  [ "$os/$arch" = linux/amd64 ] || fail "pulled $os/$arch"
  echo "introduced=1 id=$(docker image inspect --format '{{.Id}}' "$IMAGE") digests=$(docker image inspect --format '{{json .RepoDigests}}' "$IMAGE")"
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

controller() {
  checked_run "$1"
  [[ $2 =~ ^[a-z0-9-]{6,48}$ ]] || fail 'bad controller run id'
  docker exec "$(name_of "$1")" "$PREFIX/runtime/node/bin/node" \
    "$PREFIX/checkout/conformance/accounts/controller.mjs" run --run "$2" \
    --receipts "$PREFIX/checkout/.tmp/controller/receipts-$2" "${@:3}"
}

export_receipts() {
  checked_run "$1"
  [[ $2 =~ ^[a-z0-9-]{6,48}$ ]] || fail 'bad controller run id'
  docker exec "$(name_of "$1")" tar -C "$PREFIX/checkout/.tmp/controller" -cz "receipts-$2"
}

teardown() {
  checked_run "$1"
  [[ $2 =~ ^[0-9a-f]{64}$ ]] || fail 'container id required'
  local introduced=$3 image=$4 labels
  if docker container inspect "$2" >/dev/null 2>&1; then
    labels=$(docker container inspect --format '{{index .Config.Labels "org.semaphile.run"}} {{index .Config.Labels "org.semaphile.fixture"}}' "$2")
    [ "$labels" = "$1 sem3" ] || fail "container $2 is not this run's fixture ($labels); not removing"
    docker stop --time 5 "$2" >/dev/null
    docker rm "$2" >/dev/null
    echo "container=removed id=$2"
  else
    echo "container=absent id=$2"
  fi
  if [ "$introduced" = 1 ] && docker image inspect "$image" >/dev/null 2>&1; then
    if [ -n "$(docker ps -a -q --filter "ancestor=$image")" ]; then
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
  audit "$1" "$introduced" "$image"
}

audit() {
  checked_run "$1"
  local found=0
  [ -z "$(docker ps -a -q --filter "label=$LABEL")" ] || {
    echo 'audit: fixture container remains'
    found=1
  }
  [ -z "$(docker volume ls -q --filter "label=$LABEL")" ] || {
    echo 'audit: fixture volume remains'
    found=1
  }
  [ -z "$(docker network ls -q --filter "label=$LABEL")" ] || {
    echo 'audit: fixture network remains'
    found=1
  }
  if [ "${2:-0}" = 1 ] && docker image inspect "${3:-$IMAGE}" >/dev/null 2>&1; then
    echo 'audit: introduced image remains'
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
  pull) pull ;;
  admin) admin "$@" ;;
  *) fail 'usage: host.sh preflight|pull|create|inspect|size|load|unpack|admin|controller|export_receipts|teardown|audit RUN ...' ;;
esac
