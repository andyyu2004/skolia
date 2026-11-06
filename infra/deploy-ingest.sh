#!/usr/bin/env bash
# Builds each language's ingest image with Nix (analysis/flake.nix), pushes it to
# Cloudflare's registry and deploys the ingest Worker with them:
#   deploy-ingest.sh <env> build <lang>   build and push one language's image (CI runs
#                                          one per language, in parallel)
#   deploy-ingest.sh <env> deploy         deploy the ingest Worker with every language's
#                                          image, which must be in the registry
#   deploy-ingest.sh <env>                both, every language in turn
# env is staging, production or pr-N. deploy runs after tf.sh apply (it reads the R2
# credentials from Terraform). Each image is tagged with its Nix hash, which nix eval
# gives without building anything, so an image whose inputs are unchanged is neither
# rebuilt, pushed nor redeployed, and a push sends only the layers the registry lacks.
set -euo pipefail

env=${1:-}
usage="usage: deploy-ingest.sh <staging|production|pr-N> [build <lang> | deploy]"
if [[ ! $env =~ ^(staging|production|pr-[0-9]+)$ ]]; then
  echo "$usage" >&2
  exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd)
tf() { "$root/infra/tf.sh" "$env" "$@"; }
wrangler() { "$root/infra/wrangler.sh" "$env" "$@"; }
# The registry is the account's, whichever environment; a preview's config may not be
# made yet when its images are built
registry_wrangler() { "$root/infra/wrangler.sh" account "$@"; }
nix_sh=$root/analysis/scripts/nix.sh
cd "$root"

# One image per language, each for its container class in wrangler.ingest.jsonc,
# Ingest{Lang}: IngestPl. CI's matrix in .github/workflows/deploy.yml lists them too.
langs=(pl en)
repo=registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID

tag_of() { "$nix_sh" nix eval --raw "./analysis#ingest-$1.imageTag"; }

registry=
in_registry() {
  [ -n "$registry" ] || registry=$(registry_wrangler containers images list --json)
  jq -e --arg n "$1" --arg v "$2" '.[] | select(.name == $n) | .tags | index($v)' \
    <<<"$registry" >/dev/null
}

class_of() { echo "Ingest$(tr '[:lower:]' '[:upper:]' <<<"${1:0:1}")${1:1}"; }

build_lang() {
  local lang=$1 name tag
  name=skolia-ingest-$lang
  tag=$(tag_of "$lang")
  if in_registry "$name" "$tag"; then
    echo "$name:$tag is already in the registry"
    return
  fi
  "$root/analysis/scripts/fetch_inputs.sh" "$lang"
  # Fails if the parser needs a model file the image doesn't have
  "$nix_sh" nix build -L --no-link "./analysis#checks.x86_64-linux.$lang"
  # With the credentials wrangler containers push would use (user v1), on stdin. Cloudflare's
  # registry sometimes times out committing a large layer (on 2026-11-06 a 1 GB model layer
  # failed 3 times, then went through): skopeo retries.
  registry_wrangler containers registries credentials registry.cloudflare.com --push --pull \
    --expiration-minutes 60 | tail -n1 |
    "$nix_sh" sh -c 'exec nix run "./analysis#ingest-$0.copyTo" -- --retry-times 5 \
      --format v2s2 --dest-creds "v1:$(cat)" "$1"' "$lang" "docker://$repo/$name:$tag"
  # Everything the next build needs but the models, which would fill the cache
  if [ -n "${CACHIX_AUTH_TOKEN:-}" ]; then
    nix build --no-link --print-out-paths "./analysis#cacheable-$lang" | cachix push andyyu2004
  fi
}

deploy() {
  local lang tag images=() pair config secrets copies
  for lang in "${langs[@]}"; do
    tag=$(tag_of "$lang")
    if ! in_registry "skolia-ingest-$lang" "$tag"; then
      echo "skolia-ingest-$lang:$tag isn't in the registry: build it first" >&2
      exit 1
    fi
    images+=("$(class_of "$lang")=$repo/skolia-ingest-$lang:$tag")
  done

  # The committed config builds analysis/image/Dockerfile (for wrangler dev); deploy the
  # pushed images, each in its place under its class_name
  config=wrangler.ingest.deploy.jsonc
  secrets=$(mktemp)
  # Expanded now: the trap runs at exit, after deploy's locals are gone
  trap "rm -f '$secrets' '$root/api/$config'" EXIT
  if [[ $env == pr-* ]]; then
    # A preview's config is JSON (infra/preview.py) and holds only the preview
    [ -f "$root/api/wrangler.ingest.$env.json" ] || "$root/infra/preview.py" config "$env" >&2
    jq --argjson image "$(jq -n '$ARGS.positional | map(split("=") | {(.[0]): .[1]}) | add' --args "${images[@]}")" '
      .containers |= map(
        if $image[.class_name] then .image = $image[.class_name] | del(.image_vars)
        else error("no image for container class \(.class_name)") end)
    ' "$root/api/wrangler.ingest.$env.json" > "$root/api/$config"
    copies=1
  else
    awk -v images="$(IFS=,; echo "${images[*]}")" '
      BEGIN { n = split(images, pairs, ","); for (i = 1; i <= n; i++) { split(pairs[i], kv, "="); image[kv[1]] = kv[2] } }
      match($0, /"class_name": "[^"]+"/) { class = substr($0, RSTART + 15, RLENGTH - 16) }
      /"image": "\.\.\/analysis\/image\/Dockerfile",/ {
        if (!(class in image)) { print "no image for container class " class > "/dev/stderr"; exit 1 }
        sub(/"\.\.\/analysis\/image\/Dockerfile"/, "\"" image[class] "\"")
      }
      /"image_vars"/ { next }
      { print }
    ' "$root/api/wrangler.ingest.jsonc" > "$root/api/$config"
    # Production and staging
    copies=2
  fi
  for pair in "${images[@]}"; do
    if [ "$(grep -c "\"image\": \"${pair#*=}\"" "$root/api/$config")" != "$copies" ]; then
      echo "expected ${pair#*=} $copies times in $config" >&2
      exit 1
    fi
  done

  chmod 600 "$secrets"
  printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' \
    "$(tf output -raw ingest_s3_access_key_id)" "$(tf output -raw ingest_s3_secret_access_key)" > "$secrets"
  wrangler deploy -c "$config" --var "S3_ENDPOINT:$(tf output -raw r2_s3_endpoint)" --secrets-file "$secrets"
}

case ${2:-} in
  build)
    lang=${3:-}
    if [[ " ${langs[*]} " != *" $lang "* ]]; then
      echo "deploy-ingest.sh: build takes one of: ${langs[*]}" >&2
      exit 2
    fi
    build_lang "$lang"
    ;;
  deploy) deploy ;;
  "")
    for lang in "${langs[@]}"; do build_lang "$lang"; done
    registry=
    deploy
    ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
