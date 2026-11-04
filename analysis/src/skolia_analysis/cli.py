import argparse
import json
import sys
from pathlib import Path

from . import conllu, pl, reconcile
from .blob import CandidateLookup
from .plugin import LanguagePlugin
from .schema import ExpressionDef
from .valency import Valency

PLUGINS: dict[str, LanguagePlugin] = {pl.LANG: pl}

EPILOG = """\
models:
{models}

expressions file:
  A JSON list of multi-word expressions to find, each given as a sequence of lemmas
  (dictionary forms), so every inflected form matches:

    [{{"id": "pl:dać sobie radę", "lemmas": ["dać", "siebie", "rada"]}}]

  Use the lemmas the analyser outputs (siebie, not sobie). Matches are contiguous only.
  Each match is reported per sentence as {{"from": <token>, "to": <token>, "id": <id>}}.
"""

NO_SNAP = "none"


def main() -> None:
    models = "\n".join(
        f"  {lang}: {', '.join(p.MODELS)} (default {p.DEFAULT_MODEL})"
        for lang, p in PLUGINS.items()
    )
    parser = argparse.ArgumentParser(
        prog="skolia-analyze",
        description="Read text on stdin, write the analysis to stdout.",
        epilog=EPILOG.format(models=models),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--lang", choices=sorted(PLUGINS), default=pl.LANG, help="language of the input text"
    )
    parser.add_argument("--model", help="parser model; see the list below")
    parser.add_argument(
        "--snap",
        choices=[*reconcile.POLICIES, NO_SNAP],
        help="replace parser readings the dictionary doesn't allow (see reconcile.py); "
        "default depends on the language",
    )
    parser.add_argument(
        "--expressions", type=Path, help="JSON file of expressions to match (format below)"
    )
    parser.add_argument(
        "--no-candidates",
        action="store_true",
        help="don't look up dictionary readings; tokens only get the parser's reading",
    )
    parser.add_argument(
        "--format", choices=["json", "conllu"], default="json", help="output format"
    )
    parser.add_argument("--indent", type=int, help="pretty-print the JSON with this indent")
    parser.add_argument(
        "--valency",
        type=Path,
        help="verb frames file (skolia-build-valency), to explain cases by what verbs require",
    )
    args = parser.parse_args()

    plugin = PLUGINS[args.lang]
    model_name: str = args.model or plugin.DEFAULT_MODEL
    if model_name not in plugin.MODELS:
        parser.error(f"unknown model {model_name!r} for {args.lang}; see --help")
    snap: str | None = plugin.DEFAULT_SNAP if args.snap is None else args.snap
    if snap == NO_SNAP:
        snap = None
    expressions: list[ExpressionDef] = (
        json.loads(args.expressions.read_text()) if args.expressions else []
    )
    candidates: CandidateLookup | None = None if args.no_candidates else plugin.candidate_lookup()

    valency = Valency.load(args.valency) if args.valency else None

    text = sys.stdin.read()
    model = plugin.parser(model_name)
    blob = plugin.analyze(text, model, candidates, expressions, snap, valency)
    if args.format == "conllu":
        sys.stdout.write(conllu.write(blob, text))
    else:
        json.dump(blob, sys.stdout, ensure_ascii=False, indent=args.indent)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
