# just <recipe> [env]. CI runs the same recipes (.github/workflows/ci.yml). Deploy recipes
# need the credentials in infra/README.md. terraform and just come from flake.nix
# (nix develop).

set shell := ["bash", "-euo", "pipefail", "-c"]

# Each has its own lexicon database, LEXICON_{LANG} (shared/api.ts LANGS)
langs := "en fr pl"

_default:
    @just --list

# Typecheck and lint everything
check:
    pnpm check
    cd analysis && uv run ruff check . && uv run ruff format --check . && uv run pyright
    terraform -chdir=infra fmt -check
    TF_DATA_DIR=.terraform-validate terraform -chdir=infra init -backend=false -input=false >/dev/null
    TF_DATA_DIR=.terraform-validate terraform -chdir=infra validate

# Unit tests, and the built Worker's Durable Object in workerd
test: build
    pnpm test
    cd analysis && uv run pytest -q

# Screenshots of the reader's pages (reader/screenshots) in Playwright's Linux image, so they come
# out the same on a Mac and in CI. --update-snapshots accepts what changed. --ipc=host, as
# https://playwright.dev/docs/docker recommends for Chromium, which runs out of memory otherwise.
screenshot *args:
    pnpm --filter @skolia/reader build
    docker run --rm --ipc=host -e CI -v "$PWD:$PWD" -w "$PWD/reader" \
        mcr.microsoft.com/playwright:v$(node -p 'require("./reader/package.json").devDependencies["@playwright/test"]')-noble \
        node_modules/.bin/playwright test {{ args }}

# The reader and the API bundle (api/dist, for the workerd tests)
build:
    pnpm --filter @skolia/reader build
    pnpm --dir api exec wrangler deploy --dry-run --outdir dist --env=''

# wrangler dev (both Workers, the ingest container, local D1/R2/queue) and the reader's Vite server,
# with the curated texts in curated/ synced once the API is up
[parallel]
dev: dev-api dev-reader dev-sync-curated

# Waits up to 30 minutes for wrangler dev (dev-api builds the ingest images first), then just sync-curated local
dev-sync-curated:
    #!/usr/bin/env bash
    set -euo pipefail
    for _ in $(seq 900); do
      if curl -fs -o /dev/null http://localhost:8787/api/documents; then
        exec just sync-curated local
      fi
      sleep 2
    done
    echo "wrangler dev didn't come up on :8787; not syncing" >&2
    exit 1

# migrations apply has no flag to skip its confirmation; without a TTY on stdin it doesn't ask

# wrangler dev on :8787 with local state in api/.wrangler/state
[working-directory('api')]
dev-api: install images env-local
    pnpm --filter @skolia/reader build
    pnpm exec wrangler d1 migrations apply DB --local --env='' </dev/null
    for lang in {{ langs }}; do pnpm exec wrangler d1 migrations apply "LEXICON_$(tr a-z A-Z <<<"$lang")" --local --env='' </dev/null; done
    just load-lexicon local
    pnpm exec wrangler dev -c wrangler.jsonc -c wrangler.ingest.jsonc --port 8787

# The Node packages, as pnpm-lock.yaml has them
install:
    pnpm install --frozen-lockfile

# api/.env.local, the dev Google OAuth client, from secrets/dev.env if it's missing. sops finds the
# age key through .envrc.
[working-directory('api')]
env-local:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f .env.local ] && exit
    if ! sops decrypt ../secrets/dev.env > .env.local.tmp; then
      rm -f .env.local.tmp
      echo "env-local: can't decrypt secrets/dev.env, so only API keys sign in; DEVELOP.md says how to get your age key added" >&2
      exit 0
    fi
    mv .env.local.tmp .env.local

# Vite on :5173, proxying /api to :8787
dev-reader: install
    pnpm --filter @skolia/reader dev --port 5173 --strictPort

# Build each language's ingest image with Nix and load it into Docker for wrangler dev
images:
    analysis/scripts/load_images.sh

# What a deploy would change in Terraform's resources (env: staging, production or pr-<N>)
plan env:
    infra/tf.sh {{ env }} plan -input=false

# Apply D1 migrations
migrate env:
    infra/wrangler.sh {{ env }} d1 migrations apply DB --remote
    for lang in {{ langs }}; do infra/wrangler.sh {{ env }} d1 migrations apply "LEXICON_$(tr a-z A-Z <<<"$lang")" --remote; done

