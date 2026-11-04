"""How many analysed tokens get a meaning from the lexicon, and how.

usage: uv run python scripts/eval_lexicon.py LEXICON.sqlite BLOB.json [BLOB.json ...]

Counts word tokens (not punctuation, symbols or X) by how bundle.resolve found their
entry, and lists the most frequent lemma_ids with no senses.
"""

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import cast

from skolia_analysis.lexicon.bundle import resolve
from skolia_analysis.lexicon.schema import Match
from skolia_analysis.lexicon.store import Lexicon
from skolia_analysis.schema import Blob, Upos

NOT_WORDS: set[Upos] = {"PUNCT", "SYM", "X"}
MATCHES: tuple[Match, ...] = ("exact", "other-pos", "lowercase", "none")
SHOW_MISSES = 40


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("lexicon", type=Path)
    parser.add_argument("blobs", type=Path, nargs="+")
    args = parser.parse_args()
    lexicon = Lexicon(args.lexicon)
    for path in cast(list[Path], args.blobs):
        blob = cast(Blob, json.loads(path.read_text(encoding="utf-8")))
        tokens = [t for s in blob["sentences"] for t in s["tokens"] if t["upos"] not in NOT_WORDS]
        by_match: Counter[Match] = Counter()
        misses: Counter[str] = Counter()
        cache: dict[str, Match] = {}
        for token in tokens:
            token_id = token["lemma_id"]
            if token_id is None:
                by_match["none"] += 1
                continue
            if token_id not in cache:
                cache[token_id] = resolve(lexicon, token_id)[1]
            match = cache[token_id]
            by_match[match] += 1
            if match == "none":
                misses[token_id] += 1
        total = len(tokens)
        print(f"\n== {path.name}: {total} word tokens")
        for match in MATCHES:
            print(f"  {match:10} {by_match[match]:6} ({100 * by_match[match] / total:5.1f}%)")
        shown = ", ".join(f"{i} ({n})" for i, n in misses.most_common(SHOW_MISSES))
        print(f"  no senses: {shown}")


if __name__ == "__main__":
    main()
