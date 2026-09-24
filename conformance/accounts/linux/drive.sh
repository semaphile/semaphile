#!/bin/sh
# Runs linux/host.sh on the Linux test host without copying it there.
# The host address is supplied by the caller and never stored in the repo.
# stdin and stdout pass through, so load and export_receipts stream data.
set -eu
[ "$#" -ge 2 ] || {
  echo 'usage: drive.sh USER@HOST SUBCOMMAND [ARGS...]' >&2
  exit 64
}
host=$1
shift
here=$(cd "$(dirname "$0")" && pwd)
script=$(cat "$here/host.sh")
quoted=$(printf '%s' "$script" | sed "s/'/'\\\\''/g")
args=
for arg in "$@"; do
  case $arg in
    *[!A-Za-z0-9._:=/-]*) echo "drive.sh: unsafe argument: $arg" >&2 && exit 64 ;;
  esac
  args="$args $arg"
done
exec ssh -o BatchMode=yes -o ConnectTimeout=15 "$host" "bash -c '$quoted' host.sh$args"
