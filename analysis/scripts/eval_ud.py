"""Score the analyser against a hand-annotated UD treebank with the official CoNLL 2018
evaluation script (scripts/vendor/conll18_ud_eval.py).

The raw text of every gold sentence goes through the analyser (one sentence per paragraph),
so tokenization, sentence splitting, tagging, lemmas and parsing are all scored. The parse
runs once; each --snap policy is then scored on the same parse.

Metrics are F1 over aligned words: UPOS, XPOS, UFeats (universal features), AllTags (all
three right), Lemmas, UAS (right head), LAS (right head and relation), MLAS/BLEX (LAS that
also requires features/lemma right on content words).

usage: uv run python scripts/eval_ud.py gold.conllu --lang pl [--model stanza]
                                         [--snap none lemma ...]
"""

import argparse
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from skolia_analysis import lang, reconcile
from skolia_analysis.conllu import write
from skolia_analysis.parsed import Parser
from skolia_analysis.plugin import Options
from skolia_analysis.treebank import CachedParser, gold_text

EVALUATOR = Path(__file__).parent / "vendor" / "conll18_ud_eval.py"
METRICS = [
    *("Tokens", "Sentences", "Words"),
    *("UPOS", "XPOS", "UFeats", "AllTags", "Lemmas"),
    *("UAS", "LAS", "MLAS", "BLEX"),
]
NO_SNAP = "none"


def evaluate(gold: Path, system: Path) -> dict[str, float]:
    result = subprocess.run(
        [sys.executable, str(EVALUATOR), "-v", str(gold), str(system)],
        capture_output=True,
        text=True,
        check=True,
    )
    scores: dict[str, float] = {}
    for line in result.stdout.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) >= 4 and cells[0] in METRICS:
            scores[cells[0]] = float(cells[3])
    return scores


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("gold", type=Path)
    parser.add_argument("--lang", choices=lang.LANGS, required=True)
    parser.add_argument("--model", help="default: the language's")
    parser.add_argument("--cache", type=Path, help="reuse parser output stored here")
    parser.add_argument(
        "--snap", nargs="+", default=[NO_SNAP], choices=[NO_SNAP, *reconcile.POLICIES]
    )
    parser.add_argument("--limit", type=int, help="only the first N sentences")
    parser.add_argument("--out", type=Path, help="keep the system CoNLL-U files here")
    parser.add_argument(
        "--data",
        type=Path,
        help="the language's data directory, to score with what the plugin uses besides the "
        "parser (Polish: case correction from verb frames)",
    )
    args = parser.parse_args()
    plugin = lang.plugin(args.lang)
    model_name: str = args.model or plugin.DEFAULT_MODEL
    if model_name not in plugin.MODELS:
        parser.error(f"unknown model {model_name!r}; {args.lang} has {', '.join(plugin.MODELS)}")

    gold: Path = args.gold
    text = gold_text(gold)
    if args.limit:
        text = "\n\n".join(text.split("\n\n")[: args.limit])
        trimmed = "\n\n".join(gold.read_text(encoding="utf-8").split("\n\n")[: args.limit])
        with tempfile.NamedTemporaryFile("w", suffix=".conllu", delete=False) as gold_file:
            gold_file.write(trimmed + "\n\n")
        gold = Path(gold_file.name)

    model: Parser = (
        CachedParser(args.lang, model_name, lambda: plugin.parser(model_name), args.cache)
        if args.cache
        else plugin.parser(model_name)
    )
    started = time.perf_counter()
    parsed = model(text)
    seconds = time.perf_counter() - started
    print(f"{model_name}: parsed {len(parsed)} sentences in {seconds:.0f} s", file=sys.stderr)

    out: Path = args.out or Path(tempfile.mkdtemp())
    out.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, dict[str, float]]] = []
    for snap in args.snap:
        policy = None if snap == NO_SNAP else snap
        analyzer = plugin.analyzer(model, Options(policy), args.data)
        blob = analyzer.assemble(text, parsed)
        system = out / f"{args.lang}-{model_name}-snap-{snap}.conllu"
        system.write_text(write(blob, text), encoding="utf-8")
        rows.append((snap, evaluate(gold, system)))

    print(f"model {model.name}, gold {args.gold.name}, F1 %")
    print(f"{'snap':12}" + "".join(f"{m:>9}" for m in METRICS))
    for snap, scores in rows:
        print(f"{snap:12}" + "".join(f"{scores.get(m, float('nan')):9.2f}" for m in METRICS))
    if args.out:
        print(f"system files in {out}")


if __name__ == "__main__":
    main()
