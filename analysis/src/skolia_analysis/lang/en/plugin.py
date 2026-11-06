"""English language plugin: Stanza parses; the forms and meanings come from Wiktionary.

English inflects little, so there is no dictionary of readings to check the parser
against (no candidates, no snapping): the parser's reading is the token's.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path

from ...blob import build
from ...lexicon import bundle
from ...lexicon.store import Lexicon
from ...parsed import ParsedSentence, Parser
from ...parsers.stanza_parser import StanzaParser
from ...plugin import Bundler, Options
from ...schema import Blob
from .lexicon import Source, stored_paradigms

LANG = "en"
PLUGIN_VERSION = "0.1"

# Parser models, by name. Each loads on first use. Stanza's English models are trained on
# UD English EWT, GUM and other UD English treebanks ("combined"). Scores: EVALUATION.md.
MODELS: dict[str, Callable[[], Parser]] = {
    # ELECTRA-large transformer: most accurate, slowest
    "stanza-accurate": lambda: StanzaParser(LANG, "default_accurate"),
    # character language model: fastest
    "stanza": lambda: StanzaParser(LANG, "default"),
}
DEFAULT_MODEL = "stanza-accurate"
DEFAULT_SNAP: str | None = None


def parser(model: str = DEFAULT_MODEL) -> Parser:
    return MODELS[model]()


def analyzer_name(model_name: str) -> str:
    """The version of everything that shapes an analysis. A document analysed under
    another name is out of date."""
    return f"{LANG}/{PLUGIN_VERSION}+{model_name}"


def assemble(
    text: str, parsed: Iterable[ParsedSentence], model_name: str, options: Options
) -> Blob:
    return build(
        parsed,
        lang=LANG,
        analyzer=analyzer_name(model_name),
        text=text,
        expressions=options.expressions,
    )


class Analyzer:
    """Options.snap and candidates have no effect: English has no candidate lookup."""

    def __init__(self, parser: Parser, options: Options) -> None:
        self._parser = parser
        self._options = options
        self.name = analyzer_name(parser.name)

    def __call__(self, text: str) -> Blob:
        return self.assemble(text, self._parser(text))

    def assemble(self, text: str, parsed: Iterable[ParsedSentence]) -> Blob:
        return assemble(text, parsed, self._parser.name, self._options)


def analyzer(parser: Parser, options: Options, data: Path | None) -> Analyzer:
    """English uses nothing from data besides the lexicon."""
    return Analyzer(parser, options)


def lexicon_source() -> Source:
    return Source()


def bundler(lexicon: Lexicon, data: Path | None) -> Bundler:
    paradigms = stored_paradigms(lexicon, LANG)
    return lambda blob: bundle.make(blob, lexicon, paradigms)
