# infra

Terraform for skolia's Cloudflare resources: R2 bucket, D1 database, queue, the `skolia` Worker on skolia.io, and an R2 token for the ingest container.

## One-time setup

1. Create the R2 bucket `skolia-tfstate` in the dashboard, and an R2 API token with Object Read & Write on that bucket only. It gives an access key id and secret for the state backend.
2. Create a Cloudflare API token for Terraform with these permissions:
   - Account: Workers Scripts Write, Workers R2 Storage Write, D1 Write, Queues Write, Account API Tokens Write, Notifications Write
   - Zone skolia.io: Zone Read, Workers Routes Write
3. In the dashboard (Notifications), add a Billing Budget alert in dollars. `alerts.tf` covers per-product usage, but no usage alert exists for Containers, and the provider has no budget alert type.

```fish
set -x CLOUDFLARE_ACCOUNT_ID <account id>
set -x CLOUDFLARE_API_TOKEN <terraform token>
set -x TF_VAR_account_id $CLOUDFLARE_ACCOUNT_ID
set -x TF_VAR_alert_email <address for billing alerts>
set -x AWS_ACCESS_KEY_ID <state bucket access key id>
set -x AWS_SECRET_ACCESS_KEY <state bucket secret>
cd infra
terraform init -backend-config="endpoints={s3=\"https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com\"}"
```

## Deploy

From the repo root, with the variables above set:

```fish
pnpm --filter @skolia/reader build
pnpm --dir api exec wrangler deploy --dry-run --outdir dist
terraform -chdir=infra apply
terraform -chdir=infra output -raw d1_database_id  # put it in api/wrangler.jsonc as database_id
pnpm --dir api exec wrangler d1 migrations apply skolia --remote
```

Then the skolia-ingest Worker and its container (wrangler builds the image from `analysis/Dockerfile`, so `data/lexicon/pl.sqlite` and `pl-valency.json` must exist; needs Workers Paid):

```fish
function tf_out; terraform -chdir=infra output -raw $argv[1]; end
pnpm --dir api exec wrangler deploy -c wrangler.ingest.jsonc \
    --var S3_ENDPOINT:(tf_out r2_s3_endpoint) \
    --secrets-file (printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' (tf_out ingest_s3_access_key_id) (tf_out ingest_s3_secret_access_key) | psub -f)
```
