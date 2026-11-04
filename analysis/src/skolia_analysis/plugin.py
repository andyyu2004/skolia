"""What a language plugin must provide. A plugin is a module, e.g. skolia_analysis.pl.

This is the subset of the LanguagePlugin interface in ARCHITECTURE.md that the analyser uses so far.
"""

from collections.abc import Callable, Iterable, Mapping
from typing import Protocol

from .blob import CandidateLookup
from .parsed import Parser
from .schema import Blob, ExpressionDef, Reading, Token, Upos
from .valency import Valency


class LanguagePlugin(Protocol):
    @property
    def LANG(self) -> str:
        """ISO 639-1 code, e.g. "pl". Read-only so a module constant LANG = "pl" satisfies it."""
        ...

    @property
    def MODELS(self) -> Mapping[str, Callable[[], Parser]]:
        """Parser models by name; each callable loads one (slow, so call once)."""
        ...

    @property
    def DEFAULT_MODEL(self) -> str: ...

    @property
    def DEFAULT_SNAP(self) -> str | None:
        """Default reconcile policy, or None to keep the parser's readings."""
        ...

    def parser(self, model: str = ...) -> Parser: ...

    def candidate_lookup(self) -> CandidateLookup:
        """Load the lookup that lists every possible reading of each word."""
        ...

    def entry_upos(self, reading: Reading) -> Upos:
        """Part of speech of the lexicon entry a reading belongs to (its lemma_id)."""
        ...

    def expression_gap(self, token: Token) -> bool:
        """True for tokens multi-word expression matching should step over."""
        ...

    def analyze(
        self,
        text: str,
        model: Parser,
        candidates: CandidateLookup | None = None,
        expressions: Iterable[ExpressionDef] = (),
        snap: str | None = ...,
        valency: Valency | None = None,
    ) -> Blob:
        """valency: verb frames for explaining cases. Only Polish has them so far (Walenty);
        generalise the type when a second language does."""
        ...
