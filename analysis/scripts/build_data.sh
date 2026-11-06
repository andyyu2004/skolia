#!/usr/bin/env bash
# Builds data/lexicon/en.sqlite, pl.sqlite and pl-valency.json from the inputs pinned in
# analysis/inputs.sha256. Each input is kept in R2 as
# skolia-tfstate/inputs/{sha256}-{name}.zst, since kaikki.org overwrites its extract
# in place. Needs uv, zstd, unzip, and wrangler credentials (wrangler login, or
# CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
data=${SKOLIA_DATA:-$root/data}
inputs=$data/inputs
out=$data/lexicon
mkdir -p "$inputs" "$out"

while read -r sha name; do
  file=$inputs/$name
  if ! { [ -f "$file" ] && echo "$sha  $file" | shasum -a 256 -c --status; }; then
    pnpm --dir "$root/api" exec wrangler r2 object get \
      "skolia-tfstate/inputs/$sha-$name.zst" --file "$file.zst" --remote
    zstd -d -q -f --rm "$file.zst" -o "$file"
    echo "$sha  $file" | shasum -a 256 -c --quiet
  fi
done < "$root/analysis/inputs.sha256"

rm -rf "$inputs/walenty"
unzip -q "$inputs/walenty_20180630-text.zip" -d "$inputs/walenty"

cd "$root/analysis"
uv run --frozen skolia-build-lexicon en "$inputs/kaikki.org-dictionary-English.jsonl" "$out/en.sqlite"
uv run --frozen skolia-build-lexicon pl "$inputs/kaikki.org-dictionary-Polish.jsonl" "$out/pl.sqlite"
uv run --frozen skolia-build-valency "$inputs/walenty/walenty_20180630-text" "$out/pl-valency.json"
