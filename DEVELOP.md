# Developing skolia

| Folder | What | Language |
|---|---|---|
| `analysis/` | analyser, lexicon build, `skolia-ingest` (queue worker) | Python, uv |
| `api/` | `skolia-api`: documents, import, serving analyses and bundles; `skolia-ingest`'s Worker | TypeScript, Hono on Workers |
| `reader/` | the reader app (phone and desktop) | Svelte 5, TypeScript, Vite |
| `shared/` | types and blob keys used by api and reader; `schema.gen.ts` is generated from the Python schemas | TypeScript |
| `data/` | git-ignored: Kaikki extract, lexicon, local SQLite, sample texts | |

## Running it all locally

```
reader (Vite, :5173) → wrangler dev (:8787): skolia → local queue → skolia-ingest → container
                                              └── local D1, R2 ◄── S3 API ──────────┘
```

`wrangler dev` runs both Workers from their configs, with local D1, R2 and Queue in `api/.wrangler/state`, and builds the ingest container from `analysis/Dockerfile` with Docker. The container reaches the local bucket through the dev server's S3 endpoint (`api/.env`, which wrangler dev loads for both Workers; `--env-file` would reach only the first config, and an `api/.dev.vars` would replace it).

Once: install the JavaScript packages and build the lexicon (`mise run data`, see Lexicon below).

```fish
pnpm install                 # from the repo root: api, reader and shared
mise run dev                 # http://localhost:5173 (Vite), or :8787 for the built reader
mise run e2e                 # fresh local state: import a text, wait until it's ready
```

- `mise run e2e` needs port 8787 free, so stop `mise run dev` first. Its log is `api/.wrangler/e2e.log`.
- The first build of the ingest image downloads the models (about 2 GB) and takes a while; later builds reuse Docker's layer cache.
- The ingest image builds natively for `linux/arm64` (Apple Silicon, ARM Linux) and `linux/amd64`. PyPI's `morfeusz2` has a Linux wheel for x86-64 only, so the Dockerfile compiles Morfeusz from SGJP's source and installs SGJP's compiled dictionary from the same release (1.99.15, 2026-06-01). On 16,325 words (PDB dev plus the sample texts) and the 10,971 lemmas they analyse to, its `analyse` and `generate` output is byte-identical to the PyPI wheel's, on both architectures. A 4,700-word text takes about 100 s natively on an M-series Mac.
- To bump Morfeusz: change `MORFEUSZ_RELEASE` and both SHA-256 values in `analysis/Dockerfile`, and the `morfeusz2` version in `pyproject.toml`, to the same release.
- On a phone on the same network: `pnpm --filter @skolia/reader dev --host` and open the address it prints.
- Sign-in is optional: without it you can read, but no flashcards are made. To try sign-in locally, put the dev OAuth client's credentials (infra/README.md) and any 32+ character secret in `api/.env.local` (git-ignored, loaded with `api/.env`): `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Without them `/api/auth` answers 503. Sign in from http://localhost:5173, the origin `BASE_URL` names.

## API and reader (TypeScript)

```fish
pnpm -r check                # tsc (api), svelte-check (reader)
pnpm -r test                 # node --test; mise run build first, for api/dist
```

Nothing is faked. The `*.workerd.test.ts` files load the built Worker (`api/dist`, what Terraform uploads) into wrangler's test harness (`api/src/testing/harness.ts`), which runs it in workerd with local D1, R2, queue and Durable Objects. The route tests call the app with the real adapters over those bindings and Better Auth on the local D1. A test-only Worker (`api/src/testing/ingest-recorder.ts`) consumes the local queue so the tests can see what was queued. `mise run test` builds first. The `*.workerd.test.ts` files need both Node and Workers types, so they have their own `tsconfig.workerd-test.json`.

