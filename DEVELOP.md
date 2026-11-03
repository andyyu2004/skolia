# Developing skolia

Only `analysis/` exists so far. Commands below run from there.

## Analysis (Python)

Needs [uv](https://docs.astral.sh/uv/). uv reads `.python-version` and installs Python 3.12 if needed.

```fish
cd analysis
uv sync                      # create .venv with runtime + dev dependencies
```

The first run downloads the Stanza Polish models (344 MB for Stanza 1.15) to `~/Library/Caches/stanza/<version>/resources` on macOS.

### Run

```fish
echo "Idę do starego psa." | uv run skolia-analyze --indent 2
uv run skolia-analyze --help
```

Text on stdin, blob JSON on stdout. `--expressions file.json` matches multi-word expressions (format in `--help`); `--no-candidates` skips Morfeusz.

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

Pyright is strict: no untyped parameters, no `Unknown` types. Stanza and Morfeusz ship no type information, so `typings/` holds hand-written stubs for the parts we use. Update them if we start using more of either library.

### Evaluate against a treebank

The scripts in `scripts/` measure the analyser against UD Polish PDB, a hand-annotated treebank. Download it once (35 MB, not committed):

```fish
mkdir -p ~/data/ud_pdb
for s in train dev test
    curl -fsSL -o ~/data/ud_pdb/pl_pdb-ud-$s.conllu https://raw.githubusercontent.com/UniversalDependencies/UD_Polish-PDB/master/pl_pdb-ud-$s.conllu
end
```

```fish
# is the hand-annotated reading among Morfeusz's candidates? (no parser involved, about 1 s)
uv run python scripts/eval_candidates.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu

# is Stanza's reading among Morfeusz's candidates? (runs the full analyser, ~40 s)
uv run python scripts/eval_parser_in_candidates.py ~/data/ud_pdb/pl_pdb-ud-dev.conllu
```

Both print an overall rate and the most common mismatch patterns with an example word. `eval_parser_in_candidates.py` also takes a plain text file, one paragraph per line.

PDB is licensed CC BY-NC-SA 4.0 (non-commercial). Use it for evaluation only; don't ship it or anything derived from it.
