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


def doc_id(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def short_hash(value: str) -> str:
    """Version strings contain / : + (pl/0.4+combo-4.0.14:...), so keys use a hash."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:SHORT_HASH]


def text_key(doc: str) -> str:
    return f"text/{doc}.txt"


def status_key(doc: str) -> str:
    return f"status/{doc}.json"


def analysis_key(doc: str, schema: int, analyzer: str) -> str:
    return f"analysis/{doc}/s{schema}-a{short_hash(analyzer)}.json.gz"


def bundle_key(doc: str, analyzer: str, lexicon: str) -> str:
    return f"bundle/{doc}/a{short_hash(analyzer)}-l{short_hash(lexicon)}.json.gz"