Each user's data lives in their own Durable Object (`api/src/worker/user.ts`), addressed by their user id, with plain SQL (`api/src/user/queries.ts`). To change the schema, add the next numbered file to `api/src/user/migrations/` exporting `up` and `down` SQL, and list it in `index.ts`; never edit a migration that has been deployed. Each object migrates to the latest version the next time it starts, and `User.migrate(version)` moves it up or down to any version (0 is empty). Applied versions are kept in the object's `migration` table (Durable Objects don't allow `PRAGMA user_version`). They're `.ts`, not `.sql`, because wrangler would upload `.sql` imports as separate modules and Terraform uploads only `main.js`. Tables keyed by text are `WITHOUT ROWID` (one B-tree instead of a rowid table plus its primary-key index).

Request bodies, the blobs ingest writes, and database rows are checked with the Zod schemas in `shared/schemas.ts`; `shared/api.ts` takes its types from them with type-only imports, so the reader doesn't bundle Zod. Import Zod as `import * as z from "zod"`: `import { z } from "zod"` keeps all of Zod in the Worker bundle, its locales included (807 KiB vs 1163 KiB). esbuild, which wrangler bundles with, can only drop the parts of a namespace it imports itself, and zod's `z` is a namespace it re-exports. `api/src/bundle.test.ts` fails when the gzipped Worker grows past its budget; raise the budget when the growth is wanted.

Both are strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). The API uses TypeScript 7; the reader stays on 6 because svelte-check, which type-checks the `.svelte` components, supports TypeScript 5 and 6 only (move it to 7 when svelte-check does). The tests run the `.ts` files directly with Node's type stripping (wrangler bundles them for Workers); that also means TypeScript-only syntax (enums, parameter properties) isn't allowed (`erasableSyntaxOnly`).

After changing a Python schema (`schema.py`, `lexicon/schema.py`, `ingest/schema.py`), regenerate the TypeScript types; `tests/test_ts_types.py` fails until you do:

```fish
cd analysis; and uv run python scripts/gen_ts_types.py > ../shared/schema.gen.ts
```

## Analysis (Python)

