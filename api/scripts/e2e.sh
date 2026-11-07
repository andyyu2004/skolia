#!/usr/bin/env bash
# Local end to end: wrangler dev with both Workers, the ingest containers and empty local
# D1, R2 and queue, then the smoke test against it. Needs Docker, the reader build and
# the ingest images (just images). Port 8787 must be free: api/.env points the
# containers at it.
set -euo pipefail

api=$(cd "$(dirname "$0")/.." && pwd)
cd "$api"
state=.wrangler/e2e
log=.wrangler/e2e.log
port=8787

rm -rf "$state"
pnpm exec wrangler d1 migrations apply DB --local --persist-to "$state" --env='' >/dev/null
pnpm exec wrangler dev -c wrangler.jsonc -c wrangler.ingest.jsonc --persist-to "$state" --port "$port" --show-interactive-dev-session=false >"$log" 2>&1 &
dev=$!
trap 'kill "$dev" 2>/dev/null; wait "$dev" 2>/dev/null || true' EXIT

until curl -fs -o /dev/null "http://localhost:$port/api/documents"; do
  if ! kill -0 "$dev" 2>/dev/null; then
    echo "wrangler dev exited; see api/$log" >&2
    exit 1
  fi
  sleep 2
done

# wrangler dev serves version "dev" (define in wrangler.jsonc)
node src/smoke.ts "http://localhost:$port" dev || { echo "smoke test failed; see api/$log" >&2; exit 1; }
