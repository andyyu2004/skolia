"""On real text, is the reading the parser picked among the dictionary's candidates?

Tokens where it isn't are the interesting ones: either the parser is wrong, the dictionary
is missing a reading, or the two follow different conventions. Also runs the full blob
build, so any parser label outside schema.py fails loudly here.

Input is plain text, or a CoNLL-U file (its "# text =" lines are used).

usage: uv run python scripts/eval_parser_in_candidates.py input.txt|input.conllu [--limit N]
"""

import argparse
from collections import Counter
from collections.abc import Iterator
from pathlib import Path

from skolia_analysis import pl
from skolia_analysis.schema import Feats

# Depends on the sentence (heads of multi-word units), never in a dictionary
CONTEXTUAL_FEATS = {"ExtPos"}


def sentences(path: Path) -> Iterator[str]:
    prefix = "# text = "
    lines = path.read_text(encoding="utf-8").splitlines()
    if path.suffix == ".conllu":
        yield from (line.removeprefix(prefix) for line in lines if line.startswith(prefix))
    else:
        yield from (line for line in lines if line.strip())


def comparable(feats: Feats) -> frozenset[tuple[str, object]]:
    return frozenset((k, v) for k, v in feats.items() if k not in CONTEXTUAL_FEATS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--limit", type=int, help="only the first N sentences")
    parser.add_argument("--show", type=int, default=30)
    args = parser.parse_args()

    texts = list(sentences(args.input))[: args.limit]
    model = pl.parser()
    lookup = pl.MorfeuszCandidates()
    blob = pl.analyze("\n".join(texts), model, lookup, snap=None)

    total = found = without = 0
    patterns: Counter[str] = Counter()
    examples: dict[str, str] = {}
    for sentence in blob["sentences"]:
        for token in sentence["tokens"]:
            if token["upos"] in ("PUNCT", "SYM"):
                continue
            words = [token["text"]] if "mwt" not in token else None
            readings = token.get("candidates")
            if readings is None:
                # the blob omits single readings, so look the word up again
                surface = token.get("mwt", token["text"])
                parts = [t["text"] for t in sentence["tokens"] if t.get("mwt") == surface]
                index = parts.index(token["text"]) if words is None else 0
                readings = lookup(surface, parts if words is None else words)[index]
            total += 1
            if not readings:
                without += 1
                continue
            picked = (token["lemma"], token["upos"], comparable(token["feats"]))
            if any((r["lemma"], r["upos"], comparable(r["feats"])) == picked for r in readings):
                found += 1
                continue
            same_lemma = [r for r in readings if r["lemma"] == token["lemma"]]
            if not same_lemma:
                pattern = f"{token['upos']:5} lemma {token['lemma']!r} not in dictionary"
            else:
                upos_match = [r for r in same_lemma if r["upos"] == token["upos"]]
                if not upos_match:
                    pattern = f"{token['upos']:5} UPOS: dictionary has {same_lemma[0]['upos']}"
                else:
                    ours = comparable(token["feats"])
                    best = min(upos_match, key=lambda r: len(ours ^ comparable(r["feats"])))
                    theirs = comparable(best["feats"])
                    diff = sorted(f"+{k}={v}" for k, v in ours - theirs)
                    diff += sorted(f"-{k}={v}" for k, v in theirs - ours)
                    pattern = f"{token['upos']:5} {' '.join(diff)}"
            patterns[pattern] += 1
            examples.setdefault(pattern, f"{token['text']} ({token['lemma']})")

    print(f"sentences: {len(blob['sentences'])}, words checked: {total}")
    print(f"no dictionary readings: {without} = {without / total:.1%}")
    known = total - without
    print(f"parser's reading among candidates: {found}/{known} = {found / known:.1%}")
    print("\nwhere it isn't (+ parser has it, - closest dictionary reading has it):")
    for pattern, n in patterns.most_common(args.show):
        print(f"{n:6}  {pattern}   e.g. {examples[pattern]}")


if __name__ == "__main__":
    main()