Needs [uv](https://docs.astral.sh/uv/). uv reads `.python-version` and installs Python 3.12 if needed.

```fish
cd analysis
uv sync                      # runtime + dev dependencies
```

Models download on first use:
- COMBO (the default): from Hugging Face into `~/.cache/huggingface/hub`
- Stanza Polish: 344 MB for `stanza` (Stanza 1.15), more for `stanza-accurate` (adds HerBERT from Hugging Face), in `~/Library/Caches/stanza/<version>/resources` on macOS

### Run

```fish
echo "Idę do starego psa." | uv run skolia-analyze --indent 2
echo "Idę do starego psa." | uv run skolia-analyze --model combo --format conllu
uv run skolia-analyze --help
```

Text on stdin, the analysis on stdout (blob JSON, or CoNLL-U with `--format conllu`).

- `--model` picks the parser: `combo` (default, most accurate), `stanza-accurate`, `stanza` (fastest). Scores are in `analysis/EVALUATION.md`.
- `--snap` sets how a parser reading the dictionary doesn't allow is replaced (`reconcile.py`); `none` turns it off.
- `--expressions file.json` matches multi-word expressions (format in `--help`); `--no-candidates` skips Morfeusz.

### Test, lint, typecheck

```fish
uv run pytest -q
uv run ruff check .          # lint; add --fix to apply safe fixes
uv run ruff format .         # format; --check to only report
uv run pyright               # strict type check of src, tests, scripts
```

All four together:

```fish
uv run ruff format --check . ; and uv run ruff check . ; and uv run pyright ; and uv run pytest -q
```

Pyright is strict: no untyped parameters, no `Unknown` types. Stanza, Morfeusz and COMBO ship no type information, so `typings/` holds hand-written stubs for the parts we use, and each parser backend checks labels at runtime with `ud.py`. Update the stubs if we start using more of a library.

`scripts/vendor/` holds third-party code (the CoNLL 2018 evaluator) and is excluded from lint and type checks.

### Evaluate against a treebank

The scripts in `scripts/` measure the analyser against UD Polish PDB, a hand-annotated treebank. Download it once (35 MB, not committed):

```fish
mkdir -p ~/data/ud_pdb
for s in train dev test
    curl -fsSL -o ~/data/ud_pdb/pl_pdb-ud-$s.conllu https://raw.githubusercontent.com/UniversalDependencies/UD_Polish-PDB/master/pl_pdb-ud-$s.conllu
end
```

The main one scores the whole analyser with the official CoNLL 2018 evaluator:

```fish
uv run python scripts/eval_ud.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu --snap none upos
uv run python scripts/eval_ud.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu --model stanza --cache ~/data/skolia-parse-cache --snap none lemma+upos upos nearest
```

It prints F1 for tokens, sentences, UPOS, XPOS, features, lemmas, UAS and LAS, one row per `--snap` policy. `--cache` keeps each model's parse so later runs skip the slow part. `--out DIR` keeps the CoNLL-U output. Update `analysis/EVALUATION.md` when a default changes.

Tune on dev, report on test: choose defaults by their dev scores so the test score stays an honest estimate.

Two narrower checks:

```fish
# is the hand-annotated reading among Morfeusz's candidates? (no parser involved, about 1 s)
uv run python scripts/eval_candidates.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu

# is the parser's reading among Morfeusz's candidates? (runs the full analyser)
uv run python scripts/eval_parser_in_candidates.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu
```

PDB is licensed CC BY-NC-SA 4.0 (non-commercial). Use it for evaluation only; don't ship it or anything derived from it.

### Lexicon

Large inputs and outputs live in `data/` at the repo root (git-ignored). The lexicon and valency files the image ships are built from the inputs pinned in `inputs.sha256`, kept in R2 (`skolia-tfstate/inputs/{sha256}-{name}.zst`) because kaikki.org overwrites its extract in place. This is what CI runs (needs `wrangler login`):

```fish
scripts/build_data.sh   # → ../data/lexicon/pl.sqlite and pl-valency.json
```

The lexicon's version names the extract by its hash, so the same extract gives the same version on any machine. To move to a newer extract (this re-bundles every document once):

```fish
mkdir -p ../data/kaikki
curl -fsSL -o ../data/kaikki/kaikki.org-dictionary-Polish.jsonl https://kaikki.org/dictionary/Polish/kaikki.org-dictionary-Polish.jsonl
set -l sha (shasum -a 256 ../data/kaikki/kaikki.org-dictionary-Polish.jsonl | cut -d' ' -f1)
zstd -19 -T0 -c ../data/kaikki/kaikki.org-dictionary-Polish.jsonl | pnpm --dir ../api exec wrangler r2 object put skolia-tfstate/inputs/$sha-kaikki.org-dictionary-Polish.jsonl.zst --pipe --remote
# then put $sha on the kaikki line of inputs.sha256
```

Or build from a local extract (about 10 s):

```fish
uv run skolia-build-lexicon ../data/kaikki/kaikki.org-dictionary-Polish.jsonl ../data/lexicon/pl.sqlite
```

A document's bundle (the lexicon slice the phone downloads) from its analysis:

```fish
uv run skolia-analyze < text.txt > text.json
uv run skolia-bundle --lexicon ../data/lexicon/pl.sqlite < text.json > text.bundle.json
```

How many analysed words get a meaning:

```fish
uv run python scripts/eval_lexicon.py ../data/lexicon/pl.sqlite text.json
```

Wiktionary content is CC BY-SA 4.0: bundles carry an `attribution` string, and the app must show it.

### Verb valency (case reasons)

The "Why genitive?" line uses Walenty, IPI PAN's valency dictionary (CC BY-SA 4.0): which cases each word's complements take. Download the 2018 plain-text release (MD5 `3fb7903751ba024d1c3ceaf1b3fd82dd`) and parse it into one typed JSON file (`walenty/model.py`; all 96,829 schemata of verbs, nouns, adjectives and adverbs plus the expansions, about 3 s, 35 MB):

```fish
mkdir -p ../data/walenty
curl -fsSL -o ../data/walenty/walenty_20180630-text.zip 'https://clarin-pl.eu/dspace/bitstream/handle/11321/586/walenty_20180630-text.zip?sequence=1'
unzip -q -o ../data/walenty/walenty_20180630-text.zip -d ../data/walenty/text
uv run skolia-build-valency ../data/walenty/text/walenty_20180630-text ../data/lexicon/pl-valency.json
echo "Nie mam czasu." | uv run skolia-analyze --valency ../data/lexicon/pl-valency.json --indent 2
```

The parser is strict: a construct or value the model doesn't know is an error, so a new Walenty release fails loudly until `walenty/vocabulary.py` or `model.py` covers it. `tests/test_walenty.py` parses and re-renders the whole release when it's downloaded (every line must come back identical), and skips that test otherwise.

Ingest reads it from `SKOLIA_VALENCY` (set in `analysis/Dockerfile`). Coverage and a sample of reasons to read:

```fish
uv run python scripts/eval_case_reasons.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu --cache ~/data/skolia-parse-cache --valency ../data/lexicon/pl-valency.json
```
