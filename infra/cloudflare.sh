# shellcheck shell=bash
# Sourced by teardown.sh and sweep.sh: the Cloudflare API, with CLOUDFLARE_ACCOUNT_ID and
# CLOUDFLARE_API_TOKEN.

# cf <method> <path under accounts/{id}/> [curl args...]: the response, or an error if it
# isn't a success. The token goes to curl on stdin, not in its arguments.
cf() {
  local method=$1 path=$2 response
  shift 2
  response=$(curl -sS -X "$method" -K- "$@" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/$path" \
    <<<"header = \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"") || return
  if ! jq -e .success <<<"$response" >/dev/null 2>&1; then
    echo "$method $path: $(jq -c .errors <<<"$response" 2>/dev/null || echo "$response")" >&2
    return 1
  fi
  echo "$response"
}

# cf_pages <path>: each item of a paged list (queues, D1), one JSON object per line
cf_pages() {
  local page=1 response
  while :; do
    response=$(cf GET "$1" -G -d "page=$page" -d per_page=100) || return
    jq -c '.result[]' <<<"$response"
    [ "$(jq '.result | length' <<<"$response")" -eq 100 ] || return 0
    page=$((page + 1))
  done
}

# r2_keys <bucket> [prefix]: every object's key, one per line
r2_keys() {
  local cursor='' response
  while :; do
    response=$(cf GET "r2/buckets/$1/objects" -G -d per_page=1000 \
      ${2:+-d "prefix=$2"} ${cursor:+--data-urlencode "cursor=$cursor"}) || return
    jq -r '.result[].key' <<<"$response"
    [ "$(jq -r .result_info.is_truncated <<<"$response")" = true ] || return 0
    cursor=$(jq -r .result_info.cursor <<<"$response")
  done
}

# r2_buckets <name contains>: the matching buckets' names, one per line
r2_buckets() {
  local cursor='' response
  while :; do
    response=$(cf GET r2/buckets -G -d per_page=1000 --data-urlencode "name_contains=$1" \
      ${cursor:+--data-urlencode "cursor=$cursor"}) || return
    jq -r '.result.buckets[].name' <<<"$response"
    cursor=$(jq -r '.result_info.cursor // empty' <<<"$response")
    [ -n "$cursor" ] || return 0
  done
}
