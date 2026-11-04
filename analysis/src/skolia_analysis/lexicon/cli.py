import argparse
import json
import sys
from pathlib import Path
from typing import cast

from ..schema import Blob
from ..valency import Valency
from . import build, bundle
from . import pl as lexicon_pl
from .store import Lexicon


def build_main() -> None:
    parser = argparse.ArgumentParser(
        prog="skolia-build-lexicon",
        description="Build the Polish lexicon SQLite file from Kaikki's Wiktionary extract.",
    )
    parser.add_argument("kaikki", type=Path, help="kaikki.org-dictionary-Polish.jsonl")
    parser.add_argument("out", type=Path, help="output .sqlite file (replaced)")
    args = parser.parse_args()
    count, stats = build.build(args.kaikki, args.out)
    print(
        f"{count} lemma entries from {stats.entries} Kaikki entries "
        f"({stats.skipped} skipped: inflected forms, phrases, affixes)",
        file=sys.stderr,
    )


def bundle_main() -> None:
    parser = argparse.ArgumentParser(
        prog="skolia-bundle",
        description="Read an analysis blob on stdin, write the document's lexicon bundle.",
    )
    parser.add_argument("--lexicon", type=Path, required=True, help="lexicon .sqlite file")
    parser.add_argument("--valency", type=Path, help="Walenty frames .json (skolia-build-valency)")
    parser.add_argument("--indent", type=int, default=None)
    args = parser.parse_args()
    blob = cast(Blob, json.load(sys.stdin))
    converter = lexicon_pl.Converter()
    frames = Valency.load(args.valency).frames if args.valency else bundle.no_frames
    result = bundle.make(blob, Lexicon(args.lexicon), converter.paradigms, frames)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=args.indent)
    sys.stdout.write("\n")
