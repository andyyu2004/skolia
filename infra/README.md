# infra

Terraform for what wrangler doesn't deploy: R2 bucket, D1 databases (the app's, and a lexicon per language), queue, an R2 token for the ingest containers, and billing usage alerts. Both Workers are deployed with wrangler: `skolia` (reader + API, on workers.dev and skolia.io) from `api/wrangler.jsonc`, and `skolia-ingest` with its containers from `api/wrangler.ingest.jsonc`. Wrangler applies their Durable Object migrations; the provider resends the first migration on every update, which Cloudflare refuses ([cloudflare/terraform-provider-cloudflare#5701](https://github.com/cloudflare/terraform-provider-cloudflare/issues/5701)).

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

   The staging and production clients' id and secret are the `staging` and `production` GitHub environments' secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see Deploy), which `just deploy-web` sets on the Worker with Terraform's `BETTER_AUTH_SECRET` (`random_password.better_auth_secret`). Without them nobody signs in with Google, so nobody can import; the end-to-end tests still can, with an API key (`just e2e`). Wrangler keeps secrets a deploy doesn't pass, so removing one from GitHub doesn't remove it from the Worker.

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

Each pull request from a branch of this repository gets a preview, `pr-N`, deployed and end-to-end tested on every push (`ci.yml`, job `deploy-preview`). Merging needs it to pass (`ci.yml`, job `mergeable`); a fork's pull request gets none and isn't held up, and nor does one that only changes content (curated texts, docs, Markdown; `.github/changes.py`). It is on workers.dev only, with no Google client, so only the end-to-end tests' API keys sign in, and it accepts 20 imports a day. Its wrangler configs are made by `infra/preview.py config pr-N` from the `env.staging` blocks, with `-pr-N` names, its workers.dev URL and ingest containers that sleep after 10 s idle; `deploy-infra` makes them after Terraform, and `wrangler.sh` when they're missing. They're gitignored.

Closing the pull request tears the preview down (`just teardown pr-N`, `infra/teardown.sh`): the queue's consumer, the ingest Worker, its container applications (which `wrangler delete` leaves), the skolia Worker, the bucket's objects, `terraform destroy`, then the state object. Each step skips what's already gone, so it can be run again. Every night `sweep.yml` runs `infra/sweep.sh`, which finds previews by their resources' and state's names, tears down those whose pull request isn't open, and fails if any are left; `infra/sweep.sh -n` lists them without tearing them down.

### Container usage

`infra/container-usage.py [--since DATE] [--until DATE]` prints the containers' memory use (GiB-seconds, what Cloudflare bills; 25 GiB-hours a month are free) per environment and per day, by default for this month. Torn-down previews show as `deleted`. Most of it is deploys': each one's end-to-end tests and curated sync start a container per language, which stays up `SLEEP_AFTER` (`api/src/worker/ingest.ts`) once idle.

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

A push to main deploys staging and runs the end-to-end tests against it (`api/src/e2e.ts`), through the API: in each language it imports a new text and waits until it's ready, and meanwhile checks auth, both languages' lexicon entries, and a new user's cards (add a word, review it, mark it known). Production deploys are tested the same way. It writes two API keys to D1 first (`api/src/e2e-keys.ts`): the system user's, which imports privately, so its two texts per deploy stay out of the library (a system user's imports are outside the day's import cap); and a new user's, `e2e-<time>`, whose cards start empty (the last run's user is deleted). `deploy-web` waits for `load-lexicon`, since the journeys read the lexicon. Then `just sync-curated <env>` makes the library's curated texts match `curated/`: it imports them publicly as the curated user, a system user, with its own key (`api/src/sync-curated-key.ts`), updates their titles and licences, and deletes the curated user's texts that are no longer there (`just sync-curated <env> --check` lists what it would do). Pushing a `v*` tag on a commit in main deploys staging, then production once staging passes (`git tag v0.1.0 && git push origin v0.1.0`; `.github/workflows/ci.yml`, `deploy.yml`). The ingest Worker is deployed before the skolia Worker, since it consumes the queue the skolia Worker feeds: an API that sends a new kind of job never goes live before the ingest that handles it. Rolling back goes the other way: the skolia Worker first. Every deploy runs `deploy-ingest`: each language's image (`skolia-ingest-{lang}`) is tagged with its Nix hash, so it's built and pushed only when that tag isn't in the registry yet, and wrangler leaves an unchanged image deployed as it is. Pull requests get a `terraform plan` for staging and production (Terraform's resources only, not the Workers). GitHub needs:

