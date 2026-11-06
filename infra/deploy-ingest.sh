#!/usr/bin/env bash
# Builds the ingest image, pushes it to Cloudflare's registry and deploys the ingest
# Worker with it: deploy-ingest.sh <staging|production>. Run after tf.sh apply (it reads
# the R2 credentials from Terraform). With INGEST_CACHE set to a buildx cache backend
# (CI: type=gha,scope=ingest), buildx keeps its layer cache there, so unchanged layers
# keep their digests and Cloudflare's registry skips them.
set -euo pipefail

env=${1:-}
case $env in
  staging | production) ;;
  *) echo "usage: deploy-ingest.sh <staging|production>" >&2; exit 2 ;;
esac
root=$(cd "$(dirname "$0")/.." && pwd)
tf() { "$root/infra/tf.sh" "$env" "$@"; }
wrangler() { "$root/infra/wrangler.sh" "$env" "$@"; }

# One image per language, each for its container class in wrangler.ingest.jsonc
langs=(pl en)
class_of() {
  case $1 in
    pl) echo Ingest ;;
    en) echo IngestEn ;;
  esac
}

# The images are named by the git trees they're built from (analysis/ and .dockerignore;
# the lexicons are pinned in analysis/inputs.sha256), so an unchanged image is neither
# rebuilt nor redeployed, whichever commits came between
built_from=(analysis .dockerignore)
if [ -n "$(git -C "$root" status --porcelain -- "${built_from[@]}")" ]; then
  echo "uncommitted changes under ${built_from[*]}: commit them first" >&2
  exit 1
fi
version=$(cd "$root" && git rev-parse "${built_from[@]/#/HEAD:}" | git hash-object --stdin | cut -c1-12)

registry=$(wrangler containers images list --json)
data_built=
images=()
for lang in "${langs[@]}"; do
  name=skolia-ingest-$lang
  tag=$name:$version
  images+=("$(class_of "$lang")=registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/$tag")
  if jq -e --arg n "$name" --arg v "$version" '.[] | select(.name == $n) | .tags | index($v)' \
    <<<"$registry" >/dev/null; then
    echo "$tag is already in the registry"
    continue
  fi
  if [ -z "$data_built" ]; then
    "$root/analysis/scripts/build_data.sh"
    data_built=1
  fi
  options=()
  if [ -n "${INGEST_CACHE:-}" ]; then
    # A cache scope per language (INGEST_CACHE ends in scope=...): each build's cache-to
    # replaces its scope's cache
    options+=(--cache-from "$INGEST_CACHE-$lang" --cache-to "$INGEST_CACHE-$lang,mode=max")
  fi
  # Higher Hugging Face rate limits for the model downloads; optional
  if [ -n "${HF_TOKEN:-}" ]; then
    options+=(--secret id=hf_token,env=HF_TOKEN)
  fi
  docker buildx build --platform linux/amd64 -f "$root/analysis/Dockerfile" \
    --build-arg "SKOLIA_LANG=$lang" --load -t "$tag" ${options[@]+"${options[@]}"} "$root"

  # Cloudflare's registry sometimes times out committing a large layer (on 2026-11-06 a
  # 1 GB model layer failed 3 times, then went through); layers already pushed are kept
  for attempt in 1 2 3 4 5; do
    wrangler containers push "$tag" && break
    [ "$attempt" = 5 ] && exit 1
    echo "push failed (attempt $attempt)" >&2
  done
done

# The committed config builds the Dockerfile (for wrangler dev); deploy the pushed
# images, each in place of the Dockerfile under its class_name
config=wrangler.ingest.deploy.jsonc
secrets=$(mktemp)
trap 'rm -f "$secrets" "$root/api/$config"' EXIT
awk -v images="$(IFS=,; echo "${images[*]}")" '
  BEGIN { n = split(images, pairs, ","); for (i = 1; i <= n; i++) { split(pairs[i], kv, "="); image[kv[1]] = kv[2] } }
  match($0, /"class_name": "[^"]+"/) { class = substr($0, RSTART + 15, RLENGTH - 16) }
  /"image": "\.\.\/analysis\/Dockerfile",/ {
    if (!(class in image)) { print "no image for container class " class > "/dev/stderr"; exit 1 }
    sub(/"\.\.\/analysis\/Dockerfile"/, "\"" image[class] "\"")
  }
  /"image_build_context"|"image_vars"/ { next }
  { print }
' "$root/api/wrangler.ingest.jsonc" > "$root/api/$config"
# Each image in production and staging
for pair in "${images[@]}"; do
  if [ "$(grep -c "\"image\": \"${pair#*=}\"" "$root/api/$config")" != 2 ]; then
    echo "expected ${pair#*=} twice in $config" >&2
    exit 1
  fi
done

chmod 600 "$secrets"
printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' \
  "$(tf output -raw ingest_s3_access_key_id)" "$(tf output -raw ingest_s3_secret_access_key)" > "$secrets"
wrangler deploy -c "$config" --var "S3_ENDPOINT:$(tf output -raw r2_s3_endpoint)" --secrets-file "$secrets"
