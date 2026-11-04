# Developing skolia

Only `analysis/` exists so far. Commands below run from there.

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

Large inputs and outputs live in `data/` at the repo root (git-ignored). Download Kaikki's Polish Wiktionary extract (about 900 MB) and build the lexicon (about 10 s):

```fish
mkdir -p ../data/kaikki ../data/lexicon
curl -fsSL -o ../data/kaikki/kaikki.org-dictionary-Polish.jsonl https://kaikki.org/dictionary/Polish/kaikki.org-dictionary-Polish.jsonl
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
