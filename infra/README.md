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

## Environments

| | production | staging |
|---|---|---|
| URL | https://skolia.io | https://staging.skolia.io |
| Names | `skolia`, `skolia-ingest` | `skolia-staging`, `skolia-ingest-staging` |
| Terraform state | `skolia.tfstate` | `skolia-staging.tfstate` |
| Wrangler | top level of `api/wrangler*.jsonc` | `env.staging` |

Both are on the same account. Billing alerts are per account, so only production makes them. `infra/tf.sh <env>` and `infra/wrangler.sh <env>` run terraform and wrangler for one environment. `api/wrangler.jsonc` holds each D1 id (`infra/tf.sh <env> output -raw d1_database_id`), for migrations.

A new environment: add it to the `case` in `tf.sh`, `wrangler.sh` and `deploy-ingest.sh` and to `var.env`, add its `env` blocks, then `infra/tf.sh <env> apply`, put its D1 id in `api/wrangler.jsonc`, and deploy.

## Credentials

```fish
set -l p cloudflare/andyyu2004@gmail.com/1d3ca537bca3f2918d2778118d23f0a8
set -x CLOUDFLARE_ACCOUNT_ID 1d3ca537bca3f2918d2778118d23f0a8
set -x CLOUDFLARE_API_TOKEN (pass show $p/skolia-terraform)
set -x TF_VAR_alert_email andyyu2004@gmail.com
set -x AWS_ACCESS_KEY_ID (pass show $p/skolia-tfstate-access-id)
set -x AWS_SECRET_ACCESS_KEY (pass show $p/skolia-tfstate-secret-access-key)
```

## Deploy

A push to main deploys staging, smoke-tests it (imports a new text and waits until it's ready), then deploys production (`.github/workflows/ci.yml`, `deploy.yml`). Ingest is rebuilt only when something it's built from changed, or when the workflow is run by hand with `ingest` ticked. Pull requests get a production `terraform plan`. GitHub needs:

- variable `CLOUDFLARE_ACCOUNT_ID`
- secrets `CLOUDFLARE_API_TOKEN` (the Terraform token above), `TFSTATE_ACCESS_KEY_ID`, `TFSTATE_SECRET_ACCESS_KEY`, `ALERT_EMAIL`
- environments `staging` and `production`; a required reviewer on `production` makes it wait for approval

By hand, with the credentials above, the same tasks CI runs:

```fish
mise run plan staging
mise run deploy staging          # D1 migrations, then terraform apply
mise run deploy-ingest staging   # build, push and deploy the container
mise run smoke staging
```

`deploy-ingest` builds the lexicon (`mise run data`), builds the image with buildx for amd64, pushes it with `wrangler containers push` (retrying: the registry sometimes times out on large layers) and deploys the ingest Worker with that image. In CI, `INGEST_CACHE` keeps buildx's layer cache in the Actions cache (10 GB per repo; GHCR's free allowance for a private repo is 500 MB), so unchanged layers keep their digests and the registry skips them.
