"""Parser output in one typed, backend-neutral shape.

Each parser backend (Stanza, UDPipe, ...) converts its own output to these types, checking
labels with ud.py on the way in, so the rest of the analyser never sees a backend's objects.
"""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Protocol

from .schema import Deprel, Feats, Upos


@dataclass(frozen=True, slots=True)
class ParsedWord:
    """One syntactic word, with the Universal Dependencies (UD) annotation fields."""

    text: str
    lemma: str | None
    """Dictionary form, e.g. być for był."""
    upos: Upos
    """Universal part of speech: the UD tag set shared by all languages, e.g. VERB, ADV."""
    xpos: str | None
    """Language-specific part-of-speech tag, in whatever tag set the parser's model uses."""
    feats: Feats
    """Morphological features, e.g. {"Number": "Sing", "Tense": "Past"}."""
    head: int | None
    """0-based index of the head word in the sentence's word list; None for the root."""
    deprel: Deprel | None
    """Dependency relation: this word's role for its head, e.g. nsubj (nominal subject)."""


@dataclass(frozen=True, slots=True)
class ParsedToken:
    """A stretch of the source text. Usually one word; several for a fused word
    (zrobiłem -> zrobił + em)."""

    text: str
    start: int
    """Character offset into the source text."""
    end: int
    words: tuple[ParsedWord, ...]


@dataclass(frozen=True, slots=True)
class ParsedSentence:
    tokens: tuple[ParsedToken, ...]


class AlignmentError(ValueError):
    pass


def align(text: str, surfaces: Iterable[str], start: int = 0) -> Iterator[tuple[int, int]]:
    """Character offsets of each token surface in text, in order, for backends that don't
    report offsets. Tokens are expected in text order, separated by optional whitespace."""
    cursor = start
    for surface in surfaces:
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        if not text.startswith(surface, cursor):
            found = text.find(surface, cursor)
            if found < 0 or text[cursor:found].strip():
                context = text[cursor : cursor + 30]
                raise AlignmentError(f"token {surface!r} not found at {cursor}: {context!r}")
            cursor = found
        yield cursor, cursor + len(surface)
        cursor += len(surface)


class Parser(Protocol):
    @property
    def name(self) -> str:
        """Identifies the model and its version, e.g. "stanza-1.15.0:default"; goes into
        the blob's analyzer version."""
        ...

    def __call__(self, text: str) -> list[ParsedSentence]: ...
