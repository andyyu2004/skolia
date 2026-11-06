#!/usr/bin/env bash
# Runs a command where Nix can build the ingest images (x86_64-linux):
#   nix.sh nix build ./analysis#ingest-pl
# With this machine's Nix on x86-64 Linux, or with SKOLIA_NIX=host (a Mac with a Linux
# builder). Otherwise in a linux/amd64 Nix container whose store is kept in the Docker
# volume skolia-nix-store, with the repo, its git directory and the Docker socket at the
# same paths as outside.
set -euo pipefail

if [ "${SKOLIA_NIX:-}" = host ] || [ "$(uname -sm)" = "Linux x86_64" ]; then exec "$@"; fi

root=$(cd "$(dirname "$0")/../.." && pwd)
git_dir=$(cd "$root" && cd "$(git rev-parse --git-common-dir)" && pwd)
mounts=(-v "$root:$root")
[[ $git_dir == "$root"/* ]] || mounts+=(-v "$git_dir:$git_dir")

exec docker run --rm -i --platform linux/amd64 \
  -v skolia-nix-store:/nix -v skolia-nix-cache:/root/.cache/nix "${mounts[@]}" \
  -v /var/run/docker.sock:/var/run/docker.sock -w "$PWD" -e HF_TOKEN \
  -e NIX_CONFIG="$(printf '%s\n' \
    'experimental-features = nix-command flakes' \
    'extra-substituters = https://andyyu2004.cachix.org' \
    'extra-trusted-public-keys = andyyu2004.cachix.org-1:NgqnQARhcBguLqfW/INkdJd8SZjtunkNUENFbQrAwW4=' \
    'max-jobs = auto' \
    'sandbox = false' \
    'filter-syscalls = false')" \
  nixos/nix:2.35.4 "$@"
