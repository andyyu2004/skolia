#!/usr/bin/env bash
# Tears down the previews whose pull request isn't open: sweep.sh [-n]; -n lists them
# without tearing them down. A preview is found by any of its names (its Terraform state
# skolia-pr-N.tfstate, Workers, container applications, D1 database, queue or R2 bucket),
# so a teardown that stopped part way is found too. The open pull requests come from gh.
# Fails if any are left. Needs the credentials tf.sh needs, and gh's (GH_TOKEN in CI).
set -euo pipefail

case ${1:-} in
  -n) dry_run=1 ;;
  "") dry_run= ;;
  *) echo "usage: sweep.sh [-n]" >&2; exit 2 ;;
esac
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/infra/cloudflare.sh"

# Each listing on its own, so one that fails fails the sweep instead of finding nothing
previews() {
  local names
  names=$(r2_keys skolia-tfstate skolia-pr-) || return
  names+=$'\n'$(cf GET workers/scripts | jq -r '.result[].id') || return
  names+=$'\n'$("$root/infra/wrangler.sh" account containers list --json | jq -r '.[].name') || return
  names+=$'\n'$(cf_pages d1/database | jq -r .name) || return
  names+=$'\n'$(cf_pages queues | jq -r .queue_name) || return
  names+=$'\n'$(r2_buckets skolia-pr-) || return
  sed -nE 's/^skolia(-ingest(-[a-z]+)?|-lexicon)?-(pr-[0-9]+)(\.tfstate)?$/\3/p' <<<"$names" | sort -u
}

# Previews of pull requests that aren't open, asked again each time, so a pull request
# opened during the sweep isn't counted
stale() {
  local found open
  found=$(previews) || return
  open=$(gh pr list --state open --limit 1000 --json number --jq '.[] | "pr-\(.number)"') || return
  comm -23 <(echo "$found") <(sort <<<"$open")
}

envs=$(stale) || exit
if [ -z "$envs" ]; then
  echo "no previews to tear down"
  exit 0
fi
echo "previews of pull requests that aren't open: ${envs//$'\n'/ }"
[ -z "$dry_run" ] || exit 0

for env in $envs; do
  echo "::group::teardown $env"
  "$root/infra/teardown.sh" "$env" || echo "teardown $env failed" >&2
  echo "::endgroup::"
done

left=$(stale) || exit
if [ -n "$left" ]; then
  echo "still there: ${left//$'\n'/ }" >&2
  exit 1
fi
