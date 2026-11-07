# What wrangler dev runs for each language: the image Nix builds (analysis/flake.nix),
# loaded into Docker by analysis/scripts/load_images.sh (just images). Deploys use the
# pushed image instead (infra/deploy-ingest.sh).
ARG SKOLIA_LANG
FROM skolia-ingest-${SKOLIA_LANG}:dev
