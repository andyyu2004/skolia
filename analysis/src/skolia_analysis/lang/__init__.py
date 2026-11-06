"""The language plugins, one package each. Each is imported only when asked for, so an
image can leave out the libraries of languages it doesn't serve."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # Only for the type: plugin.py imports the lexicon schema, which imports from lang/
    from ..plugin import LanguagePlugin

LANGS = ("pl",)


def plugin(lang: str) -> LanguagePlugin:
    match lang:
        case "pl":
            from .pl import plugin as pl

            return pl
        case _:
            raise KeyError(f"no plugin for language {lang!r}; known: {', '.join(LANGS)}")
