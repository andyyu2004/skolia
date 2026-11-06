# infra

Terraform for skolia on Cloudflare: R2 bucket, D1 database, queue, the `skolia` Worker (reader + API) on workers.dev and skolia.io, an R2 token for the ingest container, and billing usage alerts. The ingest Worker and its containers are deployed with wrangler (the provider has no container resource).

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
7. Google Cloud project `skolia` (andyyu2004@gmail.com), Google Auth Platform: External audience, scopes `openid`, `userinfo.email`, `userinfo.profile`, authorised domain `skolia.io`. One OAuth client (Web application, no JavaScript origins) per environment, each in `pass` under `gcp/andyyu2004@gmail.com/<client>/{client-id,client-secret}`:

   | Client | Redirect URI |
   |---|---|
   | `skolia-dev` | `http://localhost:5173/api/auth/callback/google` |
   | `skolia-staging` | `https://staging.skolia.io/api/auth/callback/google` |
   | `skolia` | `https://skolia.io/api/auth/callback/google` |

   Each Worker gets its client's id and secret and its own `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) as secrets: `infra/wrangler.sh <env> secret put GOOGLE_CLIENT_ID`, and the same for `GOOGLE_CLIENT_SECRET` and `BETTER_AUTH_SECRET`. Terraform keeps `secret_text` bindings (`keep_bindings`), so they stay out of the state. Without them sign-in answers 503. Done for `skolia-dev` only.

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

A push to main deploys staging and smoke-tests it (imports a new text and waits until it's ready). Production deploys when the workflow is run by hand with `production` ticked (`gh workflow run ci.yml -f production=true`), after staging passes; GitHub Free has no required reviewers on a private repo (`.github/workflows/ci.yml`, `deploy.yml`). Every deploy runs `deploy-ingest`: each language's image (`skolia-ingest-{lang}`) is tagged with a hash of the git trees it's built from (`analysis/`, `.dockerignore`), so it's built and pushed only when that tag isn't in the registry yet, and wrangler leaves an unchanged image deployed as it is. Pull requests get a production `terraform plan`. GitHub needs:

- variable `CLOUDFLARE_ACCOUNT_ID`
- secrets `CLOUDFLARE_API_TOKEN` (the Terraform token above), `TFSTATE_ACCESS_KEY_ID`, `TFSTATE_SECRET_ACCESS_KEY`, `ALERT_EMAIL`
- environments `staging` and `production`

These are managed in Terraform in the dotfiles (`~/.dotfiles/terraform/github`), from `pass`.

By hand, with the credentials above, the same tasks CI runs:

```fish
mise run plan staging
mise run deploy staging          # D1 migrations, then terraform apply
mise run deploy-ingest staging   # build, push and deploy the containers
mise run smoke staging
```

`deploy-ingest` builds the lexicons (`mise run data`), builds one image per language with buildx for amd64 (`--build-arg SKOLIA_LANG=pl`), pushes each with `wrangler containers push` (retrying: the registry sometimes times out on large layers) and deploys the ingest Worker with each image in place of the Dockerfile under its container class. The ingest Worker hands each job to its language's container. In CI, `INGEST_CACHE` keeps buildx's layer cache in the Actions cache, a scope per language (10 GB per repo; GHCR's free allowance for a private repo is 500 MB), so unchanged layers keep their digests and the registry skips them.

A new language: a final stage `ingest-{lang}` in `analysis/Dockerfile`, a container class in `api/src/worker/ingest.ts` and `api/wrangler.ingest.jsonc` (both environments, and a migration for the class), and the language in `langs` and `class_of` in `deploy-ingest.sh`.
