"""COMBO backend (IPI PAN / CLARIN-PL): https://gitlab.clarin-pl.eu/syntactic-tools/combo

An XLM-RoBERTa-based tagger and parser with its own segmenter (combo-seg). Code GPL-3.0,
models CC BY-NC-SA 4.0 (trained on PDB).
"""

from __future__ import annotations

import contextlib
import sys
from importlib.metadata import version
from typing import TYPE_CHECKING, NotRequired, TypedDict, cast

from .. import ud
from ..parsed import ParsedSentence, ParsedToken, ParsedWord, align

if TYPE_CHECKING:
    from combo import COMBO


class _Multiword(TypedDict):
    form: str
    start: int
    """1-based id of the first word of the fused token."""
    end: int


class _Word(TypedDict):
    id: str
    form: str
    lemma: str | None
    upos: str | None
    xpos: str | None
    feats: dict[str, str] | None
    head: int | None
    deprel: str | None
    multiword: NotRequired[_Multiword | None]
    """Only on words that are part of a fused token."""


class _Sentence(TypedDict):
    text: str
    tokens: list[_Word]


class _Document(TypedDict):
    sentences: list[_Sentence]


ROOT_HEAD = 0

# The lemmatizer crashes with larger batches (tensor size mismatch in combo 4.0.14)
BATCH_SIZE = 1


class ComboParser:
    def __init__(self, model: str, device: str = "cpu") -> None:
        from combo import COMBO

        self._model = model
        # COMBO prints progress to stdout, which would corrupt the analyser's output
        with contextlib.redirect_stdout(sys.stderr):
            self._nlp: COMBO = COMBO.from_pretrained(model, device=device, batch_size=BATCH_SIZE)

    @property
    def name(self) -> str:
        return f"combo-{version('combo-nlp')}:{self._model.split('/')[-1]}"

    def __call__(self, text: str) -> list[ParsedSentence]:
        # to_dict() is plain JSON-like data; its shape is declared by _Document above
        with contextlib.redirect_stdout(sys.stderr):
            doc = cast(_Document, self._nlp(text).to_dict())
        sentences: list[ParsedSentence] = []
        cursor = 0
        for sentence in doc["sentences"]:
            groups = _group(sentence["tokens"])
            surfaces = [surface for surface, _ in groups]
            offsets = list(align(text, surfaces, cursor))
            if offsets:
                cursor = offsets[-1][1]
            tokens = tuple(
                ParsedToken(surface, start, end, tuple(_word(w) for w in words))
                for (surface, words), (start, end) in zip(groups, offsets, strict=True)
            )
            sentences.append(ParsedSentence(tokens))
        return sentences


def _group(words: list[_Word]) -> list[tuple[str, list[_Word]]]:
    """Words back into surface tokens: a fused token's words share its multiword span."""
    groups: list[tuple[str, list[_Word]]] = []
    index = 0
    while index < len(words):
        multiword = words[index].get("multiword")
        if multiword is None:
            groups.append((words[index]["form"], [words[index]]))
            index += 1
        else:
            span = multiword["end"] - multiword["start"] + 1
            groups.append((multiword["form"], words[index : index + span]))
            index += span
    return groups


def _word(word: _Word) -> ParsedWord:
    head = word["head"]
    return ParsedWord(
        text=word["form"],
        lemma=word["lemma"],
        upos=ud.parse_upos(word["upos"]),
        xpos=word["xpos"],
        feats=ud.check_feats(word["feats"]),
        head=None if head in (None, ROOT_HEAD) else head - 1,
        deprel=ud.parse_deprel(word["deprel"]),
    )
