#!/usr/bin/env bash
# wrangler for one environment: wrangler.sh <staging|production|pr-N|account> <wrangler args...>
# Production is the top level of api/wrangler*.jsonc; staging is their "env" blocks. A
# preview, pr-N, has configs of its own made from staging's by api/src/preview.ts
# (wrangler.pr-N.json, wrangler.ingest.pr-N.json), made here if missing; a -c in the
# arguments replaces it. "account" runs wrangler with no config, for account-wide
# commands (the container registry, teardown.sh). Runs in api/, so -c paths are relative
# to it.
set -euo pipefail

env=${1:-}
if [[ ! $env =~ ^(staging|production|pr-[0-9]+|account)$ ]]; then
  echo "usage: wrangler.sh <staging|production|pr-N|account> <wrangler args...>" >&2
  exit 2
fi
shift
api=$(cd "$(dirname "$0")/../api" && pwd)

flags=()
case $env in
  # The top level, named explicitly: without --env wrangler warns when env blocks exist
  production) flags=(--env=) ;;
  staging) flags=(--env "$env") ;;
  pr-*)
    flags=(-c "wrangler.$env.json")
    for arg in "$@"; do
      case $arg in -c | --config | --config=*) flags=() ;; esac
    done
    if [ ${#flags[@]} -gt 0 ] && [ ! -f "$api/wrangler.$env.json" ]; then
      node "$api/src/preview.ts" config "$env" >&2
    fi
    ;;
  account)
    # An empty directory, so no config is found in it or above it
    dir=$(mktemp -d)
    trap 'rm -rf "$dir"' EXIT
    cd "$dir"
    "$api/node_modules/.bin/wrangler" "$@"
    exit
    ;;
esac

cd "$api"
exec pnpm exec wrangler "$@" ${flags[@]+"${flags[@]}"}
