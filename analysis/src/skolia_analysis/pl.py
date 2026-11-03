from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from importlib.metadata import version
from typing import TYPE_CHECKING

from .blob import CandidateLookup, build
from .nkjp import to_ud
from .schema import Blob, Candidate, ExpressionDef

if TYPE_CHECKING:
    from stanza import Pipeline
    from stanza.models.common.doc import Document

LANG = "pl"
PLUGIN_VERSION = "0.1"

# tokenize: split into sentences and tokens; mwt: split fused words (zrobiłem -> zrobił + em);
# pos: UPOS + XPOS + features; lemma: dictionary form; depparse: head + deprel
STANZA_PROCESSORS = "tokenize,mwt,pos,lemma,depparse"

MORFEUSZ_UNKNOWN_TAG = "ign"
# Morfeusz marks homonyms on the lemma, e.g. "zamek:s1" vs "zamek:s2"
MORFEUSZ_LEMMA_QUALIFIER_SEP = ":"


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
    """Every reading Morfeusz knows for a word form, converted to UD.

    Callable so it fits blob.CandidateLookup: candidates("psa") -> [...].
    """

    def __init__(self) -> None:
        import morfeusz2

        self._morf = morfeusz2.Morfeusz()

    def __call__(self, form: str) -> list[Candidate]:
        return list(self._readings(form))

    def _readings(self, form: str) -> Iterator[Candidate]:
        # Morfeusz returns a graph: each edge is (start node, end node, interpretation).
        # "Dałem" gives 0->1 "Dał" and 1->2 "em". Keep only edges covering the whole form.
        edges = self._morf.analyse(form)
        if not edges:
            return
        last_node = max(end for _, end, _ in edges)
        seen: set[tuple[str, str, tuple[tuple[str, str], ...]]] = set()
        for start, end, (_orth, base, tag, *_labels) in edges:
            if start != 0 or end != last_node or tag == MORFEUSZ_UNKNOWN_TAG:
                continue
            lemma = base.split(MORFEUSZ_LEMMA_QUALIFIER_SEP)[0] or base
            for upos, feats in to_ud(tag):
                key = (lemma, upos, tuple(sorted(feats.items())))
                if key in seen:
                    continue
                seen.add(key)
                yield {"lemma": lemma, "upos": upos, "feats": feats}


def candidate_lookup() -> CandidateLookup:
    return MorfeuszCandidates()


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
    )
