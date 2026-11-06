#!/usr/bin/env bash
# wrangler for one environment: wrangler.sh <staging|production> <wrangler args...>
# Production is the top level of api/wrangler*.jsonc; other environments are their
# "env" blocks. Runs in api/, so -c paths are relative to it.
set -euo pipefail

env=${1:-}
case $env in
  # The top level, named explicitly: without --env wrangler warns when env blocks exist
  production) shift; flags=(--env=) ;;
  staging) shift; flags=(--env "$env") ;;
  *) echo "usage: wrangler.sh <staging|production> <wrangler args...>" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/../api"
exec pnpm exec wrangler "$@" ${flags[@]+"${flags[@]}"}
