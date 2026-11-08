"""Polish language plugin: a parser picks one reading in context, Morfeusz lists them all,
and Walenty says which cases verbs require."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from importlib.metadata import version
from pathlib import Path

from ... import reconcile
from ...blob import CandidateLookup, build
from ...lexicon import bundle
from ...lexicon.store import Lexicon
from ...parsed import ParsedSentence, Parser
from ...parsers.combo_parser import ComboParser
from ...parsers.stanza_parser import StanzaParser
from ...plugin import Bundler, Options, ParsingAnalyzer
from ...schema import Blob, ExpressionDef, Reading, Token, Upos
from . import cases
from .lexicon import Paradigms, Source
from .morfeusz import MorfeuszCandidates
from .nkjp import VERB_FORM_CLASSES, tag_class
from .valency import Valency

LANG = "pl"
PLUGIN_VERSION = "0.7"

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

VALENCY_FILE = "pl-valency.json"
"""Walenty's frames in the data directory (skolia-build-valency)."""


def parser(model: str = DEFAULT_MODEL) -> Parser:
    return MODELS[model]()


def candidate_lookup() -> CandidateLookup:
    return MorfeuszCandidates()


def valency(data: Path | None) -> Valency | None:
    return Valency.load(data / VALENCY_FILE) if data is not None else None


def entry_upos(reading: Reading) -> Upos:
    """Participles and gerunds belong to the verb's lexicon entry: pl:robić:VERB."""
    if tag_class(reading["xpos"]) in VERB_FORM_CLASSES:
        return "VERB"
    return reading["upos"]


def expression_gap(token: Token) -> bool:
    """Clitics split off a fused word that expression matching steps over:
    the person ending in dałem (dał + em) and the conditional in dałbym (dał + by + m)."""
    xpos = token["xpos"] or ""
    is_person_ending = tag_class(xpos) == "aglt"
    is_conditional = token["lemma"] == "by" and token["upos"] == "AUX"
    return is_person_ending or is_conditional


def analyzer_name(
    model_name: str,
    snap: str | None = DEFAULT_SNAP,
    valency: Valency | None = None,
    correct_cases: bool = True,
) -> str:
    """The version of everything that shapes an analysis. A document analysed under
    another name is out of date."""
    analyzer = f"{LANG}/{PLUGIN_VERSION}+{model_name}+morfeusz-{version('morfeusz2')}"
    if snap:
        analyzer += f"+snap-{snap}"
    if valency is not None:
        analyzer += f"+{valency.version}" + ("" if correct_cases else "+no-case-correction")
    return analyzer


def assemble(
    text: str,
    parsed: Iterable[ParsedSentence],
    model_name: str,
    candidates: CandidateLookup | None = None,
    expressions: Iterable[ExpressionDef] = (),
    snap: str | None = DEFAULT_SNAP,
    valency: Valency | None = None,
    correct_cases: bool = True,
) -> Blob:
    """snap: a reconcile.POLICIES name, or None to keep the parser's readings as they are.
    valency: Walenty frames, to explain cases by what verbs require; without it, case
    reasons use only the tree. correct_cases: let verb valency fix a case it rules out
    (only off to measure the correction)."""
    analyzer = analyzer_name(model_name, snap, valency, correct_cases)
    blob = build(
        parsed,
        lang=LANG,
        analyzer=analyzer,
        text=text,
        candidates=candidates,
        expressions=expressions,
        expression_gap=expression_gap,
        entry_upos=entry_upos,
        snap=reconcile.POLICIES[snap] if snap else None,
    )
    cases.apply([s["tokens"] for s in blob["sentences"]], valency, correct_cases)
    return blob


def analyzer(parser: Parser, options: Options, data: Path | None) -> ParsingAnalyzer:
    """With data, case reasons and corrections use Walenty (VALENCY_FILE)."""
    candidates = candidate_lookup() if options.candidates else None
    walenty = valency(data)
    return ParsingAnalyzer(
        analyzer_name(parser.name, options.snap, walenty),
        parser,
        lambda text, parsed: assemble(
            text, parsed, parser.name, candidates, options.expressions, options.snap, walenty
        ),
    )


def lexicon_source() -> Source:
    return Source()


def paradigms() -> Paradigms:
    return Paradigms()


def bundler(lexicon: Lexicon, data: Path | None) -> Bundler:
    """With data, entries carry Walenty's frames."""
    paradigms = Paradigms()
    walenty = valency(data)
    frames = walenty.frames if walenty is not None else bundle.no_frames
    return lambda blob: bundle.make(blob, lexicon, paradigms, frames)
