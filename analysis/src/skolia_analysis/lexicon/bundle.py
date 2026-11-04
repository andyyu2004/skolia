"""Analysis blob + lexicon -> the lexicon slice a document needs on the phone."""

from collections.abc import Callable

from .. import ud
from ..schema import Blob, Feats, Upos
from ..walenty.model import Schema
from .schema import Bundle, BundleParadigm, Entry, Match, Paradigm
from .store import Lexicon, Row

LEMMA_ID_SEP = ":"

type Paradigms = Callable[[str, Upos], list[Paradigm]]
type Frames = Callable[[str, Upos], list[Schema]]
"""A word's valency schemata, by lemma and part of speech."""


def no_frames(_lemma: str, _upos: Upos) -> list[Schema]:
    return []


def parse_lemma_id(value: str) -> tuple[str, str, Upos]:
    """pl:pies:NOUN -> (pl, pies, NOUN). The lemma itself may contain the separator."""
    lang, rest = value.split(LEMMA_ID_SEP, 1)
    lemma, upos = rest.rsplit(LEMMA_ID_SEP, 1)
    if not ud.is_upos(upos):
        raise ud.UnknownLabel(f"lemma_id {value!r}: unknown UPOS {upos!r}")
    return lang, lemma, upos


def resolve(lexicon: Lexicon, lemma_id: str) -> tuple[Row | None, Match]:
    """The entry for a token's lemma_id, falling back to the same lemma under another part
    of speech, then to the lemma lowercased."""
    lang, lemma, upos = parse_lemma_id(lemma_id)
    row = lexicon.get(lemma_id)
    if row is not None:
        return row, "exact"
    same_lemma = lexicon.by_lemma(lemma)
    if same_lemma:
        return same_lemma[0], "other-pos"
    if lemma != lemma.lower():
        lowered = lexicon.get(f"{lang}{LEMMA_ID_SEP}{lemma.lower()}{LEMMA_ID_SEP}{upos}")
        if lowered is not None:
            return lowered, "lowercase"
        any_pos = lexicon.by_lowercase(lemma)
        if any_pos:
            return any_pos[0], "lowercase"
    return None, "none"


def make(blob: Blob, lexicon: Lexicon, paradigms: Paradigms, frames: Frames = no_frames) -> Bundle:
    meta = lexicon.meta()
    bundle: Bundle = {
        "lang": blob["lang"],
        "lexicon": meta.get("version", ""),
        "attribution": meta.get("attribution", ""),
        "entries": {},
        "lookup": {},
        "match": {},
        "feats": [],
    }
    feats = FeatsTable(bundle["feats"])
    for sentence in blob["sentences"]:
        for token in sentence["tokens"]:
            token_id = token["lemma_id"]
            if token_id is None or token_id in bundle["match"]:
                continue
            row, match = resolve(lexicon, token_id)
            bundle["match"][token_id] = match
            entry_id = row.lemma_id if row else token_id
            if entry_id != token_id:
                bundle["lookup"][token_id] = entry_id
            if entry_id not in bundle["entries"]:
                bundle["entries"][entry_id] = _entry(entry_id, row, paradigms, frames, feats)
    return bundle


class FeatsTable:
    """Assigns each distinct feature set an index in the bundle's feats list."""

    def __init__(self, table: list[Feats]) -> None:
        self._table = table
        self._index: dict[tuple[tuple[str, object], ...], int] = {}

    def __call__(self, feats: Feats) -> int:
        key = tuple(sorted(feats.items()))
        if key not in self._index:
            self._index[key] = len(self._table)
            self._table.append(feats)
        return self._index[key]


def _compact(paradigm: Paradigm, feats: FeatsTable) -> BundleParadigm:
    by_form: dict[str, list[int]] = {}
    for form in paradigm["forms"]:
        indices = by_form.setdefault(form["form"], [])
        index = feats(form["feats"])
        if index not in indices:
            indices.append(index)
    return {"homonym": paradigm["homonym"], "forms": list(by_form.items())}


def _entry(
    entry_id: str, row: Row | None, paradigms: Paradigms, frames: Frames, feats: FeatsTable
) -> Entry:
    _lang, lemma, upos = parse_lemma_id(entry_id)
    return {
        "lemma": lemma,
        "upos": upos,
        "senses": row.senses if row else [],
        "relations": row.relations if row else [],
        "paradigms": [_compact(p, feats) for p in paradigms(lemma, upos)],
        "frames": frames(lemma, upos),
    }
