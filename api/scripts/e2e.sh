#!/usr/bin/env bash
# Local end to end: wrangler dev with both Workers, the ingest containers and empty local
# D1, R2 and queue, each language's lexicon sample (as a preview has) loaded, then the
# end-to-end tests (src/e2e.ts) and the curated texts' sync (src/sync-curated.ts, twice: the second run must find
# nothing to do) against it. Needs Docker, the reader build, the ingest images (just images)
# and data/lexicon/{lang}.cards.sqlite (just cards-local). Port 8787 must be free: api/.env
# points the containers at it.
# usage: e2e.sh <lang>...
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "usage: e2e.sh <lang>..." >&2
  exit 2
fi
api=$(cd "$(dirname "$0")/.." && pwd)
cd "$api"
state=.wrangler/e2e
log=.wrangler/e2e.log
port=8787

rm -rf "$state"
d1() {
  pnpm exec wrangler d1 "$@" --local --persist-to "$state" --env='' >/dev/null
}
d1 migrations apply DB
for lang in "$@"; do
  cards=../data/lexicon/$lang.cards.sqlite
  if [ ! -f "$cards" ]; then
    echo "no data/lexicon/$lang.cards.sqlite; just cards-local makes it" >&2
    exit 1
  fi
  d1 migrations apply "LEXICON_$(tr a-z A-Z <<<"$lang")"
  ../infra/load-lexicon.py local "$cards" --sample 3000 --persist-to "$state"
done

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

E2E_API_KEY=$(openssl rand -hex 32) E2E_USER_KEY=$(openssl rand -hex 32) SYNC_CURATED_API_KEY=$(openssl rand -hex 32)
export E2E_API_KEY E2E_USER_KEY SYNC_CURATED_API_KEY
node src/e2e-keys.ts > "$state/e2e-keys.sql"
node src/sync-curated-key.ts > "$state/sync-curated-key.sql"
d1 execute DB --file "$state/e2e-keys.sql"
d1 execute DB --file "$state/sync-curated-key.sql"

# wrangler dev serves version "dev" (define in wrangler.jsonc)
node src/e2e.ts "http://localhost:$port" dev || { echo "end-to-end tests failed; see api/$log" >&2; exit 1; }
node src/sync-curated.ts "http://localhost:$port" ../texts || { echo "sync-curated failed; see api/$log" >&2; exit 1; }
node src/sync-curated.ts "http://localhost:$port" ../texts --check || { echo "sync-curated left changes; see api/$log" >&2; exit 1; }
