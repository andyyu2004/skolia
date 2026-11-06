"""How many words with a case get a case reason, by rule, plus a sample to read.

usage: uv run python scripts/pl/eval_case_reasons.py gold.conllu --cache DIR --valency FILE

Runs the analyser (default model, snap) on the treebank's text, reusing eval_ud.py's
parse cache. Only says which rule fired, not whether it is right: read the sample.
"""

import argparse
import random
from collections import Counter
from pathlib import Path

from skolia_analysis.lang.pl import plugin as pl
from skolia_analysis.lang.pl.valency import Valency
from skolia_analysis.schema import Token
from skolia_analysis.treebank import CachedParser, gold_text

SAMPLE = 40
SEED = 1
TOP_UNEXPLAINED = 20


def describe(token: Token, tokens: list[Token]) -> str:
    reason = token.get("case_reason")
    if reason is None:
        return "-"
    trigger = reason.get("trigger")
    by = f" ← {tokens[trigger]['text']}" if trigger is not None else ""
    governor = reason.get("governor")
    return f"{reason['rule']}{by}" + (f" ({governor})" if governor else "")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("gold", type=Path)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--valency", type=Path)
    args = parser.parse_args()

    text = gold_text(args.gold)
    model = CachedParser(pl.LANG, pl.DEFAULT_MODEL, lambda: pl.parser(pl.DEFAULT_MODEL), args.cache)
    valency = Valency.load(args.valency) if args.valency else None
    blob = pl.assemble(text, model(text), model.name, pl.candidate_lookup(), valency=valency)

    by_rule: Counter[str] = Counter()
    unexplained: Counter[tuple[str, str, str]] = Counter()
    explained: list[tuple[str, Token, list[Token]]] = []
    total = 0
    for sentence in blob["sentences"]:
        tokens = sentence["tokens"]
        sentence_text = text[sentence["start"] : sentence["end"]]
        for token in tokens:
            case = token["feats"].get("Case")
            if case is None:
                continue
            total += 1
            reason = token.get("case_reason")
            if reason is None:
                unexplained[(str(token["deprel"]), case, token["upos"])] += 1
            else:
                by_rule[reason["rule"]] += 1
                explained.append((sentence_text, token, tokens))

    covered = sum(by_rule.values())
    print(f"words with a case: {total}; with a reason: {covered} ({100 * covered / total:.1f}%)")
    for rule, count in by_rule.most_common():
        print(f"  {rule:13} {count:6} ({100 * count / total:5.1f}%)")
    print("\nmost common without a reason (deprel, case, upos):")
    for (deprel, case, upos), count in unexplained.most_common(TOP_UNEXPLAINED):
        print(f"  {deprel:12} {case:4} {upos:6} {count}")
    print(f"\n{SAMPLE} random reasons:")
    for sentence_text, token, tokens in random.Random(SEED).sample(explained, SAMPLE):
        case = token["feats"].get("Case")
        print(f"  {token['text']:16} {case}  {describe(token, tokens):40} | {sentence_text[:90]}")


if __name__ == "__main__":
    main()
