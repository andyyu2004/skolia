# infra

Terraform for what wrangler doesn't deploy: R2 bucket, D1 database, queue, an R2 token for the ingest containers, and billing usage alerts. Both Workers are deployed with wrangler: `skolia` (reader + API, on workers.dev and skolia.io) from `api/wrangler.jsonc`, and `skolia-ingest` with its containers from `api/wrangler.ingest.jsonc`. Wrangler applies their Durable Object migrations; the provider resends the first migration on every update, which Cloudflare refuses ([cloudflare/terraform-provider-cloudflare#5701](https://github.com/cloudflare/terraform-provider-cloudflare/issues/5701)).

Account `1d3ca537bca3f2918d2778118d23f0a8`. Secrets in `pass` under `cloudflare/andyyu2004@gmail.com/1d3ca537bca3f2918d2778118d23f0a8/`. Terraform comes from `flake.nix` (`nix develop`).

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
   | `skolia-prod` | `https://skolia.io/api/auth/callback/google` |

   The staging and production clients' id and secret are the `staging` and `production` GitHub environments' secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see Deploy), which `just deploy-web` sets on the Worker with Terraform's `BETTER_AUTH_SECRET` (`random_password.better_auth_secret`). Without them nobody signs in with Google, so nobody can import; the smoke test still can, with an API key (`just smoke`). Wrangler keeps secrets a deploy doesn't pass, so removing one from GitHub doesn't remove it from the Worker.

## Environments

| | production | staging | preview of pull request N |
|---|---|---|---|
| Env | `production` | `staging` | `pr-N` |
| URL | https://skolia.io | https://staging.skolia.io | https://skolia-pr-N.andyyu2004.workers.dev |
| Names | `skolia`, `skolia-ingest` | `skolia-staging`, `skolia-ingest-staging` | `skolia-pr-N`, `skolia-ingest-pr-N` |
| Terraform state | `skolia.tfstate` | `skolia-staging.tfstate` | `skolia-pr-N.tfstate` |
| Wrangler | top level of `api/wrangler*.jsonc` | `env.staging` | `api/wrangler.pr-N.json`, `api/wrangler.ingest.pr-N.json` (generated) |

All are on the same account. Billing alerts are per account, so only production makes them. `infra/tf.sh <env>` and `infra/wrangler.sh <env>` run terraform and wrangler for one environment. `api/wrangler.jsonc` names each D1 database and wrangler looks up its id. If the name isn't there, `wrangler deploy` creates it outside Terraform, so Terraform goes first (`deploy-infra`); `d1 migrations apply` fails instead.

A new environment: add it to the checks in `tf.sh`, `wrangler.sh` and `deploy-ingest.sh` and to `var.env`, add its `env` blocks, then `infra/tf.sh <env> apply`, and deploy.

### Previews

Each pull request from a branch of this repository gets a preview, `pr-N`, deployed and smoke-tested on every push (`ci.yml`, job `deploy-preview`). Merging needs it to pass (`ci.yml`, job `smoke`); a fork's pull request gets none and isn't held up. It is on workers.dev only, with no Google client, so only the smoke test's API key signs in, and it accepts 20 imports a day. Its wrangler configs are made by `infra/preview.py config pr-N` from the `env.staging` blocks, with `-pr-N` names and its workers.dev URL; `deploy-infra` makes them after Terraform, and `wrangler.sh` when they're missing. They're gitignored.

Closing the pull request tears the preview down (`just teardown pr-N`, `infra/teardown.sh`): the queue's consumer, the ingest Worker, its container applications (which `wrangler delete` leaves), the skolia Worker, the bucket's objects, `terraform destroy`, then the state object. Each step skips what's already gone, so it can be run again. Every night `sweep.yml` runs `infra/sweep.sh`, which finds previews by their resources' and state's names, tears down those whose pull request isn't open, and fails if any are left; `infra/sweep.sh -n` lists them without tearing them down.

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

