"""What a language gives skolia-build-lexicon: its Kaikki entries in the analyser's terms."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Protocol

from ..schema import Upos
from .kaikki import KaikkiEntry
from .schema import Paradigm, Relation, Sense


@dataclass
class Converted:
    """One Kaikki entry as the analyser would see it."""

    lemma: str
    upos: tuple[Upos, ...]
    """Every UPOS the analyser may give the headword; the entry is filed under each."""
    senses: list[Sense] = field(default_factory=lambda: list[Sense]())
    relations: list[Relation] = field(default_factory=lambda: list[Relation]())
    paradigms: list[Paradigm] = field(default_factory=lambda: list[Paradigm]())
    """Forms from Wiktionary, for a language without a generator (Polish has Morfeusz)."""


class LexiconSource(Protocol):
    @property
    def attribution(self) -> str:
        """Where the lexicon's content comes from, with licences; bundles carry it."""
        ...

    @property
    def version(self) -> str:
        """Versions of the sources besides Kaikki, for the lexicon version, e.g.
        "morfeusz-1.99.15"; empty if none."""
        ...

    def convert(self, entry: KaikkiEntry) -> Converted | None:
        """None for entries the analyser never looks up: affixes, phrases, inflected forms."""
        ...

    def hand_entries(self) -> Iterable[Converted]:
        """Entries Wiktionary's extract lacks; a Kaikki entry for the same word wins."""
        ...
