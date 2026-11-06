"""Morfeusz 2: every reading of a Polish word, converted to UD (nkjp.py)."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from typing import TYPE_CHECKING

from ...schema import Reading
from .nkjp import tag_class, to_ud

if TYPE_CHECKING:
    from morfeusz2 import Edge, Interpretation

# Classes with no dictionary reading worth listing: ign is a word Morfeusz doesn't know;
# a number in digits can be a cardinal (18 osób) or an ordinal (2000 roku) in any case,
# which only the sentence decides
NO_CANDIDATE_CLASSES = {"ign", "dig", "romandig"}
# Morfeusz marks homonyms on the lemma, e.g. "zamek:s1" vs "zamek:s2"
MORFEUSZ_LEMMA_QUALIFIER_SEP = ":"
# Morfeusz's name label for ordinary nouns; any other label (imię, nazwisko,
# nazwa_geograficzna, ...) marks a proper name
MORFEUSZ_COMMON_NOUN = "nazwa_pospolita"


class MorfeuszCandidates:
    """Every reading Morfeusz knows for each word of a token, converted to UD.

    Morfeusz returns a graph: each edge is (start node, end node, interpretation).
    "Dałem" gives 0->1 "Dał" and 1->2 "em". Morfeusz only finds that split when it sees
    the whole word ("em" alone is the letter M), so fused words are analysed whole and
    the edges assigned to the parser's parts in order.
    """

    def __init__(self) -> None:
        import morfeusz2

        self._morf = morfeusz2.Morfeusz()

    def __call__(self, token: str, words: Sequence[str]) -> list[list[Reading]]:
        edges = self._morf.analyse(token)
        segments = _align(edges, words) if len(words) > 1 else [_whole(edges)]
        if segments is None:
            segments = [_whole(self._morf.analyse(word)) for word in words]
        return [_dedupe(_readings(segment)) for segment in segments]


def _whole(edges: list[Edge]) -> list[Edge]:
    """Edges that cover the whole analysed string in one step."""
    if not edges:
        return []
    last_node = max(end for _, end, _ in edges)
    return [edge for edge in edges if edge[0] == 0 and edge[1] == last_node]


def _align(edges: list[Edge], words: Sequence[str]) -> list[list[Edge]] | None:
    """Edges for each word, following the graph from node 0. None if the parser's split
    doesn't match a path through Morfeusz's graph."""
    node = 0
    segments: list[list[Edge]] = []
    for word in words:
        matching = [e for e in edges if e[0] == node and e[2][0].lower() == word.lower()]
        ends = {e[1] for e in matching}
        if len(ends) != 1:
            return None
        segments.append(matching)
        node = ends.pop()
    last_node = max(end for _, end, _ in edges)
    return segments if node == last_node else None


def _readings(edges: Iterable[Edge]) -> Iterator[Reading]:
    for _start, _end, interpretation in edges:
        if tag_class(interpretation[2]) not in NO_CANDIDATE_CLASSES:
            yield from interpretation_readings(interpretation)


def split_homonym(base: str) -> tuple[str, str]:
    """Morfeusz's lemma field into (lemma, homonym label): "pies:Sm1" -> ("pies", "Sm1")."""
    lemma, _, homonym = base.partition(MORFEUSZ_LEMMA_QUALIFIER_SEP)
    return (lemma or base, homonym)


def interpretation_readings(interpretation: Interpretation) -> Iterator[Reading]:
    """The UD readings of one Morfeusz interpretation (one tag can stand for several)."""
    _orth, base, tag, names, _qualifiers = interpretation
    lemma, _homonym = split_homonym(base)
    # Morfeusz capitalises lemmas of names; ethnonyms (Czeczen) carry no name label
    proper_name = lemma[:1].isupper() or any(name != MORFEUSZ_COMMON_NOUN for name in names)
    for reading in to_ud(tag, lemma, proper_name):
        yield {
            "lemma": lemma,
            "upos": reading.upos,
            "xpos": reading.xpos,
            "feats": reading.feats,
        }


def _dedupe(readings: Iterable[Reading]) -> list[Reading]:
    """One entry per distinct UD reading; NKJP distinctions UD doesn't make (congr/rec,
    ncol) collapse, keeping the first tag."""
    seen: set[tuple[str, str, frozenset[tuple[str, object]]]] = set()
    unique: list[Reading] = []
    for reading in readings:
        key = (reading["lemma"], reading["upos"], frozenset(reading["feats"].items()))
        if key not in seen:
            seen.add(key)
            unique.append(reading)
    return unique