A push to main deploys staging and smoke-tests it: in each language it imports a new text and waits until it's ready. Production deploys are smoke-tested the same way. The smoke test imports as the system user, with an API key it writes to D1 first, and privately, so its two texts per deploy stay out of the library but count against the day's import cap. Pushing a `v*` tag on a commit in main deploys staging, then production once staging passes (`git tag v0.1.0 && git push origin v0.1.0`; `.github/workflows/ci.yml`, `deploy.yml`). The ingest Worker is deployed before the skolia Worker, since it consumes the queue the skolia Worker feeds: an API that sends a new kind of job never goes live before the ingest that handles it. Rolling back goes the other way: the skolia Worker first. Every deploy runs `deploy-ingest`: each language's image (`skolia-ingest-{lang}`) is tagged with its Nix hash, so it's built and pushed only when that tag isn't in the registry yet, and wrangler leaves an unchanged image deployed as it is. Pull requests get a `terraform plan` for staging and production (Terraform's resources only, not the Workers). GitHub needs:

- variable `CLOUDFLARE_ACCOUNT_ID`
- secrets `CLOUDFLARE_API_TOKEN` (the Terraform token above), `TFSTATE_ACCESS_KEY_ID`, `TFSTATE_SECRET_ACCESS_KEY`, `ALERT_EMAIL`, `CACHIX_AUTH_TOKEN`
- in the `staging` and `production` environments, secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the OAuth clients above)
- environments `staging`, `production` and `preview` (every pull request's)

These, and `main`'s ruleset (pull requests only, through a merge queue that requires CI's `check` and `smoke` jobs), are managed in Terraform in the dotfiles (`~/.dotfiles/terraform/github`), from `pass`.

By hand, with the credentials above, the same tasks CI runs:

```fish
just plan staging
just deploy staging              # all of the below, in order
just deploy-infra staging        # terraform apply, D1 migrations
just deploy-ingest staging       # build, push and deploy the containers
just deploy-web staging          # the skolia Worker (reader and API)
just smoke staging
just teardown pr-12              # previews only
```

`deploy-ingest` builds one image per language with Nix (`analysis/flake.nix`, `x86_64-linux`, through `analysis/scripts/nix.sh`): the models (fixed-output, pinned by hash), the venv from `uv.lock` (uv2nix), the lexicon from the inputs pinned in `inputs.sha256` (`fetch_inputs.sh <lang>` puts them in the store), and one layer per model, one for PyTorch, one for the other dependencies and one for the lexicon, as Cloudflare's registry times out committing a single 3 GB layer. Its tag is its Nix hash, which `nix eval` gives without building anything. It runs the parser check (`checks.x86_64-linux.{lang}`, which fails if the parser needs a model file the image doesn't have), pushes the image with skopeo (nix2container) with the credentials `wrangler containers push` would use, retrying, and sending only the layers the registry doesn't have, and deploys the ingest Worker with each image, pinned by the digest the registry gives (`skopeo inspect`), in place of `analysis/image/Dockerfile` under its language's name in the container's `images`. The container uses the `durable_object` scheduling policy: the ingest Worker hands each job to the `Ingester` named after its language's image, which starts a container with that image, so a deploy that changes an image sends new jobs to a new container while the old one finishes its jobs and stops. In CI each language's image is built on its own runner, in parallel before any deploy (`deploy-ingest.sh build <lang>`), pulling from and pushing to the `andyyu2004` Cachix cache everything but the models (`analysis#cacheable-{lang}`), which it downloads again when an image changes; one job then deploys the ingest Worker with all of them (`deploy-ingest.sh <env> deploy`).

A new language: its models and lexicon in `analysis/flake.nix`, an image named after it in `images` in `api/wrangler.ingest.jsonc` (both environments), the language in `langs` in `deploy-ingest.sh` and `load_images.sh` and in the `build-ingest-image` matrix in `.github/workflows/ci.yml`, and its inputs in `fetch_inputs.sh`.
