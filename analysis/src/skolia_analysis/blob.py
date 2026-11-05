"""Build the analysis blob from parser output. Language-neutral: anything language-specific
comes in through the CandidateLookup and the expression gap predicate."""

import hashlib
from collections.abc import Callable, Iterable, Iterator, Sequence
from typing import Protocol

from . import reconcile
from .parsed import ParsedSentence, ParsedToken, ParsedWord
from .schema import Blob, ExpressionDef, ExpressionMatch, Reading, Sentence, Token, Upos

SCHEMA = 2

NO_LEMMA_ID: set[Upos] = {"PUNCT", "SYM"}


class CandidateLookup(Protocol):
    def __call__(self, token: str, words: Sequence[str]) -> list[list[Reading]]:
        """All dictionary readings for each word of one surface token.

        words is how the parser split the token: one word normally, several for a fused
        word (zrobiłem -> zrobił, em). Returns one list of readings per word.
        """
        ...


type ExpressionGap = Callable[[Token], bool]
"""True for tokens expression matching should step over, e.g. the -em of dałem."""


def no_gaps(_token: Token) -> bool:
    return False


type EntryUpos = Callable[[Reading], Upos]
"""The part of speech of the lexicon entry a reading belongs to, for its lemma_id. Usually
the reading's own; Polish participles and gerunds belong to their verb."""


def own_upos(reading: Reading) -> Upos:
    return reading["upos"]


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


def parser_reading(word: ParsedWord) -> Reading:
    return {
        "lemma": word.lemma or word.text,
        "upos": word.upos,
        "xpos": word.xpos or "",
        "feats": word.feats,
    }


def build_token(
    lang: str,
    tok: ParsedToken,
    word: ParsedWord,
    readings: list[Reading] | None,
    snap: reconcile.Policy | None,
    entry_upos: EntryUpos = own_upos,
) -> Token:
    chosen = parser_reading(word)
    replaced = False
    if snap and readings and word.upos not in NO_LEMMA_ID:
        better = snap(chosen, readings)
        if better is not None:
            chosen, replaced = better, True
    # parser_reading stands the text in for a missing lemma; that's no lemma to link by
    lemma = chosen["lemma"] if word.lemma or replaced else None
    entry: Token = {
        "start": tok.start,
        "end": tok.end,
        "text": word.text,
        "lemma": lemma,
        "lemma_id": lemma_id(lang, lemma, entry_upos(chosen)),
        "upos": chosen["upos"],
        "xpos": chosen["xpos"] or None,
        "feats": chosen["feats"],
        "head": word.head,
        "deprel": word.deprel,
    }
    if replaced:
        entry["parser"] = parser_reading(word)
    is_part_of_fused_word = len(tok.words) > 1
    if is_part_of_fused_word:
        entry["mwt"] = tok.text
    if readings is not None and word.upos not in NO_LEMMA_ID and len(readings) > 1:
        entry["candidates"] = readings
    return entry


def build_tokens(
    lang: str,
    tok: ParsedToken,
    candidates: CandidateLookup | None,
    snap: reconcile.Policy | None,
    entry_upos: EntryUpos = own_upos,
) -> Iterator[Token]:
    readings = candidates(tok.text, [w.text for w in tok.words]) if candidates else None
    for index, word in enumerate(tok.words):
        reading = readings[index] if readings else None
        yield build_token(lang, tok, word, reading, snap, entry_upos)


def build(
    sentences: Iterable[ParsedSentence],
    *,
    lang: str,
    analyzer: str,
    text: str,
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
    expression_gap: ExpressionGap = no_gaps,
    snap: reconcile.Policy | None = None,
    entry_upos: EntryUpos = own_upos,
) -> Blob:
    expression_list = list(expressions)
    built: list[Sentence] = []
    for sent in sentences:
        if not sent.tokens:
            # Nothing to show, and no offsets to give it
            continue
        tokens = [
            token
            for tok in sent.tokens
            for token in build_tokens(lang, tok, candidates, snap, entry_upos)
        ]
        lemmas = [t["lemma"] for t in tokens]
        gaps = [expression_gap(t) for t in tokens]
        built.append(
            {
                "start": sent.tokens[0].start,
                "end": sent.tokens[-1].end,
                "tokens": tokens,
                "expressions": match_expressions(lemmas, expression_list, gaps),
            }
        )
    return {
        "schema": SCHEMA,
        "analyzer": analyzer,
        "lang": lang,
        "hash": "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "sentences": built,
    }
