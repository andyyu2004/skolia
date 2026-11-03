"""Build the analysis blob from a parsed Stanza document. Language-neutral: anything
language-specific comes in through the CandidateLookup and the expression gap predicate."""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Iterator, Sequence
from typing import TYPE_CHECKING, Protocol

from . import ud
from .schema import Blob, Candidate, ExpressionDef, ExpressionMatch, Sentence, Token, Upos

if TYPE_CHECKING:
    from stanza.models.common.doc import Document, Word
    from stanza.models.common.doc import Token as StanzaToken

SCHEMA = 1

NO_LEMMA_ID: set[Upos] = {"PUNCT", "SYM"}

# Stanza numbers words in a sentence from 1 and uses head 0 for the root
STANZA_ROOT_HEAD = 0


class CandidateLookup(Protocol):
    def __call__(self, token: str, words: Sequence[str]) -> list[list[Candidate]]:
        """All readings for each word of one surface token.

        words is how the parser split the token: one word normally, several for a fused
        word (zrobiłem -> zrobił, em). Returns one list of readings per word.
        """
        ...


type ExpressionGap = Callable[[Token], bool]
"""True for tokens expression matching should step over, e.g. the -em of dałem."""


def no_gaps(_token: Token) -> bool:
    return False


def lemma_id(lang: str, lemma: str | None, upos: Upos) -> str | None:
    if not lemma or upos in NO_LEMMA_ID:
        return None
    return f"{lang}:{lemma}:{upos}"


def find_expressions(
    lemmas: Sequence[str | None],
    expressions: Iterable[ExpressionDef],
    gaps: Sequence[bool] | None = None,
) -> Iterator[ExpressionMatch]:
    kept = [
        (index, (lemma or "").lower())
        for index, lemma in enumerate(lemmas)
        if not (gaps and gaps[index])
    ]
    kept_lemmas = [lemma for _, lemma in kept]
    for expr in expressions:
        seq = [lemma.lower() for lemma in expr["lemmas"]]
        n = len(seq)
        for i in range(len(kept) - n + 1):
            if kept_lemmas[i : i + n] == seq:
                yield {"from": kept[i][0], "to": kept[i + n - 1][0], "id": expr["id"]}


def match_expressions(
    lemmas: Sequence[str | None],
    expressions: Iterable[ExpressionDef],
    gaps: Sequence[bool] | None = None,
) -> list[ExpressionMatch]:
    """Contiguous lemma-sequence matches, skipping tokens marked as gaps. Indices refer
    to the full token list, so a match can span a skipped token."""
    found = find_expressions(lemmas, expressions, gaps)
    return sorted(found, key=lambda m: (m["from"], m["to"]))


def build_token(lang: str, tok: StanzaToken, word: Word, readings: list[Candidate] | None) -> Token:
    upos = ud.parse_upos(word.upos)
    head = None if word.head in (None, STANZA_ROOT_HEAD) else word.head - 1
    entry: Token = {
        "start": tok.start_char,
        "end": tok.end_char,
        "text": word.text,
        "lemma": word.lemma,
        "lemma_id": lemma_id(lang, word.lemma, upos),
        "upos": upos,
        "xpos": word.xpos,
        "feats": ud.parse_feats(word.feats),
        "head": head,
        "deprel": ud.parse_deprel(word.deprel),
    }
    is_part_of_fused_word = len(tok.words) > 1
    if is_part_of_fused_word:
        entry["mwt"] = tok.text
    if readings is not None and upos not in NO_LEMMA_ID and len(readings) > 1:
        entry["candidates"] = readings
    return entry


def build_tokens(
    lang: str, tok: StanzaToken, candidates: CandidateLookup | None
) -> Iterator[Token]:
    readings = candidates(tok.text, [w.text for w in tok.words]) if candidates else None
    for index, word in enumerate(tok.words):
        yield build_token(lang, tok, word, readings[index] if readings else None)


def build(
    doc: Document,
    *,
    lang: str,
    analyzer: str,
    text: str,
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
    expression_gap: ExpressionGap = no_gaps,
) -> Blob:
    expression_list = list(expressions)
    sentences: list[Sentence] = []
    for sent in doc.sentences:
        tokens = [token for tok in sent.tokens for token in build_tokens(lang, tok, candidates)]
        lemmas = [t["lemma"] for t in tokens]
        gaps = [expression_gap(t) for t in tokens]
        sentences.append(
            {
                "start": sent.tokens[0].start_char,
                "end": sent.tokens[-1].end_char,
                "tokens": tokens,
                "expressions": match_expressions(lemmas, expression_list, gaps),
            }
        )
    return {
        "schema": SCHEMA,
        "analyzer": analyzer,
        "lang": lang,
        "hash": "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "sentences": sentences,
    }
