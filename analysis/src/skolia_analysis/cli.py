import argparse
import json
import sys
from pathlib import Path

from . import pl
from .blob import CandidateLookup
from .plugin import LanguagePlugin
from .schema import ExpressionDef

PLUGINS: dict[str, LanguagePlugin] = {pl.LANG: pl}

EXPRESSIONS_HELP = """\
expressions file:
  A JSON list of multi-word expressions to find, each given as a sequence of lemmas
  (dictionary forms), so every inflected form matches:

    [{"id": "pl:dać sobie radę", "lemmas": ["dać", "siebie", "rada"]}]

  Use the lemmas the analyser outputs (siebie, not sobie). Matches are contiguous only.
  Each match is reported per sentence as {"from": <token>, "to": <token>, "id": <id>}.
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="skolia-analyze",
        description="Read text on stdin, write the analysis blob as JSON to stdout.",
        epilog=EXPRESSIONS_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--lang", choices=sorted(PLUGINS), default=pl.LANG, help="language of the input text"
    )
    parser.add_argument(
        "--expressions", type=Path, help="JSON file of expressions to match (format below)"
    )
    parser.add_argument(
        "--no-candidates",
        action="store_true",
        help="don't list alternative readings; tokens only get the reading the parser chose",
    )
    parser.add_argument("--indent", type=int, help="pretty-print the JSON with this indent")
    args = parser.parse_args()

    plugin = PLUGINS[args.lang]
    expressions: list[ExpressionDef] = (
        json.loads(args.expressions.read_text()) if args.expressions else []
    )
    candidates: CandidateLookup | None = None if args.no_candidates else plugin.candidate_lookup()

    blob = plugin.analyze(sys.stdin.read(), plugin.pipeline(), candidates, expressions)
    json.dump(blob, sys.stdout, ensure_ascii=False, indent=args.indent)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
