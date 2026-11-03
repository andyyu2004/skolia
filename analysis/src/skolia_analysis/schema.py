"""Shape of the analysis blob JSON. Field names follow Universal Dependencies (UD)."""

from typing import NotRequired, TypedDict

type Feats = dict[str, str]
"""UD morphological features, e.g. {"Case": "Gen", "Number": "Sing"}."""


class Candidate(TypedDict):
    """One possible reading of a word form, whether or not the parser picked it."""

    lemma: str
    upos: str
    feats: Feats


class Token(TypedDict):
    start: int
    """Character offset into the source text. Parts of a fused word share the whole word's span."""
    end: int
    text: str
    lemma: str | None
    """Dictionary form: psa -> pies."""
    lemma_id: str | None
    """Stable key "{lang}:{lemma}:{upos}", e.g. "pl:pies:NOUN". None for punctuation."""
    upos: str
    """UD universal part of speech: NOUN, VERB, ADJ, ADP (preposition), AUX, PRON, ..."""
    xpos: str | None
    """Language-specific tag. For Polish an NKJP tag like "subst:sg:gen:m2"; see nkjp.py."""
    feats: Feats
    head: int | None
    """Index in the sentence's token list of the word this one depends on. None for the root."""
    deprel: str | None
    """UD dependency relation to the head: obl, amod, case, nsubj, ..."""
    mwt: NotRequired[str]
    """Set when this token is part of a multi-word token (a fused word); holds the whole word."""
    candidates: NotRequired[list[Candidate]]
    """All readings Morfeusz knows for this form. Only present when there is more than one."""


class ExpressionDef(TypedDict):
    """Input: a multi-word expression to look for, as a sequence of lemmas."""

    id: str
    lemmas: list[str]


ExpressionMatch = TypedDict("ExpressionMatch", {"from": int, "to": int, "id": str})
"""Output: token indices (inclusive) where an expression matched.

Functional TypedDict syntax because "from" is a Python keyword.
"""


class Sentence(TypedDict):
    start: int
    end: int
    tokens: list[Token]
    expressions: list[ExpressionMatch]


class Blob(TypedDict):
    schema: int
    """Version of this JSON shape."""
    analyzer: str
    """Plugin + library versions that produced it; a change means the blob can be regenerated."""
    lang: str
    hash: str
    """sha256 of the source text; the blob's storage key."""
    sentences: list[Sentence]
