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


class Versions(TypedDict):
    """What ingest currently produces for a language, written when it starts. A ready
    document whose analysis or bundle has another name is out of date, and the API
    queues it again; until the new analysis is ready, the status keeps the old keys and
    the reader shows the old analysis."""

    analyzer: str
    lexicon: str
    analysis: str
    """analysis_name: the blob shape and analyzer, the part of the key that changes."""
    bundle: str
    """bundle_name: the bundle shape, analyzer and lexicon."""


SHORT_HASH = 12

MAX_TEXT_LENGTH = 20_000
"""Longest text ingest analyses, in characters; generated into shared/schema.gen.ts for
the API and reader. (JavaScript counts UTF-16 units, so the API's check is the stricter
one for text outside the BMP, such as emoji.) Kept small because analysis time is what
costs money: at about 46 words a second on an M-series Mac, a text at the limit (about
3,000 words) takes roughly a minute."""


def doc_id(lang: str, text: str) -> str:
    """sha256 hex of the UTF-8 "{lang}\n{text}": the same text in two languages is two
    documents. As docId in shared/keys.ts."""
    return hashlib.sha256(f"{lang}\n{text}".encode()).hexdigest()


def short_hash(value: str) -> str:
    """Version strings contain / : + (pl/0.4+combo-4.0.14:...), so keys use a hash."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:SHORT_HASH]


# Everything about a document sits under one prefix, so it can be inspected or deleted
# in one place:
#   doc/{doc}/text.txt
#   doc/{doc}/status.json
#   doc/{doc}/analysis/{analysis_name}.json.br   s{schema}-a{analyzer}
#   doc/{doc}/bundle/{bundle_name}.json.br       b{bundle schema}-a{analyzer}-l{lexicon}
# and, per language:
#   versions/{lang}.json


def doc_prefix(doc: str) -> str:
    return f"doc/{doc}/"


def text_key(doc: str) -> str:
    return f"{doc_prefix(doc)}text.txt"


def status_key(doc: str) -> str:
    return f"{doc_prefix(doc)}status.json"


def analysis_name(schema: int, analyzer: str) -> str:
    return f"s{schema}-a{short_hash(analyzer)}"


def bundle_name(bundle_schema: int, analyzer: str, lexicon: str) -> str:
    return f"b{bundle_schema}-a{short_hash(analyzer)}-l{short_hash(lexicon)}"


def analysis_key(doc: str, name: str) -> str:
    return f"{doc_prefix(doc)}analysis/{name}.json.br"


def bundle_key(doc: str, name: str) -> str:
    return f"{doc_prefix(doc)}bundle/{name}.json.br"


def versions_key(lang: str) -> str:
    return f"versions/{lang}.json"
