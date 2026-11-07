# just <recipe> [env]. CI runs the same recipes (.github/workflows/ci.yml). Deploy recipes
# need the credentials in infra/README.md. terraform and just come from flake.nix
# (nix develop).

set shell := ["bash", "-euo", "pipefail", "-c"]

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

# The reader and the API bundle (api/dist, for the workerd tests)
build:
    pnpm --filter @skolia/reader build
    pnpm --dir api exec wrangler deploy --dry-run --outdir dist --env=''

# wrangler dev (both Workers, the ingest container, local D1/R2/queue) and the reader's Vite server
[parallel]
dev: dev-api dev-reader

# wrangler dev on :8787 with local state in api/.wrangler/state
[working-directory('api')]
dev-api: images env-local
    pnpm exec wrangler d1 migrations apply DB --local --env=''
    pnpm exec wrangler dev -c wrangler.jsonc -c wrangler.ingest.jsonc --port 8787

# api/.env.local, the dev Google OAuth client, from secrets/dev.env if it's missing. sops on macOS
# looks for the age key in ~/Library/Application Support, so this points it at ~/.config's.
[working-directory('api')]
env-local:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f .env.local ] && exit
    key=${XDG_CONFIG_HOME:-$HOME/.config}/sops/age/keys.txt
    if [ -z "${SOPS_AGE_KEY_FILE:-}" ] && [ -f "$key" ]; then export SOPS_AGE_KEY_FILE=$key; fi
    if ! sops decrypt ../secrets/dev.env > .env.local.tmp; then
      rm -f .env.local.tmp
      echo "env-local: can't decrypt secrets/dev.env; DEVELOP.md says how to get your age key added" >&2
      exit 1
    fi
    mv .env.local.tmp .env.local

# Vite on :5173, proxying /api to :8787
dev-reader:
    pnpm --filter @skolia/reader dev --port 5173 --strictPort

# Import a text through wrangler dev with fresh local state and wait until it's ready
e2e: build images
    api/scripts/e2e.sh

# Build each language's ingest image with Nix and load it into Docker for wrangler dev
images:
    analysis/scripts/load_images.sh

# What a deploy would change in Terraform's resources (env: staging, production or pr-<N>)
plan env:
    infra/tf.sh {{ env }} plan -input=false

# Apply D1 migrations
migrate env:
    infra/wrangler.sh {{ env }} d1 migrations apply DB --remote

# Terraform: storage, queue, ingest's R2 token, billing alerts
apply env:
    infra/tf.sh {{ env }} apply -input=false

# Terraform and D1 migrations, the ingest Worker, then the skolia Worker: the queue's consumer before its producer
deploy env: (deploy-infra env) (deploy-ingest env) (deploy-web env)

# Terraform, then D1 migrations; for a preview, its wrangler configs in between (they need its D1 id)
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

# Check the environment serves this checkout's version, then import a new text and wait until it's ready.
# Writes a new API key for the system user to the environment's D1 first.
smoke env:
    #!/usr/bin/env bash
    set -euo pipefail
    case {{ env }} in
      production) url=https://skolia.io ;;
      staging) url=https://staging.skolia.io ;;
      *) url=$(infra/preview.py url {{ env }}) || exit ;;
    esac
    SMOKE_API_KEY=$(openssl rand -hex 32)
    export SMOKE_API_KEY
    dir=$(mktemp -d)
    trap 'rm -rf "$dir"' EXIT
    sql=$dir/smoke-key.sql
    node api/src/smoke-key.ts > "$sql"
    infra/wrangler.sh {{ env }} d1 execute DB --remote --yes --file "$sql" >/dev/null
    node api/src/smoke.ts "$url" "$(git describe --tags --always --dirty)"

# Delete a preview (pr-<N>): its Workers, container applications, storage, queue and Terraform state
teardown env:
    infra/teardown.sh {{ env }}
