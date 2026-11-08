"""Analysis blob + lexicon -> the lexicon slice a document needs on the phone."""

from collections.abc import Callable

from .. import ud
from ..lang.pl.walenty.model import Schema
from ..schema import Blob, Feats, Upos
from .schema import (
    BUNDLE_SCHEMA,
    Bundle,
    BundleParadigm,
    Entry,
    Match,
    Paradigm,
    Pronunciation,
    Recording,
    pronunciation_key,
)
from .store import Lexicon, Row

LEMMA_ID_SEP = ":"

# For a lemma the lexicon has only under other parts of speech, the ones a dictionary
# files a word with this UPOS under, most likely first: an auxiliary is a verb to
# Wiktionary (must, AUX: the verb, not the noun a must). Any others come after, most
# senses first. Subordinators aren't listed: the most senses pick better than any fixed
# order (because is a conjunction, before and until prepositions).
CLOSEST_UPOS: dict[Upos, tuple[Upos, ...]] = {
    "AUX": ("VERB",),
    "PROPN": ("NOUN",),
    "NOUN": ("PROPN",),
    "DET": ("PRON", "ADJ"),
    "PRON": ("DET",),
    "PART": ("ADV",),
}

type Paradigms = Callable[[str, Upos], list[Paradigm]]
"""Generates a word's paradigms, by lemma and part of speech, for a language whose
lexicon doesn't store them."""
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
    """The entry for a token's lemma_id, falling back to the lemma lowercased under the same
    part of speech, then to the same lemma under another part of speech, then to the lemma
    lowercased under any. A capitalised adjective in a name (Old Town) is the adjective,
    not the proper noun Old."""
    lang, lemma, upos = parse_lemma_id(lemma_id)
    row = lexicon.get(lemma_id)
    if row is not None:
        return row, "exact"
    if lemma != lemma.lower():
        lowered = lexicon.get(f"{lang}{LEMMA_ID_SEP}{lemma.lower()}{LEMMA_ID_SEP}{upos}")
        if lowered is not None:
            return lowered, "lowercase"
    same_lemma = lexicon.by_lemma(lemma)
    if same_lemma:
        closest = CLOSEST_UPOS.get(upos, ())
        # sorted is stable: within a rank, by_lemma's most-senses order stays
        ranked = sorted(
            same_lemma, key=lambda r: closest.index(r.upos) if r.upos in closest else len(closest)
        )
        return ranked[0], "other-pos"
    if lemma != lemma.lower():
        any_pos = lexicon.by_lowercase(lemma)
        if any_pos:
            return any_pos[0], "lowercase"
    return None, "none"


def make(
    blob: Blob, lexicon: Lexicon, paradigms: Paradigms | None = None, frames: Frames = no_frames
) -> Bundle:
    bundle: Bundle = {
        "schema": BUNDLE_SCHEMA,
        "lang": blob["lang"],
        "lexicon": lexicon.version(),
        "attribution": lexicon.meta().get("attribution", ""),
        "entries": {},
        "lookup": {},
        "match": {},
        "feats": [],
        "pronunciations": {},
        "recordings": {},
    }
    feats = FeatsTable(bundle["feats"])
    seen: set[str] = set()

    def add_pronunciation(word: str, upos: Upos) -> None:
        key = pronunciation_key(word, upos)
        if key in seen:
            return
        seen.add(key)
        if found := pronounce(lexicon, word, upos):
            bundle["pronunciations"][key] = found
        if heard := record(lexicon, word, upos):
            bundle["recordings"][key] = heard

    for sentence in blob["sentences"]:
        for token in sentence["tokens"]:
            if token["upos"] != "PUNCT":
                add_pronunciation(token["text"], token["upos"])
            token_id = token["lemma_id"]
            if token_id is None or token_id in bundle["match"]:
                continue
            row, match = resolve(lexicon, token_id)
            bundle["match"][token_id] = match
            entry_id = row.lemma_id if row else token_id
            if entry_id != token_id:
                bundle["lookup"][token_id] = entry_id
            if entry_id not in bundle["entries"]:
                entry = _entry(entry_id, row, paradigms, frames, feats)
                bundle["entries"][entry_id] = entry
                add_pronunciation(entry["lemma"], entry["upos"])
    return bundle


def pronounce(lexicon: Lexicon, word: str, upos: Upos) -> list[Pronunciation]:
    found = _find(lexicon.pronunciations, word, upos)
    return lexicon.pronunciations(found[0])[found[1]] if found else []


def record(lexicon: Lexicon, word: str, upos: Upos) -> list[Recording]:
    """The recordings filed with the pronunciation pronounce picks: the noun lead, /lɛd/,
    has none of its own, and the verb's, /liːd/, would be wrong. Only a word without a
    pronunciation falls back by its recordings."""
    found = _find(lexicon.pronunciations, word, upos) or _find(lexicon.recordings, word, upos)
    return lexicon.recordings(found[0]).get(found[1], []) if found else []


def _find[T](
    by_upos_of: Callable[[str], dict[Upos, list[T]]], word: str, upos: Upos
) -> tuple[str, Upos] | None:
    """The spelling and part of speech to look up. Falls back like resolve: the word
    lowercased (a sentence's first word), then the closest other part of speech (be as
    AUX is Wiktionary's verb)."""
    for spelling in dict.fromkeys([word, word.lower()]):
        by_upos = by_upos_of(spelling)
        if upos in by_upos:
            return spelling, upos
        for other in CLOSEST_UPOS.get(upos, ()):
            if other in by_upos:
                return spelling, other
    for spelling in dict.fromkeys([word, word.lower()]):
        by_upos = by_upos_of(spelling)
        if by_upos:
            return spelling, next(iter(by_upos))
    return None


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


def compact(paradigm: Paradigm, feats: FeatsTable) -> BundleParadigm:
    by_form: dict[str, list[int]] = {}
    for form in paradigm["forms"]:
        indices = by_form.setdefault(form["form"], [])
        index = feats(form["feats"])
        if index not in indices:
            indices.append(index)
    return {"homonym": paradigm["homonym"], "forms": list(by_form.items())}


def _paradigms(
    row: Row | None, paradigms: Paradigms | None, lemma: str, upos: Upos
) -> list[Paradigm]:
    if paradigms is not None:
        return paradigms(lemma, upos)
    return row.paradigms if row else []


def _entry(
    entry_id: str, row: Row | None, paradigms: Paradigms | None, frames: Frames, feats: FeatsTable
) -> Entry:
    _lang, lemma, upos = parse_lemma_id(entry_id)
    return {
        "lemma": lemma,
        "upos": upos,
        "senses": row.senses if row else [],
        "relations": row.relations if row else [],
        "paradigms": [compact(p, feats) for p in _paradigms(row, paradigms, lemma, upos)],
        "frames": frames(lemma, upos),
    }
