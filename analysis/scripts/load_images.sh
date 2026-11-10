#!/usr/bin/env bash
# Builds each language's ingest image with Nix and loads it into Docker as
# skolia-ingest-{lang}:dev, which wrangler dev runs (analysis/image/Dockerfile):
#   load_images.sh [lang...]   every language when none is given
# Docker keeps each image under its Nix tag too, so an unchanged image isn't loaded again.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

langs=("$@")
# The languages in api/wrangler.ingest.jsonc
[ ${#langs[@]} -gt 0 ] || langs=(pl en fr)
for lang in "${langs[@]}"; do
  name=skolia-ingest-$lang
  tag=$(nix eval --raw "./analysis#ingest-$lang.imageTag")
  if docker image inspect "$name:$tag" >/dev/null 2>&1; then
    echo "$name:$tag is already in Docker"
  else
    analysis/scripts/fetch_inputs.sh "$lang"
    nix run "./analysis#ingest-$lang.copyTo" -- "docker-daemon:$name:$tag"
  fi
  docker tag "$name:$tag" "$name:dev"
done
