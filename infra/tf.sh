#!/usr/bin/env bash
# terraform for one environment: tf.sh <staging|production|pr-N> <terraform args...>
# Each environment has its own state (skolia.tfstate, skolia-staging.tfstate,
# skolia-pr-12.tfstate) and init directory (.terraform-{env}). Needs
# CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and the state bucket's AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY (README.md).
set -euo pipefail

env=${1:-}
if [[ ! $env =~ ^(staging|production|pr-[0-9]+)$ ]]; then
  echo "usage: tf.sh <staging|production|pr-N> <terraform args...>" >&2
  exit 2
fi
shift

cd "$(dirname "$0")"
export TF_DATA_DIR=.terraform-$env TF_VAR_env=$env
export TF_VAR_account_id=${TF_VAR_account_id:-$CLOUDFLARE_ACCOUNT_ID}

key=skolia.tfstate
[ "$env" = production ] || key=skolia-$env.tfstate
if [ ! -f "$TF_DATA_DIR/terraform.tfstate" ]; then
  # readonly: a missing platform hash fails here instead of dirtying the checkout, which
  # the end-to-end tests' git describe would then report as -dirty
  terraform init -input=false -lockfile=readonly -backend-config="key=$key" \
    -backend-config="endpoints={s3=\"https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com\"}" >&2
fi
exec terraform "$@"
