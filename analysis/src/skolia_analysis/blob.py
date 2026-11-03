from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Iterator, Sequence
from typing import TYPE_CHECKING

from .schema import Blob, Candidate, ExpressionDef, ExpressionMatch, Feats, Sentence, Token

if TYPE_CHECKING:
    from stanza.models.common.doc import Document, Word
    from stanza.models.common.doc import Token as StanzaToken

SCHEMA = 1

UNKNOWN_UPOS = "X"
NO_LEMMA_ID = {"PUNCT", "SYM"}

# UD feature string: "Case=Gen|Number=Sing"
UD_FEAT_SEP = "|"
UD_FEAT_KV_SEP = "="

# Stanza numbers words in a sentence from 1 and uses head 0 for the root
STANZA_ROOT_HEAD = 0

type CandidateLookup = Callable[[str], list[Candidate]]
"""Word form -> all its possible readings. The language plugin supplies one."""


def parse_feats(feats: str | None) -> Feats:
    if not feats:
        return {}
    return dict(pair.split(UD_FEAT_KV_SEP, 1) for pair in feats.split(UD_FEAT_SEP))


def lemma_id(lang: str, lemma: str | None, upos: str) -> str | None:
    if not lemma or upos in NO_LEMMA_ID:
        return None
    return f"{lang}:{lemma}:{upos}"


def find_expressions(
    lemmas: Sequence[str | None], expressions: Iterable[ExpressionDef]
) -> Iterator[ExpressionMatch]:
    lowered = [(lemma or "").lower() for lemma in lemmas]
    for expr in expressions:
        seq = [lemma.lower() for lemma in expr["lemmas"]]
        n = len(seq)
        for i in range(len(lowered) - n + 1):
            if lowered[i : i + n] == seq:
                yield {"from": i, "to": i + n - 1, "id": expr["id"]}


def match_expressions(
    lemmas: Sequence[str | None], expressions: Iterable[ExpressionDef]
) -> list[ExpressionMatch]:
    return sorted(find_expressions(lemmas, expressions), key=lambda m: (m["from"], m["to"]))


def build_token(
    lang: str, tok: StanzaToken, word: Word, candidates: CandidateLookup | None
) -> Token:
    upos = word.upos or UNKNOWN_UPOS
    head = None if word.head in (None, STANZA_ROOT_HEAD) else word.head - 1
    entry: Token = {
        "start": tok.start_char,
        "end": tok.end_char,
        "text": word.text,
        "lemma": word.lemma,
        "lemma_id": lemma_id(lang, word.lemma, upos),
        "upos": upos,
        "xpos": word.xpos,
        "feats": parse_feats(word.feats),
        "head": head,
        "deprel": word.deprel,
    }
    is_part_of_fused_word = len(tok.words) > 1
    if is_part_of_fused_word:
        entry["mwt"] = tok.text
    if candidates and upos not in NO_LEMMA_ID:
        readings = candidates(word.text)
        if len(readings) > 1:
            entry["candidates"] = readings
    return entry


def build(
    doc: Document,
    *,
    lang: str,
    analyzer: str,
    text: str,
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
) -> Blob:
    expression_list = list(expressions)
    sentences: list[Sentence] = []
    for sent in doc.sentences:
        tokens: list[Token] = [
            build_token(lang, tok, word, candidates) for tok in sent.tokens for word in tok.words
        ]
        sentences.append(
            {
                "start": sent.tokens[0].start_char,
                "end": sent.tokens[-1].end_char,
                "tokens": tokens,
                "expressions": match_expressions([t["lemma"] for t in tokens], expression_list),
            }
        )
    return {
        "schema": SCHEMA,
        "analyzer": analyzer,
        "lang": lang,
        "hash": "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "sentences": sentences,
    }
