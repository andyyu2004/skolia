"""What the valency case correction changes, counted against the gold case.

usage: uv run python scripts/pl/eval_case_correction.py gold.conllu --valency FILE [--cache DIR]

Assembles the same parse with Walenty twice, without and with the correction. The F1 with
it: scripts/eval_ud.py --lang pl --data DIR.
"""

import argparse
import sys
from pathlib import Path

from skolia_analysis import conllu
from skolia_analysis.lang.pl import plugin as pl
from skolia_analysis.lang.pl.valency import Valency
from skolia_analysis.parsed import Parser
from skolia_analysis.schema import Blob
from skolia_analysis.treebank import CachedParser, gold_text

SHOW_CHANGES = 25


def report_case_changes(gold: Path, text: str, before: Blob, after: Blob) -> None:
    """Words whose Case the valency correction changed, scored against the gold Case.
    Only sentences the analyser tokenized like the gold (same word forms) are compared."""
    gold_by_text = {s.text: s for s in conllu.read(gold)}
    fixed = broken = still_wrong = unmatched = 0
    examples: list[str] = []
    for old_sentence, new_sentence in zip(before["sentences"], after["sentences"], strict=True):
        pairs = list(zip(old_sentence["tokens"], new_sentence["tokens"], strict=True))
        changed = [
            (i, old, new)
            for i, (old, new) in enumerate(pairs)
            if old["feats"].get("Case") != new["feats"].get("Case")
        ]
        if not changed:
            continue
        reference = gold_by_text.get(text[old_sentence["start"] : old_sentence["end"]])
        forms = [t["text"] for t in old_sentence["tokens"]]
        if reference is None or [w.form for w in reference.words] != forms:
            unmatched += len(changed)
            continue
        for i, old, new in changed:
            truth = reference.words[i].feats.get("Case")
            if new["feats"].get("Case") == truth:
                fixed += 1
                verdict = "fixed"
            elif old["feats"].get("Case") == truth:
                broken += 1
                verdict = "BROKEN"
            else:
                still_wrong += 1
                verdict = "still wrong"
            if len(examples) < SHOW_CHANGES:
                head = new["head"]
                verb = new_sentence["tokens"][head]["text"] if head is not None else "-"
                examples.append(
                    f"    {verdict:11} {new['text']:14} {old['feats'].get('Case')} -> "
                    f"{new['feats'].get('Case')} (gold {truth}), governed by {verb}"
                )
    print(
        f"valency case changes: {fixed} fixed, {broken} broken, {still_wrong} changed but "
        f"still wrong, {unmatched} in sentences tokenized differently from the gold",
        file=sys.stderr,
    )
    print("\n".join(examples), file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("gold", type=Path)
    parser.add_argument("--valency", type=Path, required=True)
    parser.add_argument("--model", default=pl.DEFAULT_MODEL, choices=list(pl.MODELS))
    parser.add_argument("--cache", type=Path, help="reuse parser output stored here")
    args = parser.parse_args()

    text = gold_text(args.gold)
    model_name: str = args.model
    model: Parser = (
        CachedParser(pl.LANG, model_name, lambda: pl.parser(model_name), args.cache)
        if args.cache
        else pl.parser(model_name)
    )
    parsed = model(text)
    lookup = pl.candidate_lookup()
    walenty = Valency.load(args.valency)
    plain = pl.assemble(text, parsed, model.name, lookup, valency=walenty, correct_cases=False)
    corrected = pl.assemble(text, parsed, model.name, lookup, valency=walenty)
    report_case_changes(args.gold, text, plain, corrected)


if __name__ == "__main__":
    main()
