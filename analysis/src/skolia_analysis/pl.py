"""Polish language plugin: Stanza picks one reading in context, Morfeusz lists them all."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, Sequence
from importlib.metadata import version
from typing import TYPE_CHECKING

from .blob import CandidateLookup, build
from .nkjp import tag_class, to_ud
from .schema import Blob, Candidate, ExpressionDef, Token

if TYPE_CHECKING:
    from morfeusz2 import Edge
    from stanza import Pipeline
    from stanza.models.common.doc import Document

LANG = "pl"
PLUGIN_VERSION = "0.2"

# tokenize: split into sentences and tokens; mwt: split fused words (zrobiłem -> zrobił + em);
# pos: UPOS + XPOS + features; lemma: dictionary form; depparse: head + deprel
STANZA_PROCESSORS = "tokenize,mwt,pos,lemma,depparse"

# Classes with no dictionary reading worth listing: ign is a word Morfeusz doesn't know;
# a number in digits can be a cardinal (18 osób) or an ordinal (2000 roku) in any case,
# which only the sentence decides
NO_CANDIDATE_CLASSES = {"ign", "dig", "romandig"}
# Morfeusz marks homonyms on the lemma, e.g. "zamek:s1" vs "zamek:s2"
MORFEUSZ_LEMMA_QUALIFIER_SEP = ":"
# Morfeusz's name label for ordinary nouns; any other label (imię, nazwisko,
# nazwa_geograficzna, ...) marks a proper name
MORFEUSZ_COMMON_NOUN = "nazwa_pospolita"


def analyzer_version() -> str:
    return f"{LANG}/{PLUGIN_VERSION}+stanza-{version('stanza')}+morfeusz-{version('morfeusz2')}"


def pipeline() -> Pipeline:
    import stanza

    return stanza.Pipeline(
        LANG,
        processors=STANZA_PROCESSORS,
        logging_level="WARN",
    )


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

    def __call__(self, token: str, words: Sequence[str]) -> list[list[Candidate]]:
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


def _readings(edges: Iterable[Edge]) -> Iterator[Candidate]:
    for _start, _end, (_orth, base, tag, names, _qualifiers) in edges:
        if tag_class(tag) in NO_CANDIDATE_CLASSES:
            continue
        lemma = base.split(MORFEUSZ_LEMMA_QUALIFIER_SEP)[0] or base
        # Morfeusz capitalises lemmas of names; ethnonyms (Czeczen) carry no name label
        proper_name = lemma[:1].isupper() or any(name != MORFEUSZ_COMMON_NOUN for name in names)
        for upos, feats in to_ud(tag, lemma, proper_name):
            yield {"lemma": lemma, "upos": upos, "feats": feats}


def _dedupe(readings: Iterable[Candidate]) -> list[Candidate]:
    seen: set[tuple[str, str, frozenset[tuple[str, object]]]] = set()
    unique: list[Candidate] = []
    for reading in readings:
        key = (reading["lemma"], reading["upos"], frozenset(reading["feats"].items()))
        if key not in seen:
            seen.add(key)
            unique.append(reading)
    return unique


def candidate_lookup() -> CandidateLookup:
    return MorfeuszCandidates()


def expression_gap(token: Token) -> bool:
    """Clitics split off a fused word that expression matching steps over:
    the person ending in dałem (dał + em) and the conditional in dałbym (dał + by + m)."""
    xpos = token["xpos"] or ""
    is_person_ending = tag_class(xpos) == "aglt"
    is_conditional = token["lemma"] == "by" and token["upos"] == "AUX"
    return is_person_ending or is_conditional


def analyze(
    text: str,
    nlp: Callable[[str], Document],
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
) -> Blob:
    return build(
        nlp(text),
        lang=LANG,
        analyzer=analyzer_version(),
        text=text,
        candidates=candidates,
        expressions=expressions,
        expression_gap=expression_gap,
    )
