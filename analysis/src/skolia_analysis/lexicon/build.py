"""Kaikki extract -> lexicon SQLite file, keyed by the analyser's lemma_id."""

import hashlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ..blob import lemma_id
from ..schema import Upos
from . import kaikki, store
from .schema import Paradigm, Relation, Sense
from .source import Converted, LexiconSource

LEXICON_VERSION = "1"


@dataclass
class Merged:
    lemma: str
    upos: Upos
    senses: list[Sense] = field(default_factory=lambda: list[Sense]())
    relations: list[Relation] = field(default_factory=lambda: list[Relation]())
    paradigms: list[Paradigm] = field(default_factory=lambda: list[Paradigm]())


@dataclass
class Stats:
    entries: int = 0
    skipped: int = 0


def merge(converted: Iterable[Converted]) -> dict[tuple[str, Upos], Merged]:
    """Wiktionary splits a word by etymology and gender (pies the dog, the cop, the peg);
    the analyser can only tell them apart by features, so they merge into one entry
    whose senses carry the features that select them."""
    merged: dict[tuple[str, Upos], Merged] = {}
    for entry in converted:
        for upos in entry.upos:
            target = merged.setdefault((entry.lemma, upos), Merged(entry.lemma, upos))
            target.senses += entry.senses
            target.relations += [r for r in entry.relations if r not in target.relations]
            target.paradigms += [p for p in entry.paradigms if p not in target.paradigms]
    for target in merged.values():
        _drop_uninformative_when(target.senses)
    return merged


def _drop_uninformative_when(senses: list[Sense]) -> None:
    """A selector that every sense shares (pani: always Fem) can't pick between them."""
    selectors = [s.get("when") for s in senses]
    if all(selector == selectors[0] for selector in selectors):
        for sense in senses:
            sense.pop("when", None)


def rows(lang: str, source: LexiconSource, path: Path, stats: Stats) -> Iterator[store.Row]:
    def converted() -> Iterator[Converted]:
        for entry in kaikki.read(path):
            stats.entries += 1
            result = source.convert(entry)
            if result is None:
                stats.skipped += 1
            else:
                yield result

    merged = merge(converted())
    for hand in source.hand_entries():
        for upos in hand.upos:
            merged.setdefault((hand.lemma, upos), Merged(hand.lemma, upos, hand.senses))
    for (lemma, upos), entry in sorted(merged.items()):
        entry_id = lemma_id(lang, lemma, upos)
        if entry_id is not None:
            yield store.Row(entry_id, lemma, upos, entry.senses, entry.relations, entry.paradigms)


def build(lang: str, source: LexiconSource, kaikki_path: Path, out: Path) -> tuple[int, Stats]:
    stats = Stats()
    # Named by content: kaikki.org overwrites its extract in place, and a download's
    # mtime is the day it was fetched, so a date would differ between machines
    extract = _sha256(kaikki_path)[:12]
    lexicon_version = f"{LEXICON_VERSION}+kaikki-{extract}"
    if source.version:
        lexicon_version += f"+{source.version}"
    meta = {"lang": lang, "version": lexicon_version, "attribution": source.attribution}
    count = store.write(out, rows(lang, source, kaikki_path, stats), meta)
    return count, stats


def _sha256(path: Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()
