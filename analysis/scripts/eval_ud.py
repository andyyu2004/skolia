"""Score the analyser against a hand-annotated UD treebank with the official CoNLL 2018
evaluation script (scripts/vendor/conll18_ud_eval.py).

The raw text of every gold sentence goes through the analyser (one sentence per paragraph),
so tokenization, sentence splitting, tagging, lemmas and parsing are all scored. The parse
runs once; each --snap policy is then scored on the same parse.

Metrics are F1 over aligned words: UPOS, XPOS, UFeats (universal features), AllTags (all
three right), Lemmas, UAS (right head), LAS (right head and relation), MLAS/BLEX (LAS that
also requires features/lemma right on content words).

usage: uv run python scripts/eval_ud.py gold.conllu [--model stanza] [--snap none lemma ...]
"""

import argparse
import hashlib
import pickle
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import cast

from skolia_analysis import conllu, pl, reconcile
from skolia_analysis.parsed import ParsedSentence, Parser
from skolia_analysis.schema import Blob
from skolia_analysis.valency import Valency

EVALUATOR = Path(__file__).parent / "vendor" / "conll18_ud_eval.py"
METRICS = [
    *("Tokens", "Sentences", "Words"),
    *("UPOS", "XPOS", "UFeats", "AllTags", "Lemmas"),
    *("UAS", "LAS", "MLAS", "BLEX"),
]
NO_SNAP = "none"


def gold_text(gold: Path) -> str:
    prefix = "# text = "
    lines = gold.read_text(encoding="utf-8").splitlines()
    return "\n\n".join(line.removeprefix(prefix) for line in lines if line.startswith(prefix))


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


class CachedParser:
    """Keeps a parser's output on disk, keyed by model and input text, so comparing snap
    policies doesn't re-run slow models."""

    def __init__(self, model: str, cache: Path) -> None:
        self._model = model
        self._cache = cache
        self._parser: Parser | None = None

    def _load(self) -> Parser:
        if self._parser is None:
            self._parser = pl.parser(self._model)
        return self._parser

    @property
    def name(self) -> str:
        return self._load().name

    def __call__(self, text: str) -> list[ParsedSentence]:
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
        path = self._cache / f"{self._model}-{digest}.pickle"
        if path.exists():
            with path.open("rb") as f:
                return cast(list[ParsedSentence], pickle.load(f))
        parsed = self._load()(text)
        self._cache.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as f:
            pickle.dump(parsed, f)
        return parsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("gold", type=Path)
    parser.add_argument("--model", default=pl.DEFAULT_MODEL, choices=list(pl.MODELS))
    parser.add_argument("--cache", type=Path, help="reuse parser output stored here")
    parser.add_argument(
        "--snap", nargs="+", default=[NO_SNAP], choices=[NO_SNAP, *reconcile.POLICIES]
    )
    parser.add_argument("--limit", type=int, help="only the first N sentences")
    parser.add_argument("--out", type=Path, help="keep the system CoNLL-U files here")
    parser.add_argument(
        "--valency", type=Path, help="also score with case correction from this frames file"
    )
    args = parser.parse_args()

    gold: Path = args.gold
    text = gold_text(gold)
    if args.limit:
        text = "\n\n".join(text.split("\n\n")[: args.limit])
        trimmed = "\n\n".join(gold.read_text(encoding="utf-8").split("\n\n")[: args.limit])
        with tempfile.NamedTemporaryFile("w", suffix=".conllu", delete=False) as gold_file:
            gold_file.write(trimmed + "\n\n")
        gold = Path(gold_file.name)

    model: Parser = CachedParser(args.model, args.cache) if args.cache else pl.parser(args.model)
    lookup = pl.candidate_lookup()
    started = time.perf_counter()
    parsed = model(text)
    seconds = time.perf_counter() - started
    print(f"{args.model}: parsed {len(parsed)} sentences in {seconds:.0f} s", file=sys.stderr)

    out: Path = args.out or Path(tempfile.mkdtemp())
    out.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, dict[str, float]]] = []
    walenty = Valency.load(args.valency) if args.valency else None
    for snap in args.snap:
        policy = None if snap == NO_SNAP else snap
        blob = pl.assemble(text, parsed, model.name, lookup, snap=policy)
        system = out / f"{args.model}-snap-{snap}.conllu"
        system.write_text(conllu.write(blob, text), encoding="utf-8")
        rows.append((snap, evaluate(gold, system)))
        if walenty is None:
            continue
        for mode in ("lexical", "all"):
            corrected = pl.assemble(
                text, parsed, model.name, lookup, snap=policy, valency=walenty, correct_cases=mode
            )
            system = out / f"{args.model}-snap-{snap}-cases-{mode}.conllu"
            system.write_text(conllu.write(corrected, text), encoding="utf-8")
            rows.append((f"{snap}+{mode}", evaluate(gold, system)))
            print(f"case correction {mode}:", file=sys.stderr)
            report_case_changes(gold, text, blob, corrected)

    print(f"model {model.name}, gold {args.gold.name}, F1 %")
    print(f"{'snap':12}" + "".join(f"{m:>9}" for m in METRICS))
    for snap, scores in rows:
        print(f"{snap:12}" + "".join(f"{scores.get(m, float('nan')):9.2f}" for m in METRICS))
    if args.out:
        print(f"system files in {out}")


if __name__ == "__main__":
    main()
