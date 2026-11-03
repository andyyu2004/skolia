"""Is the hand-annotated reading of each word among the candidates our lookup returns?

Runs MorfeuszCandidates over a UD treebank (CoNLL-U) and compares every word's gold
(lemma, upos, feats) with the candidate list. Punctuation and symbols are skipped because
the blob never lists candidates for them.

usage: uv run python scripts/eval_candidates.py treebank.conllu [...] [--show N]
"""

import argparse
from collections import Counter
from collections.abc import Iterator, Mapping
from pathlib import Path

from conllu import GoldWord, read

from skolia_analysis.pl import MorfeuszCandidates
from skolia_analysis.schema import Candidate

SKIPPED_UPOS = {"PUNCT", "SYM"}


def surface_tokens(words: list[GoldWord]) -> Iterator[tuple[str, list[GoldWord]]]:
    """Group words back into the tokens they were written as (zrobił + em -> zrobiłem)."""
    group: list[GoldWord] = []
    for word in words:
        if group and word.part_index == 0:
            yield group[0].fused_form or group[0].form, group
            group = []
        group.append(word)
    if group:
        yield group[0].fused_form or group[0].form, group


def feats_diff(gold: Mapping[str, object], ours: Mapping[str, object]) -> str:
    missing = sorted(f"-{k}={v}" for k, v in gold.items() if ours.get(k) != v)
    extra = sorted(f"+{k}={v}" for k, v in ours.items() if gold.get(k) != v)
    return " ".join(missing + extra)


def closest(word: GoldWord, candidates: list[Candidate]) -> Candidate:
    def distance(c: Candidate) -> tuple[bool, bool, int]:
        feats = dict(c["feats"].items())
        return (
            c["lemma"] != word.lemma,
            c["upos"] != word.upos,
            len(feats_diff(word.feats, feats)),
        )

    return min(candidates, key=distance)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("treebanks", nargs="+", type=Path)
    parser.add_argument("--show", type=int, default=40, help="how many mismatch patterns to list")
    args = parser.parse_args()

    lookup = MorfeuszCandidates()
    total = exact = no_candidates = lemma_found = 0
    patterns: Counter[str] = Counter()
    examples: dict[str, str] = {}
    for path in args.treebanks:
        for sentence in read(path):
            for token, words in surface_tokens(sentence.words):
                readings = lookup(token, [w.form for w in words])
                for word, candidates in zip(words, readings, strict=True):
                    if word.upos in SKIPPED_UPOS:
                        continue
                    total += 1
                    gold = (word.lemma, word.upos, word.feats)
                    if any(
                        (c["lemma"], c["upos"], dict(c["feats"].items())) == gold
                        for c in candidates
                    ):
                        exact += 1
                        continue
                    if not candidates:
                        no_candidates += 1
                        pattern = f"{word.xpos.split(':')[0]:8} no candidates"
                    else:
                        lemma_found += any(c["lemma"] == word.lemma for c in candidates)
                        best = closest(word, candidates)
                        notes: list[str] = []
                        if best["lemma"] != word.lemma:
                            notes.append("LEMMA")
                        if best["upos"] != word.upos:
                            notes.append(f"UPOS {best['upos']}->{word.upos}")
                        notes.append(feats_diff(word.feats, dict(best["feats"].items())))
                        pattern = f"{word.xpos.split(':')[0]:8} {' '.join(n for n in notes if n)}"
                    patterns[pattern] += 1
                    examples.setdefault(pattern, f"{word.form} ({word.lemma})")

    print(f"gold reading among candidates: {exact}/{total} = {exact / total:.1%}")
    print(f"no candidates at all: {no_candidates} = {no_candidates / total:.1%}")
    print(f"misses where the gold lemma is among the candidates: {lemma_found}")
    print("\nmiss patterns (- gold has it, + we have it instead), with one example:")
    for pattern, n in patterns.most_common(args.show):
        print(f"{n:6}  {pattern}   e.g. {examples[pattern]}")


if __name__ == "__main__":
    main()
