# infra

Terraform for what wrangler doesn't deploy: R2 bucket, D1 database, queue, an R2 token for the ingest containers, and billing usage alerts. Both Workers are deployed with wrangler: `skolia` (reader + API, on workers.dev and skolia.io) from `api/wrangler.jsonc`, and `skolia-ingest` with its containers from `api/wrangler.ingest.jsonc`. Wrangler applies their Durable Object migrations; the provider resends the first migration on every update, which Cloudflare refuses ([cloudflare/terraform-provider-cloudflare#5701](https://github.com/cloudflare/terraform-provider-cloudflare/issues/5701)).

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

   Each Worker gets its client's id and secret and its own `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) as secrets: `infra/wrangler.sh <env> secret put GOOGLE_CLIENT_ID`, and the same for `GOOGLE_CLIENT_SECRET` and `BETTER_AUTH_SECRET`. `wrangler deploy` keeps them. Without them sign-in answers 503. Done for `skolia-dev` only.

## Environments

| | production | staging | preview of pull request N |
|---|---|---|---|
| Env | `production` | `staging` | `pr-N` |
| URL | https://skolia.io | https://staging.skolia.io | https://skolia-pr-N.andyyu2004.workers.dev |
| Names | `skolia`, `skolia-ingest` | `skolia-staging`, `skolia-ingest-staging` | `skolia-pr-N`, `skolia-ingest-pr-N` |
| Terraform state | `skolia.tfstate` | `skolia-staging.tfstate` | `skolia-pr-N.tfstate` |
| Wrangler | top level of `api/wrangler*.jsonc` | `env.staging` | `api/wrangler.pr-N.json`, `api/wrangler.ingest.pr-N.json` (generated) |

All are on the same account. Billing alerts are per account, so only production makes them. `infra/tf.sh <env>` and `infra/wrangler.sh <env>` run terraform and wrangler for one environment. `api/wrangler.jsonc` holds each D1 id (`infra/tf.sh <env> output -raw d1_database_id`), for migrations.

A new environment: add it to the checks in `tf.sh`, `wrangler.sh` and `deploy-ingest.sh` and to `var.env`, add its `env` blocks, then `infra/tf.sh <env> apply`, put its D1 id in `api/wrangler.jsonc`, and deploy.

### Previews

Each pull request from a branch of this repository gets a preview, `pr-N`, deployed and smoke-tested on every push (`ci.yml`, job `preview`). It is on workers.dev only, with no secrets, so sign-in answers 503, and it accepts 20 imports a day. Its wrangler configs are made by `infra/preview.py config pr-N` from the `env.staging` blocks, with `-pr-N` names, its D1 id and its workers.dev URL; `deploy-infra` makes them after Terraform, and `wrangler.sh` when they're missing. They're gitignored.

Closing the pull request tears the preview down (`mise run teardown pr-N`, `infra/teardown.sh`): the queue's consumer, the ingest Worker, its container applications (which `wrangler delete` leaves), the skolia Worker, the bucket's objects, `terraform destroy`, then the state object. Each step skips what's already gone, so it can be run again. Every night `sweep.yml` runs `infra/sweep.sh`, which finds previews by their resources' and state's names, tears down those whose pull request isn't open, and fails if any are left; `infra/sweep.sh -n` lists them without tearing them down.

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

A push to main deploys staging and smoke-tests it: in each language it imports a new text and waits until it's ready. Production deploys are smoke-tested the same way, so production's library gets two "smoke test" texts per deploy, which count against the day's import cap. Pushing a `v*` tag on a commit in main deploys staging, then production once staging passes (`git tag v0.1.0 && git push origin v0.1.0`; `.github/workflows/ci.yml`, `deploy.yml`). The ingest Worker is deployed before the skolia Worker, since it consumes the queue the skolia Worker feeds: an API that sends a new kind of job never goes live before the ingest that handles it. Rolling back goes the other way: the skolia Worker first. Every deploy runs `deploy-ingest`: each language's image (`skolia-ingest-{lang}`) is tagged with a hash of the git trees it's built from (`analysis/`, `.dockerignore`), so it's built and pushed only when that tag isn't in the registry yet, and wrangler leaves an unchanged image deployed as it is. Pull requests get a `terraform plan` for staging and production (Terraform's resources only, not the Workers). GitHub needs:

- variable `CLOUDFLARE_ACCOUNT_ID`
- secrets `CLOUDFLARE_API_TOKEN` (the Terraform token above), `TFSTATE_ACCESS_KEY_ID`, `TFSTATE_SECRET_ACCESS_KEY`, `ALERT_EMAIL`
- environments `staging`, `production` and `preview` (every pull request's)

These are managed in Terraform in the dotfiles (`~/.dotfiles/terraform/github`), from `pass`.

By hand, with the credentials above, the same tasks CI runs:

```fish
mise run plan staging
mise run deploy staging          # all of the below, in order
mise run deploy-infra staging    # terraform apply, D1 migrations
mise run deploy-ingest staging   # build, push and deploy the containers
mise run deploy-web staging      # the skolia Worker (reader and API)
mise run smoke staging
mise run teardown pr-12          # previews only
```

`deploy-ingest` builds each language's lexicon (`build_data.sh <lang>`), builds one image per language with buildx for amd64 (`--build-arg SKOLIA_LANG=pl`), pushes each straight from buildx with the credentials `wrangler containers push` would use (retrying: the registry sometimes times out on large layers) and deploys the ingest Worker with each image in place of the Dockerfile under its container class. The ingest Worker hands each job to its language's container. Each image is the code and lexicon on a base (models and dependencies, the `base-{lang}` stage), tagged `skolia-ingest-{lang}:base-{hash}` with a hash of the files the base is built from (`analysis/Dockerfile`, `pyproject.toml`, `uv.lock`, the fetch scripts). The base is built only when its tag isn't in the registry; otherwise the image is built on the pushed base without pulling it, and only the code and lexicon layers are pushed. There's no layer cache between runs: the Actions cache's 10 GB per repo didn't hold the images. In CI each language's image is built on its own runner, in parallel (`deploy-ingest.sh <env> build <lang>`; one runner's disk didn't hold both), and one job then deploys the ingest Worker with all of them (`deploy-ingest.sh <env> deploy`). The job log shows one line per Dockerfile step, and the end of the full build log when a build fails.

A new language: a stage `base-{lang}` in `analysis/Dockerfile`, a container class `Ingest{Lang}` (`IngestPl`) in `api/src/worker/ingest.ts` and `api/wrangler.ingest.jsonc` (both environments, its binding, and a migration for the class), the language in `langs` in `deploy-ingest.sh` and in the `ingest-image` matrix in `.github/workflows/deploy.yml`, and its data in `build_data.sh`.
