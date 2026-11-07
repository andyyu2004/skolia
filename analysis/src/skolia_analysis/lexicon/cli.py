import argparse
import json
import sys
from pathlib import Path
from typing import cast

from .. import lang
from ..plugin import lexicon_path
from ..schema import Blob
from . import build, cards
from .store import Lexicon


def build_main() -> None:
    parser = argparse.ArgumentParser(
        prog="skolia-build-lexicon",
        description="Build a language's lexicon SQLite file from Kaikki's Wiktionary extract.",
    )
    parser.add_argument("lang", choices=lang.LANGS)
    parser.add_argument("kaikki", type=Path, help="e.g. kaikki.org-dictionary-Polish.jsonl")
    parser.add_argument("out", type=Path, help="output .sqlite file (replaced)")
    args = parser.parse_args()
    source = lang.plugin(args.lang).lexicon_source()
    count, stats = build.build(args.lang, source, args.kaikki, args.out)
    print(
        f"{count} lemma entries from {stats.entries} Kaikki entries "
        f"({stats.skipped} skipped: inflected forms, phrases, affixes); "
        f"{stats.pronounced} (word, part of speech) pairs with a pronunciation",
        file=sys.stderr,
    )


def cards_main() -> None:
    parser = argparse.ArgumentParser(
        prog="skolia-build-cards",
        description="Build the lexicon review cards read (infra/load-lexicon.py loads it): "
        "each entry with its lemma's pronunciations and compact paradigms.",
    )
    parser.add_argument("lang", choices=lang.LANGS)
    parser.add_argument("lexicon", type=Path, help="{lang}.sqlite from skolia-build-lexicon")
    parser.add_argument("out", type=Path, help="output .sqlite file (replaced)")
    args = parser.parse_args()
    count = cards.build(Lexicon(args.lexicon), lang.plugin(args.lang).paradigms(), args.out)
    print(f"{count} entries", file=sys.stderr)


def bundle_main() -> None:
    parser = argparse.ArgumentParser(
        prog="skolia-bundle",
        description="Read an analysis blob on stdin, write the document's lexicon bundle.",
    )
    parser.add_argument(
        "--data",
        type=Path,
        required=True,
        help="the language's data directory: {lang}.sqlite and the plugin's files",
    )
    parser.add_argument("--indent", type=int, default=None)
    args = parser.parse_args()
    blob = cast(Blob, json.load(sys.stdin))
    data: Path = args.data
    lexicon = Lexicon(lexicon_path(data, blob["lang"]))
    result = lang.plugin(blob["lang"]).bundler(lexicon, data)(blob)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=args.indent)
    sys.stdout.write("\n")
