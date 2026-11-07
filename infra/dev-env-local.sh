#!/usr/bin/env bash
# api/.env.local for wrangler dev: the skolia-dev Google OAuth client (README.md) from pass.
# Stops at a missing entry rather than writing an empty one.
set -euo pipefail

p=gcp/andyyu2004@gmail.com/skolia-dev
id=$(pass show "$p/client-id" | head -1)
secret=$(pass show "$p/client-secret" | head -1)
[ -n "$id" ] && [ -n "$secret" ] || { echo "dev-env-local.sh: $p is empty" >&2; exit 1; }
printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$id" "$secret"
