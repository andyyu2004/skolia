"""Kaikki extract -> lexicon SQLite file, keyed by the analyser's lemma_id."""

import hashlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ..blob import lemma_id
from ..schema import Upos
from . import kaikki, store
from .pronunciation import merge as merge_pronunciations
from .schema import Paradigm, Pronunciation, Relation, Sense
from .source import Converted, LexiconSource

LEXICON_VERSION = "3"


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
    pronounced: int = 0
    """Words with a pronunciation, by part of speech."""


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
            target.paradigms += entry.paradigms
    for target in merged.values():
        _drop_uninformative_when(target.senses)
        target.paradigms = _drop_contained(target.paradigms)
    return merged


def _drop_contained(paradigms: list[Paradigm]) -> list[Paradigm]:
    """Etymologies often share a table, or one lists a few more forms (acacia: acaciae);
    keep one table, the fullest, per homonym."""

    def forms(p: Paradigm) -> frozenset[tuple[str, tuple[tuple[str, object], ...]]]:
        return frozenset((f["form"], tuple(sorted(f["feats"].items()))) for f in p["forms"])

    kept: list[Paradigm] = []
    for i, paradigm in enumerate(paradigms):
        mine = forms(paradigm)
        covered = any(
            other["homonym"] == paradigm["homonym"]
            and (mine < forms(other) or (mine == forms(other) and j < i))
            for j, other in enumerate(paradigms)
            if j != i
        )
        if not covered:
            kept.append(paradigm)
    return kept


def _drop_uninformative_when(senses: list[Sense]) -> None:
    """A selector that every sense shares (pani: always Fem) can't pick between them."""
    selectors = [s.get("when") for s in senses]
    if all(selector == selectors[0] for selector in selectors):
        for sense in senses:
            sense.pop("when", None)


type Pronunciations = dict[tuple[str, Upos], list[Pronunciation]]


def rows(
    lang: str,
    source: LexiconSource,
    path: Path,
    stats: Stats,
    pronunciations: Pronunciations | None = None,
) -> Iterator[store.Row]:
    """Fills pronunciations, if given, on the way: inflected forms have them too."""

    def converted() -> Iterator[Converted]:
        for entry in kaikki.read(path):
            stats.entries += 1
            if pronunciations is not None and (said := source.pronounce(entry)) is not None:
                for upos in said.upos:
                    key = (said.word, upos)
                    pronunciations[key] = merge_pronunciations(
                        pronunciations.get(key, []), said.pronunciations
                    )
            result = source.convert(entry)
            if result is None:
                stats.skipped += 1
            else:
                yield result

    merged = merge(converted())
    for hand in source.hand_entries():
        for upos in hand.upos:
            merged.setdefault(
                (hand.lemma, upos),
                Merged(hand.lemma, upos, hand.senses, hand.relations, hand.paradigms),
            )
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
    pronunciations: Pronunciations = {}
    count = store.write(
        out,
        rows(lang, source, kaikki_path, stats, pronunciations),
        meta,
        lambda: (
            store.PronunciationRow(word, upos, said)
            for (word, upos), said in sorted(pronunciations.items())
        ),
    )
    stats.pronounced = len(pronunciations)
    return count, stats


def _sha256(path: Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()