- variable `CLOUDFLARE_ACCOUNT_ID`
- secrets `CLOUDFLARE_API_TOKEN` (the Terraform token above), `TFSTATE_ACCESS_KEY_ID`, `TFSTATE_SECRET_ACCESS_KEY`, `ALERT_EMAIL`, `CACHIX_AUTH_TOKEN`
- in the `staging` and `production` environments, secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the OAuth clients above)
- environments `staging`, `production` and `preview` (every pull request's)

Not every change deploys. CI's `changes` job (`.github/changes.py`) sorts a run by the files it changes, into three outputs:

- `deploy`: false only if every file is content, meaning `curated/`, `docs/` or Markdown, none of which goes into a build. CI then skips `check`, the screenshots, image builds, plans and deploys. A tag, a manual run, or a push it can't compare with its parent always deploys.
- `curated`: true if a curated text in `curated/` changed, a subset of content. With `deploy` false, CI checks only that the texts parse (`check-curated`, `api/src/curated.test.ts`) and runs `just sync-curated` (`.github/workflows/sync-curated.yml`): against staging on a push to main, and against a pull request's preview if an earlier push deployed one. Production gets them at the next tag.
- `infra`: true if something a Terraform plan reads changed (`infra/`, the flake, the justfile, `.github/`). Pull requests run `plan-infra` only then.

| Change | `deploy` | `curated` | Runs |
|---|---|---|---|
| curated texts only | false | true | check-curated, sync-curated |
| docs or Markdown only | false | false | nothing but `changes` and `mergeable` |
| texts and code | true | true | everything (the deploy syncs) |
| code | true | false | everything; `plan-infra` only if `infra` |

`check` is a required check and a skipped job counts as passing, so `mergeable` fails when `check` should have run and didn't pass, or when `check-curated` failed.

CI installs Terraform's providers from the public R2 bucket `skolia-tf-providers` (`infra/providers.tf`, made with production) through `infra/terraformrc`, since the registry sends Terraform to GitHub's releases, which time out for unauthenticated requests at times. CI's `mirror-providers` job (`infra/mirror-providers.py`, also `just mirror-providers`) runs before `check` and adds whatever in `.terraform.lock.hcl` the mirror is missing, downloading GitHub's zips with a token; a zip whose hash isn't in the lock file is refused, and the lock file's hashes check what CI installs.

These, and `main`'s ruleset (pull requests only, through a merge queue that requires CI's `check` and `mergeable` jobs), are managed in Terraform in the dotfiles (`~/.dotfiles/terraform/github`), from `pass`.

By hand, with the credentials above, the same tasks CI runs:

```fish
just plan staging
just deploy staging              # deploy-infra, deploy-ingest and deploy-web, in order; not load-lexicon
just deploy-infra staging        # terraform apply, D1 migrations
just deploy-ingest staging       # build, push and deploy the containers
just load-lexicon staging        # the flashcards' lexicon into D1, if its version is new; a preview gets each language's entries for wordfreq's 3,000 most common words
just deploy-web staging          # the skolia Worker (reader and API)
just e2e staging
just teardown pr-12              # previews only
```

`deploy-ingest` builds one image per language with Nix (`analysis/flake.nix`, `x86_64-linux`, through `analysis/scripts/nix.sh`): the models (fixed-output, pinned by hash), the venv from `uv.lock` (uv2nix), the lexicon from the inputs pinned in `inputs.sha256` (`fetch_inputs.sh <lang>` puts them in the store), and one layer per model, one for PyTorch, one for the other dependencies and one for the lexicon, as Cloudflare's registry times out committing a single 3 GB layer. Its tag is its Nix hash, which `nix eval` gives without building anything. It runs the parser check (`checks.x86_64-linux.{lang}`, which fails if the parser needs a model file the image doesn't have), pushes the image with skopeo (nix2container) with the credentials `wrangler containers push` would use, retrying, and sending only the layers the registry doesn't have, and deploys the ingest Worker with each image, pinned by the digest the registry gives (`skopeo inspect`), in place of `analysis/image/Dockerfile` under its language's name in the container's `images`. The container uses the `durable_object` scheduling policy: the ingest Worker hands each job to the `Ingester` named after its language's image, which starts a container with that image, so a deploy that changes an image sends new jobs to a new container while the old one finishes its jobs and stops. In CI each language's image is built on its own runner, in parallel before any deploy (`deploy-ingest.sh build <lang>`), pulling from and pushing to the `andyyu2004` Cachix cache everything but the models (`analysis#cacheable-{lang}`), which it downloads again when an image changes; one job then deploys the ingest Worker with all of them (`deploy-ingest.sh <env> deploy`).

A new language: its models and lexicon in `analysis/flake.nix`, an image named after it in `images` in `api/wrangler.ingest.jsonc` (both environments), the language in `langs` in `deploy-ingest.sh` and `load_images.sh` and in `langs` in the `justfile`, `local.langs` in `infra/variables.tf`, a `LEXICON_{LANG}` binding in `api/wrangler.jsonc` (both environments) and in the `build-ingest-image` matrix in `.github/workflows/ci.yml`, and its inputs in `fetch_inputs.sh`.
