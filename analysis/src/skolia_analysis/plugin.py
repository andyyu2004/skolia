"""What a language plugin must provide. A plugin is a module, e.g. skolia_analysis.pl.

This is the subset of the LanguagePlugin interface in ARCHITECTURE.md that the analyser uses so far.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import TYPE_CHECKING, Protocol

from .blob import CandidateLookup
from .schema import Blob, ExpressionDef, Token

if TYPE_CHECKING:
    from stanza.models.common.doc import Document


class LanguagePlugin(Protocol):
    @property
    def LANG(self) -> str:
        """ISO 639-1 code, e.g. "pl". Read-only so a module constant LANG = "pl" satisfies it."""
        ...

    def pipeline(self) -> Callable[[str], Document]:
        """Load the parser: text in, parsed Document out. Slow, so call once."""
        ...

    def candidate_lookup(self) -> CandidateLookup:
        """Load the lookup that lists every possible reading of each word."""
        ...

    def expression_gap(self, token: Token) -> bool:
        """True for tokens multi-word expression matching should step over."""
        ...

    def analyze(
        self,
        text: str,
        nlp: Callable[[str], Document],
        candidates: CandidateLookup | None = None,
        expressions: Iterable[ExpressionDef] = (),
    ) -> Blob: ...