# Load each language's lexicon into its database (staging, production, pr-N or local), from its Nix build for cards.
# A preview gets each language's entries for wordfreq's 3,000 most common words (infra/load-lexicon.py --sample).
# A language whose build evaluates to the Nix output D1 last loaded is skipped without building it.
# flags go to infra/load-lexicon.py (api/scripts/e2e.sh: --sample, --persist-to).
load-lexicon env *flags:
    #!/usr/bin/env bash
    set -euo pipefail
    case {{ env }} in pr-*) sample=(--sample 3000) ;; *) sample=() ;; esac
    for lang in {{ langs }}; do
      build="./analysis#cards-lexicon-$lang"
      out=$(nix eval --raw "$build.outPath")
      state=$(infra/load-lexicon.py {{ env }} --lang "$lang" --built-from "$out" "${sample[@]}" {{ flags }})
      if [ "$state" = current ]; then echo "{{ env }}: $lang already serves $out"; continue; fi
      out=$(nix build --no-link --print-out-paths "$build")
      infra/load-lexicon.py {{ env }} "$out/$lang.cards.sqlite" --built-from "$out" "${sample[@]}" {{ flags }}
    done

# Terraform: storage, queue, ingest's R2 token, billing alerts
apply env:
    infra/tf.sh {{ env }} apply -input=false

# Terraform and D1 migrations, the ingest Worker, then the skolia Worker: the queue's consumer before its producer
deploy env: (deploy-infra env) (deploy-ingest env) (deploy-web env)

# Terraform, then D1 migrations; for a preview, its wrangler configs in between
deploy-infra env: (apply env) && (migrate env)
    case {{ env }} in pr-*) infra/preview.py config {{ env }} ;; esac

# The skolia Worker (reader and API) with wrangler, with Terraform's BETTER_AUTH_SECRET and, if set,
# GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the environment (GitHub's, in CI) as its secrets
deploy-web env:
    #!/usr/bin/env bash
    set -euo pipefail
    # The version /api/version and the reader's footer show
    export VITE_VERSION=$(git describe --tags --always --dirty)
    pnpm --filter @skolia/reader build
    dir=$(mktemp -d)
    trap 'rm -rf "$dir"' EXIT
    # JSON: wrangler expands $ in a dotenv file
    infra/tf.sh {{ env }} output -raw better_auth_secret | jq -Rn '{BETTER_AUTH_SECRET: input}
      + ({GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET} | with_entries(select((.value // "") != "")))' > "$dir/secrets.json"
    infra/wrangler.sh {{ env }} deploy --define "VERSION:\"$VITE_VERSION\"" --secrets-file "$dir/secrets.json"

# Build, push and deploy the ingest container
deploy-ingest env:
    infra/deploy-ingest.sh {{ env }}

# local (the default): against wrangler dev with fresh local state and the lexicon samples
# (api/scripts/e2e.sh; needs Docker). Otherwise the deployed environment, after checking it serves this
# checkout's version, with new API keys for the system user and a new e2e user written to its D1 first
# (api/src/e2e-keys.ts).
# The end-to-end tests (api/src/e2e.ts): import a text and wait until it's ready, auth, the lexicon, cards
e2e env="local":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ {{ env }} = local ]; then
      just install build images
      exec api/scripts/e2e.sh {{ langs }}
    fi
    url=$(just url {{ env }})
    E2E_API_KEY=$(openssl rand -hex 32) E2E_USER_KEY=$(openssl rand -hex 32)
    export E2E_API_KEY E2E_USER_KEY
    just d1-sql {{ env }} api/src/e2e-keys.ts
    node api/src/e2e.ts "$url" "$(git describe --tags --always --dirty)"

# Make the curated user's documents match curated/ (api/src/sync-curated.ts); with --check, only list what that takes.
# Writes a new API key for the curated user to the environment's D1 first (api/src/sync-curated-key.ts).
sync-curated env *flags:
    #!/usr/bin/env bash
    set -euo pipefail
    url=$(just url {{ env }})
    SYNC_CURATED_API_KEY=$(openssl rand -hex 32)
    export SYNC_CURATED_API_KEY
    just d1-sql {{ env }} api/src/sync-curated-key.ts
    node api/src/sync-curated.ts "$url" curated {{ flags }}

# The environment's URL
[private]
url env:
    #!/usr/bin/env bash
    case {{ env }} in
      local) echo http://localhost:8787 ;;
      production) echo https://skolia.io ;;
      staging) echo https://staging.skolia.io ;;
      *) infra/preview.py url {{ env }} ;;
    esac

# Runs the SQL a script prints (its API keys) on the environment's D1
[private]
d1-sql env script:
    #!/usr/bin/env bash
    set -euo pipefail
    dir=$(mktemp -d)
    trap 'rm -rf "$dir"' EXIT
    node {{ script }} > "$dir/keys.sql"
    if [ {{ env }} = local ]; then
      pnpm --dir api exec wrangler d1 execute DB --local --env='' --file "$dir/keys.sql" >/dev/null
    else
      infra/wrangler.sh {{ env }} d1 execute DB --remote --yes --file "$dir/keys.sql" >/dev/null
    fi

# Add infra/.terraform.lock.hcl's providers to skolia-tf-providers, which CI installs them from (infra/terraformrc)
mirror-providers:
    infra/mirror-providers.py

# Delete a preview (pr-<N>): its Workers, container applications, storage, queue and Terraform state
teardown env:
    infra/teardown.sh {{ env }}
