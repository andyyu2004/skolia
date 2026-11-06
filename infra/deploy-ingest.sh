#!/usr/bin/env bash
# Builds the ingest image, pushes it to Cloudflare's registry and deploys the ingest
# Worker with it: deploy-ingest.sh <staging|production>. Run after tf.sh apply (it reads
# the R2 credentials from Terraform). With INGEST_CACHE set to a registry ref (CI uses
# GHCR), buildx keeps its layer cache there, so unchanged layers keep their digests and
# the registry skips them.
set -euo pipefail

env=${1:-}
case $env in
  staging | production) ;;
  *) echo "usage: deploy-ingest.sh <staging|production>" >&2; exit 2 ;;
esac
root=$(cd "$(dirname "$0")/.." && pwd)
tf() { "$root/infra/tf.sh" "$env" "$@"; }
wrangler() { "$root/infra/wrangler.sh" "$env" "$@"; }

"$root/analysis/scripts/build_data.sh"

tag=skolia-ingest:$(git -C "$root" rev-parse --short=12 HEAD)
cache=()
if [ -n "${INGEST_CACHE:-}" ]; then
  cache=(--cache-from "type=registry,ref=$INGEST_CACHE" --cache-to "type=registry,ref=$INGEST_CACHE,mode=max")
fi
docker buildx build --platform linux/amd64 -f "$root/analysis/Dockerfile" --target cloudflare \
  --load -t "$tag" ${cache[@]+"${cache[@]}"} "$root"

# Cloudflare's registry sometimes times out committing a large layer (on 2026-11-06 a
# 1 GB model layer failed 3 times, then went through); layers already pushed are kept
for attempt in 1 2 3 4 5; do
  wrangler containers push "$tag" && break
  [ "$attempt" = 5 ] && exit 1
  echo "push failed (attempt $attempt)" >&2
done

# The committed config builds the Dockerfile (for wrangler dev); deploy the pushed image
image=registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/$tag
config=wrangler.ingest.deploy.jsonc
secrets=$(mktemp)
trap 'rm -f "$secrets" "$root/api/$config"' EXIT
sed -e "s#\"image\": \"../analysis/Dockerfile\",#\"image\": \"$image\",#" \
    -e '/"image_build_context"/d' "$root/api/wrangler.ingest.jsonc" > "$root/api/$config"
if [ "$(grep -c "\"image\": \"$image\"" "$root/api/$config")" != 2 ]; then
  echo "expected two container images in wrangler.ingest.jsonc" >&2
  exit 1
fi

chmod 600 "$secrets"
printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' \
  "$(tf output -raw ingest_s3_access_key_id)" "$(tf output -raw ingest_s3_secret_access_key)" > "$secrets"
wrangler deploy -c "$config" --var "S3_ENDPOINT:$(tf output -raw r2_s3_endpoint)" --secrets-file "$secrets"
