"""French language plugin: Stanza parses; the forms and meanings come from Wiktionary.

As for English, there is no dictionary of readings to check the parser against (no
candidates, no snapping): the parser's reading is the token's.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path

from ...blob import build
from ...lexicon import bundle
from ...lexicon.store import Lexicon
from ...parsed import ParsedSentence, Parser
from ...parsers.stanza_parser import StanzaParser
from ...plugin import Bundler, Options, ParsingAnalyzer
from ...schema import Blob
from .lexicon import Source

LANG = "fr"
PLUGIN_VERSION = "0.1"

# Parser models, by name. Each loads on first use. Stanza's French models are trained on
# UD French GSD and the other UD French treebanks ("combined"). Scores: EVALUATION.md.
MODELS: dict[str, Callable[[], Parser]] = {
    # CamemBERT-large transformer: most accurate, slowest. In batches of 1000 words, a
    # 20,000-character text peaks at 3.5 GiB instead of 5.7 (EVALUATION.md)
    "stanza-accurate": lambda: StanzaParser(LANG, "default_accurate", batch_words=1000),
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


def analyzer(parser: Parser, options: Options, data: Path | None) -> ParsingAnalyzer:
    """French uses nothing from data besides the lexicon, and has no candidate lookup:
    Options.candidates has no effect."""
    if options.snap is not None:
        raise ValueError(f"French has no candidates to snap to (snap {options.snap!r})")
    return ParsingAnalyzer(
        analyzer_name(parser.name),
        parser,
        lambda text, parsed: assemble(text, parsed, parser.name, options),
    )


def lexicon_source() -> Source:
    return Source()


def bundler(lexicon: Lexicon, data: Path | None) -> Bundler:
    """The paradigms are the lexicon's, from Wiktionary."""
    return lambda blob: bundle.make(blob, lexicon)


def paradigms() -> None:
    """The lexicon stores them."""
    return None
