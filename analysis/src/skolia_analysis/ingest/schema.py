"""Messages and blob layout shared by skolia-api and skolia-ingest."""

import hashlib
from typing import Literal, NotRequired, TypedDict


class IngestJob(TypedDict):
    doc: str
    """Document id: sha256 hex of the UTF-8 text."""
    lang: str


type State = Literal["queued", "analysing", "ready", "failed"]


class Status(TypedDict):
    state: State
    updated: str
    """ISO 8601 time of the last change."""
    analyzer: NotRequired[str]
    lexicon: NotRequired[str]
    analysis: NotRequired[str]
    """Blob key of the analysis, once ready."""
    bundle: NotRequired[str]
    """Blob key of the lexicon bundle, once ready."""
    error: NotRequired[str]


SHORT_HASH = 12

MAX_TEXT_LENGTH = 200_000
"""Longest text ingest analyses, in characters; must match MAX_TEXT_LENGTH in
shared/api.ts. (JavaScript counts UTF-16 units, so the API's check is the stricter one
for text outside the BMP, such as emoji.) At about 46 words a second on an M-series
Mac, a text at the limit (about 30,000 words) takes roughly 10 minutes."""


def doc_id(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def short_hash(value: str) -> str:
    """Version strings contain / : + (pl/0.4+combo-4.0.14:...), so keys use a hash."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:SHORT_HASH]


# Everything about a document sits under one prefix, so it can be inspected or deleted
# in one place:
#   doc/{doc}/text.txt
#   doc/{doc}/status.json
#   doc/{doc}/analysis/s{schema}-a{analyzer}.json.br
#   doc/{doc}/bundle/a{analyzer}-l{lexicon}.json.br


def doc_prefix(doc: str) -> str:
    return f"doc/{doc}/"


def text_key(doc: str) -> str:
    return f"{doc_prefix(doc)}text.txt"


def status_key(doc: str) -> str:
    return f"{doc_prefix(doc)}status.json"


def analysis_key(doc: str, schema: int, analyzer: str) -> str:
    return f"{doc_prefix(doc)}analysis/s{schema}-a{short_hash(analyzer)}.json.br"


def bundle_key(doc: str, analyzer: str, lexicon: str) -> str:
    return f"{doc_prefix(doc)}bundle/a{short_hash(analyzer)}-l{short_hash(lexicon)}.json.br"
