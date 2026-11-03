"""Stanza backend: https://stanfordnlp.github.io/stanza/"""

from __future__ import annotations

from importlib.metadata import version
from typing import TYPE_CHECKING

from .. import ud
from ..parsed import ParsedSentence, ParsedToken, ParsedWord

if TYPE_CHECKING:
    from stanza.models.common.doc import Document, Word

# tokenize: split into sentences and tokens; mwt: split fused words (zrobiłem -> zrobił + em);
# pos: UPOS + XPOS + features; lemma: dictionary form; depparse: head + deprel
PROCESSORS = "tokenize,mwt,pos,lemma,depparse"

# Stanza numbers words in a sentence from 1 and uses head 0 for the root
ROOT_HEAD = 0


class StanzaParser:
    """package picks a model set from Stanza's resources.json, e.g. "default",
    "default_accurate" (transformer-based) or "lfg" (trained on another treebank)."""

    def __init__(self, lang: str, package: str) -> None:
        import stanza

        self._package = package
        self._nlp = stanza.Pipeline(
            lang, package=package, processors=PROCESSORS, logging_level="WARN"
        )

    @property
    def name(self) -> str:
        return f"stanza-{version('stanza')}:{self._package}"

    def __call__(self, text: str) -> list[ParsedSentence]:
        return convert(self._nlp(text))


def convert_word(word: Word) -> ParsedWord:
    return ParsedWord(
        text=word.text,
        lemma=word.lemma,
        upos=ud.parse_upos(word.upos),
        xpos=word.xpos,
        feats=ud.parse_feats(word.feats),
        head=None if word.head in (None, ROOT_HEAD) else word.head - 1,
        deprel=ud.parse_deprel(word.deprel),
    )


def convert(doc: Document) -> list[ParsedSentence]:
    return [
        ParsedSentence(
            tuple(
                ParsedToken(
                    text=tok.text,
                    start=tok.start_char,
                    end=tok.end_char,
                    words=tuple(convert_word(w) for w in tok.words),
                )
                for tok in sent.tokens
            )
        )
        for sent in doc.sentences
    ]
