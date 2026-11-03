"""Polish language plugin: a parser picks one reading in context, Morfeusz lists them all."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, Sequence
from importlib.metadata import version
from typing import TYPE_CHECKING

from . import reconcile
from .blob import CandidateLookup, build
from .nkjp import tag_class, to_ud
from .parsed import ParsedSentence, Parser
from .parsers.combo_parser import ComboParser
from .parsers.stanza_parser import StanzaParser
from .schema import Blob, ExpressionDef, Reading, Token

if TYPE_CHECKING:
    from morfeusz2 import Edge

LANG = "pl"
PLUGIN_VERSION = "0.3"

# Parser models, by name. Each loads on first use. All are trained on UD Polish PDB, whose
# conventions schema.py and the dictionary conversion assume. Scores: analysis/EVALUATION.md.
MODELS: dict[str, Callable[[], Parser]] = {
    # XLM-RoBERTa tagger + parser from IPI PAN (UD 2.18 naming): most accurate, ~3x slower
    # than stanza
    "combo": lambda: ComboParser("clarin-pl/combo-nlp-xlm-roberta-base-polish-pdb-ud2.18"),
    # Stanza with the HerBERT transformer: close to combo on parsing, behind on tagging
    "stanza-accurate": lambda: StanzaParser(LANG, "default_accurate"),
    # Stanza with a character language model: fastest, least accurate
    "stanza": lambda: StanzaParser(LANG, "default"),
}
# Both chosen on PDB dev with scripts/eval_ud.py (see EVALUATION.md). DEFAULT_SNAP keeps
# the parser's UPOS and takes the closest dictionary features and lemma when the parser's
# reading isn't one Morfeusz allows.
DEFAULT_MODEL = "combo"
DEFAULT_SNAP: str | None = "upos"

# Classes with no dictionary reading worth listing: ign is a word Morfeusz doesn't know;
# a number in digits can be a cardinal (18 osób) or an ordinal (2000 roku) in any case,
# which only the sentence decides
NO_CANDIDATE_CLASSES = {"ign", "dig", "romandig"}
# Morfeusz marks homonyms on the lemma, e.g. "zamek:s1" vs "zamek:s2"
MORFEUSZ_LEMMA_QUALIFIER_SEP = ":"
# Morfeusz's name label for ordinary nouns; any other label (imię, nazwisko,
# nazwa_geograficzna, ...) marks a proper name
MORFEUSZ_COMMON_NOUN = "nazwa_pospolita"


def parser(model: str = DEFAULT_MODEL) -> Parser:
    return MODELS[model]()


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
    for _start, _end, (_orth, base, tag, names, _qualifiers) in edges:
        if tag_class(tag) in NO_CANDIDATE_CLASSES:
            continue
        lemma = base.split(MORFEUSZ_LEMMA_QUALIFIER_SEP)[0] or base
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
    model: Parser,
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
    snap: str | None = DEFAULT_SNAP,
) -> Blob:
    """snap: a reconcile.POLICIES name, or None to keep the parser's readings as they are."""
    return assemble(text, model(text), model.name, candidates, expressions, snap)


def assemble(
    text: str,
    parsed: Iterable[ParsedSentence],
    model_name: str,
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
    snap: str | None = DEFAULT_SNAP,
) -> Blob:
    """The blob for text already parsed, so one slow parse can be reused (e.g. to compare
    snap policies)."""
    analyzer = f"{LANG}/{PLUGIN_VERSION}+{model_name}+morfeusz-{version('morfeusz2')}"
    return build(
        parsed,
        lang=LANG,
        analyzer=analyzer + (f"+snap-{snap}" if snap else ""),
        text=text,
        candidates=candidates,
        expressions=expressions,
        expression_gap=expression_gap,
        snap=reconcile.POLICIES[snap] if snap else None,
    )
