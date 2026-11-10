#!/usr/bin/env bash
# Puts the lexicon inputs pinned in analysis/inputs.sha256 in the Nix store,
# where the flake finds them by hash, unless the lexicon itself can be fetched from Cachix:
#   fetch_inputs.sh [lang...]   every language when none is given
# Each input is kept in R2 as skolia-tfstate/inputs/{sha256}-{name}.zst, since kaikki.org
# overwrites its extract in place. Needs zstd and wrangler credentials.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$root/data/inputs"

[ $# -gt 0 ] || set -- en fr pl
for lang in "$@"; do
  case $lang in
    en) names=" kaikki.org-dictionary-English.jsonl " ;;
    fr) names=" kaikki.org-dictionary-French.jsonl " ;;
    pl) names=" kaikki.org-dictionary-Polish.jsonl walenty_20180630-text.zip " ;;
    *) echo "fetch_inputs.sh: unknown language $lang" >&2; exit 2 ;;
  esac
  # --max-jobs 0: fetch, but never build
  if nix build --no-link --max-jobs 0 "$root/analysis#lexicon-$lang" 2>/dev/null; then
    continue
  fi
  while read -r sha name; do
    [[ $names == *" $name "* ]] || continue
    if nix path-info "$(nix-store --print-fixed-path sha256 "$sha" "$name")" >/dev/null 2>&1; then
      continue
    fi
    file=$root/data/inputs/$name
    pnpm --dir "$root/api" exec wrangler r2 object get \
      "skolia-tfstate/inputs/$sha-$name.zst" --file "$file.zst" --remote
    zstd -d -q -f --rm "$file.zst" -o "$file"
    echo "$sha  $file" | shasum -a 256 -c --quiet
    # The English one is 3.4 GB: one copy, in the store
    nix store add-file "$file"
    rm "$file"
  done < "$root/analysis/inputs.sha256"
done
