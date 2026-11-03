"""Minimal CoNLL-U reader for evaluation scripts.

CoNLL-U is the plain-text format UD treebanks are published in: one word per line, 10
tab-separated columns (id, form, lemma, upos, xpos, feats, head, deprel, deps, misc).
Lines with a range id like "3-4" are multi-word tokens: the surface form that the
following words were split from (zrobiłem -> zrobił + em).
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class GoldWord:
    form: str
    lemma: str
    upos: str
    xpos: str
    feats: dict[str, str]
    head: int
    deprel: str
    fused_form: str | None
    """The surface multi-word token this word was split from, if any."""
    part_index: int
    """Position within the fused token (0 for unfused words)."""


@dataclass
class GoldSentence:
    sent_id: str
    text: str
    words: list[GoldWord] = field(default_factory=lambda: [])


def parse_feats(raw: str) -> dict[str, str]:
    if raw == "_":
        return {}
    return dict(pair.split("=", 1) for pair in raw.split("|"))


def read(path: Path) -> Iterator[GoldSentence]:
    sentence = GoldSentence("", "")
    fused: tuple[int, int, str] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# sent_id = "):
            sentence.sent_id = line.removeprefix("# sent_id = ")
        elif line.startswith("# text = "):
            sentence.text = line.removeprefix("# text = ")
        elif not line:
            if sentence.words:
                yield sentence
            sentence = GoldSentence("", "")
        elif not line.startswith("#"):
            cols = line.split("\t")
            word_id = cols[0]
            if "-" in word_id:
                first, last = (int(n) for n in word_id.split("-"))
                fused = (first, last, cols[1])
                continue
            if "." in word_id:
                continue
            number = int(word_id)
            in_fused = fused is not None and fused[0] <= number <= fused[1]
            sentence.words.append(
                GoldWord(
                    form=cols[1],
                    lemma=cols[2],
                    upos=cols[3],
                    xpos=cols[4],
                    feats=parse_feats(cols[5]),
                    head=int(cols[6]),
                    deprel=cols[7],
                    fused_form=fused[2] if fused and in_fused else None,
                    part_index=number - fused[0] if fused and in_fused else 0,
                )
            )
    if sentence.words:
        yield sentence
