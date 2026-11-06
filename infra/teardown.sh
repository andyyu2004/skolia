#!/usr/bin/env bash
# Deletes a preview environment: teardown.sh pr-<N>. Only previews; staging and production
# are refused. Each step skips what's already gone, so a teardown that stopped part way
# can be run again. The order matters: the queue can't be deleted while it has a
# consumer, the Workers leave their container applications behind, and Terraform can't
# delete a bucket with objects in it. Needs the credentials tf.sh needs.
set -euo pipefail

env=${1:-}
if [[ ! $env =~ ^pr-[0-9]+$ ]]; then
  echo "usage: teardown.sh pr-<N> (only previews)" >&2
  exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/infra/cloudflare.sh"
wrangler() { "$root/infra/wrangler.sh" account "$@"; }

web=skolia-$env
ingest=skolia-ingest-$env
queue=skolia-ingest-$env
bucket=skolia-$env

# Listed first, so a failed listing stops the teardown rather than skipping a step
workers=$(cf GET workers/scripts | jq -r '.result[].id')
consumers=$(cf_pages queues | jq -r --arg q "$queue" 'select(.queue_name == $q) | .consumers[].script')
# wrangler delete leaves them. Named skolia-ingest-{lang}-pr-N (api/wrangler.ingest.jsonc).
containers=$(wrangler containers list --json |
  jq -r --arg re "^skolia-ingest-[a-z]+-$env\$" '.[] | select(.name | test($re)) | "\(.id) \(.name)"')
buckets=$(r2_buckets "$bucket")

if grep -qx "$ingest" <<<"$consumers"; then
  wrangler queues consumer remove "$queue" "$ingest" </dev/null
fi
if grep -qx "$ingest" <<<"$workers"; then
  wrangler delete "$ingest" </dev/null
fi
while read -r id name; do
  [ -n "$id" ] || continue
  echo "deleting container application $name"
  wrangler containers delete "$id" </dev/null
done <<<"$containers"
if grep -qx "$web" <<<"$workers"; then
  wrangler delete "$web" </dev/null
fi

if grep -qx "$bucket" <<<"$buckets"; then
  keys=$(r2_keys "$bucket")
  echo "deleting $(grep -c . <<<"$keys" || true) objects from $bucket"
  while read -r key; do
    [ -n "$key" ] || continue
    cf DELETE "r2/buckets/$bucket/objects/$(jq -rn --arg k "$key" '$k | @uri')" >/dev/null
  done <<<"$keys"
fi

TF_IN_AUTOMATION=1 "$root/infra/tf.sh" "$env" destroy -auto-approve -input=false
cf DELETE "r2/buckets/skolia-tfstate/objects/skolia-$env.tfstate" >/dev/null
rm -rf "$root/infra/.terraform-$env" "$root/api/wrangler.$env.json" "$root/api/wrangler.ingest.$env.json"
echo "$env is gone"
