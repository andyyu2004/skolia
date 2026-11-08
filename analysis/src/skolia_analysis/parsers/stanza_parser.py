"""Stanza backend: https://stanfordnlp.github.io/stanza/"""

from __future__ import annotations

from importlib.metadata import version
from typing import TYPE_CHECKING

from .. import ud
from ..parsed import ParsedSentence, ParsedToken, ParsedWord

if TYPE_CHECKING:
    from stanza.models.common.doc import Document, Token, Word

# tokenize: split into sentences and tokens; mwt: split fused words (zrobiłem -> zrobił + em);
# pos: UPOS + XPOS + features; lemma: dictionary form; depparse: head + deprel
PROCESSORS = "tokenize,mwt,pos,lemma,depparse"

# Stanza numbers words in a sentence from 1 and uses head 0 for the root
ROOT_HEAD = 0
# What Stanza puts for the text and lemma of a token it won't read, e.g. a long URL
UNKNOWN = "<UNK>"


class StanzaParser:
    """package picks a model set from Stanza's resources.json, e.g. "default",
    "default_accurate" (transformer-based) or "lfg" (trained on another treebank).
    batch_words: how many words the tagger and the parser take at once; None for Stanza's
    5000, which puts a whole 20,000-character text through a transformer in one batch."""

    def __init__(self, lang: str, package: str, batch_words: int | None = None) -> None:
        import stanza

        self._package = package
        batches = (
            {}
            if batch_words is None
            else {"pos_batch_size": batch_words, "depparse_batch_size": batch_words}
        )
        # Models already in STANZA_RESOURCES_DIR (the image has them) are used as they
        # are: by default Stanza fetches resources.json from GitHub on every start
        self._nlp = stanza.Pipeline(
            lang,
            package=package,
            processors=PROCESSORS,
            logging_level="WARN",
            download_method=stanza.DownloadMethod.REUSE_RESOURCES,
            **batches,
        )

    @property
    def name(self) -> str:
        return f"stanza-{version('stanza')}:{self._package}"

    def __call__(self, text: str) -> list[ParsedSentence]:
        return convert(self._nlp(text))


def convert_word(word: Word, surface: str | None = None) -> ParsedWord:
    """surface: the source text of a one-word token, which Stanza's word text can lack
    (UNKNOWN for a very long token, such as a URL)."""
    return ParsedWord(
        text=surface if surface is not None else word.text,
        lemma=None if word.lemma == UNKNOWN else word.lemma,
        upos=ud.parse_upos(word.upos),
        xpos=word.xpos,
        feats=ud.parse_feats(word.feats),
        head=None if word.head in (None, ROOT_HEAD) else word.head - 1,
        deprel=ud.parse_deprel(word.deprel),
    )


def convert(doc: Document) -> list[ParsedSentence]:
    return [
        ParsedSentence(tuple(convert_token(doc.text, tok) for tok in sent.tokens))
        for sent in doc.sentences
    ]


def convert_token(text: str, tok: Token) -> ParsedToken:
    surface = text[tok.start_char : tok.end_char]
    if len(tok.words) == 1:
        words = (convert_word(tok.words[0], surface),)
    else:
        words = tuple(convert_word(w) for w in tok.words)
    return ParsedToken(text=surface, start=tok.start_char, end=tok.end_char, words=words)
