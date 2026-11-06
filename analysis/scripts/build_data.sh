#!/usr/bin/env bash
# Builds each language's data in data/lexicon/ from the inputs pinned in
# analysis/inputs.sha256: build_data.sh [lang...], every language when none is given.
#   en  en.sqlite
#   pl  pl.sqlite and pl-valency.json
# Each input is kept in R2 as skolia-tfstate/inputs/{sha256}-{name}.zst, since kaikki.org
# overwrites its extract in place; only the given languages' inputs are fetched. Needs uv,
# zstd, unzip, and wrangler credentials (wrangler login, or CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
data=${SKOLIA_DATA:-$root/data}
inputs=$data/inputs
out=$data/lexicon
mkdir -p "$inputs" "$out"

inputs_of() {
  case $1 in
    en) echo kaikki.org-dictionary-English.jsonl ;;
    pl) echo kaikki.org-dictionary-Polish.jsonl walenty_20180630-text.zip ;;
    *) echo "build_data.sh: unknown language $1" >&2; exit 2 ;;
  esac
}

langs=("$@")
[ ${#langs[@]} -gt 0 ] || langs=(en pl)
needed=()
for lang in "${langs[@]}"; do
  read -ra names <<<"$(inputs_of "$lang")"
  needed+=("${names[@]}")
done

while read -r sha name; do
  [[ " ${needed[*]} " == *" $name "* ]] || continue
  file=$inputs/$name
  if ! { [ -f "$file" ] && echo "$sha  $file" | shasum -a 256 -c --status; }; then
    pnpm --dir "$root/api" exec wrangler r2 object get \
      "skolia-tfstate/inputs/$sha-$name.zst" --file "$file.zst" --remote
    zstd -d -q -f --rm "$file.zst" -o "$file"
    echo "$sha  $file" | shasum -a 256 -c --quiet
  fi
done < "$root/analysis/inputs.sha256"

cd "$root/analysis"
for lang in "${langs[@]}"; do
  case $lang in
    en)
      uv run --frozen skolia-build-lexicon en "$inputs/kaikki.org-dictionary-English.jsonl" "$out/en.sqlite"
      ;;
    pl)
      uv run --frozen skolia-build-lexicon pl "$inputs/kaikki.org-dictionary-Polish.jsonl" "$out/pl.sqlite"
      rm -rf "$inputs/walenty"
      unzip -q "$inputs/walenty_20180630-text.zip" -d "$inputs/walenty"
      uv run --frozen skolia-build-valency "$inputs/walenty/walenty_20180630-text" "$out/pl-valency.json"
      ;;
  esac
done
