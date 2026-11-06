#!/usr/bin/env bash
# Builds each language's ingest image, pushes it to Cloudflare's registry and deploys the
# ingest Worker with them: deploy-ingest.sh <staging|production>. Run after tf.sh apply (it reads
# the R2 credentials from Terraform). Each image is built on a base (models and
# dependencies, analysis/Dockerfile) kept in the registry under a tag of its own, so a
# code change builds and pushes only the code and lexicon layers on top of it.
set -euo pipefail

env=${1:-}
case $env in
  staging | production) ;;
  *) echo "usage: deploy-ingest.sh <staging|production>" >&2; exit 2 ;;
esac
root=$(cd "$(dirname "$0")/.." && pwd)
tf() { "$root/infra/tf.sh" "$env" "$@"; }
wrangler() { "$root/infra/wrangler.sh" "$env" "$@"; }

# One image per language, each for its container class in wrangler.ingest.jsonc,
# Ingest{Lang}: IngestPl
langs=(pl en)

# The images are named by the git trees they're built from (analysis/ and .dockerignore;
# the lexicons are pinned in analysis/inputs.sha256), so an unchanged image is neither
# rebuilt nor redeployed, whichever commits came between
built_from=(analysis .dockerignore)
# The base is named by the files its stages read
base_from=(analysis/Dockerfile analysis/pyproject.toml analysis/uv.lock analysis/.python-version
  analysis/scripts/fetch_model.py analysis/scripts/fetch_stanza.py .dockerignore)
if [ -n "$(git -C "$root" status --porcelain -- "${built_from[@]}")" ]; then
  echo "uncommitted changes under ${built_from[*]}: commit them first" >&2
  exit 1
fi
tree_hash() { (cd "$root" && git rev-parse "${@/#/HEAD:}" | git hash-object --stdin | cut -c1-12); }
version=$(tree_hash "${built_from[@]}")
base_version=base-$(tree_hash "${base_from[@]}")

registry=$(wrangler containers images list --json)
in_registry() {
  jq -e --arg n "$1" --arg v "$2" '.[] | select(.name == $n) | .tags | index($v)' \
    <<<"$registry" >/dev/null
}
repo=registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID

# buildx pushes straight to the registry, with the credentials wrangler containers push
# would use (user v1), so nothing is loaded into Docker and the base's layers, already
# in the registry, are neither pulled nor pushed again
logged_in=
login() {
  [ -n "$logged_in" ] && return
  wrangler containers registries credentials registry.cloudflare.com --push --pull \
    --expiration-minutes 60 | tail -n1 |
    docker login --username v1 --password-stdin registry.cloudflare.com
  logged_in=1
}

# Cloudflare's registry sometimes times out committing a large layer (on 2026-11-06 a
# 1 GB model layer failed 3 times, then went through); a retry rebuilds from the builder's
# cache and pushes what's missing
build() {
  local attempt
  for attempt in 1 2 3 4 5; do
    docker buildx build --platform linux/amd64 -f "$root/analysis/Dockerfile" \
      --provenance=false --sbom=false "$@" "$root" && return
    [ "$attempt" = 5 ] && exit 1
    echo "build or push failed (attempt $attempt)" >&2
  done
}

data_built=
images=()
for lang in "${langs[@]}"; do
  name=skolia-ingest-$lang
  tag=$name:$version
  base=$repo/$name:$base_version
  class=Ingest$(tr '[:lower:]' '[:upper:]' <<<"${lang:0:1}")${lang:1}
  images+=("$class=$repo/$tag")
  if in_registry "$name" "$version"; then
    echo "$tag is already in the registry"
    continue
  fi
  if [ -z "$data_built" ]; then
    "$root/analysis/scripts/build_data.sh"
    data_built=1
  fi
  login
  push=(--output type=image,push=true,oci-mediatypes=false)

  if in_registry "$name" "$base_version"; then
    echo "$name:$base_version is already in the registry"
  else
    # Room for the models, on a GitHub runner
    if [ -n "${GITHUB_ACTIONS:-}" ] && [ -z "${disk_freed:-}" ]; then
      sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /opt/hostedtoolcache/CodeQL
      disk_freed=1
    fi
    options=()
    # Higher Hugging Face rate limits for the model downloads; optional
    if [ -n "${HF_TOKEN:-}" ]; then
      options+=(--secret id=hf_token,env=HF_TOKEN)
    fi
    build --build-arg "SKOLIA_LANG=$lang" --target "base-$lang" -t "$base" "${push[@]}" \
      ${options[@]+"${options[@]}"}
    # With the base in the builder, check it has the files the parser loads
    build --build-arg "SKOLIA_LANG=$lang" --target check
  fi

  build --build-arg "SKOLIA_LANG=$lang" --build-arg "BASE=$base" -t "$repo/$tag" "${push[@]}"
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
