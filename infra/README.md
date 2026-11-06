# infra

Terraform for skolia on Cloudflare: R2 bucket, D1 database, queue, the `skolia` Worker (reader + API) on workers.dev and skolia.io, an R2 token for the ingest container, and billing usage alerts. The ingest Worker and its container are deployed with wrangler (the provider has no container resource).

Account `1d3ca537bca3f2918d2778118d23f0a8`. Secrets in `pass` under `cloudflare/andyyu2004@gmail.com/1d3ca537bca3f2918d2778118d23f0a8/`. Terraform comes from `mise.toml`.

## One-time setup (done 2026-11-05)

1. Dashboard: enable R2 and subscribe to Workers Paid (Containers need it).
2. Dashboard: an account API token for Terraform, in `pass` as `skolia-terraform`:
   - Account: Workers Scripts Edit, Workers Containers Edit, Workers R2 Storage Edit, D1 Edit, Queues Edit, Account API Tokens Edit, Notifications Edit
   - Zone skolia.io: Zone Read, Workers Routes Edit
3. Dashboard: an R2 token for the state bucket, in `pass` as `skolia-tfstate-access-id` and `skolia-tfstate-secret-access-key`.
4. The state bucket `skolia-tfstate`, created once through the API with the Terraform token (Terraform can't create its own state bucket).
5. skolia.io bought through Cloudflare Registrar, so its zone is on the account.
6. Dashboard (Notifications): a Billing Budget alert in dollars. `alerts.tf` covers per-product usage, but Containers have no usage alert and the provider has no budget alert type.

## Environment

```fish
set -l p cloudflare/andyyu2004@gmail.com/1d3ca537bca3f2918d2778118d23f0a8
set -x CLOUDFLARE_ACCOUNT_ID 1d3ca537bca3f2918d2778118d23f0a8
set -x CLOUDFLARE_API_TOKEN (pass show $p/skolia-terraform)
set -x TF_VAR_account_id $CLOUDFLARE_ACCOUNT_ID
set -x TF_VAR_alert_email andyyu2004@gmail.com
set -x AWS_ACCESS_KEY_ID (pass show $p/skolia-tfstate-access-id)
set -x AWS_SECRET_ACCESS_KEY (pass show $p/skolia-tfstate-secret-access-key)
terraform -chdir=infra init -backend-config="endpoints={s3=\"https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com\"}"
```

## Deploy

A push to main deploys (`.github/workflows/ci.yml`): checks, D1 migrations, `terraform apply`, and ingest when anything it's built from changed (or when run by hand with `ingest` ticked). Pull requests get a `terraform plan`. The workflow needs:

- variable `CLOUDFLARE_ACCOUNT_ID`
- secrets `CLOUDFLARE_API_TOKEN` (the Terraform token above), `TFSTATE_ACCESS_KEY_ID`, `TFSTATE_SECRET_ACCESS_KEY`, `ALERT_EMAIL`

CI builds the ingest image with buildx, caching layers in GHCR (`ingest-cache`) so unchanged layers keep their digests and Cloudflare's registry skips them, then pushes it with `wrangler containers push` and deploys that image.

By hand, from the repo root, with the environment above:

```fish
pnpm --filter @skolia/reader build
pnpm --dir api exec wrangler deploy --dry-run --outdir dist   # the bundle Terraform uploads
terraform -chdir=infra plan -out=skolia.tfplan
terraform -chdir=infra apply skolia.tfplan
pnpm --dir api exec wrangler d1 migrations apply skolia --remote
```

`api/wrangler.jsonc` holds the D1 id (`terraform -chdir=infra output -raw d1_database_id`); update it if the database is ever recreated.

Then the ingest Worker and container, when `analysis/` or `api/src/worker/ingest.ts` changed. Wrangler builds `analysis/Dockerfile` for amd64 (so `data/lexicon/pl.sqlite` and `pl-valency.json` must exist: `analysis/scripts/build_data.sh`) and pushes the layers the registry doesn't have. It runs with your `wrangler login`, not the Terraform token:

```fish
function tf_out; terraform -chdir=infra output -raw $argv[1]; end
set -l endpoint (tf_out r2_s3_endpoint)
set -l secrets (mktemp); chmod 600 $secrets
printf 'S3_ACCESS_KEY_ID=%s\nS3_SECRET_ACCESS_KEY=%s\n' (tf_out ingest_s3_access_key_id) (tf_out ingest_s3_secret_access_key) > $secrets
set -e CLOUDFLARE_API_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
pnpm --dir api exec wrangler deploy -c wrangler.ingest.jsonc --var S3_ENDPOINT:$endpoint --secrets-file $secrets
rm $secrets
```

## Check

```fish
curl -s https://skolia.io/api/documents
```
