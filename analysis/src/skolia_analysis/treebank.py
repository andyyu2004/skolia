"""Running the analyser over a UD treebank's text, for the scripts that score it."""

import hashlib
import pickle
from collections.abc import Callable
from pathlib import Path
from typing import cast

from .parsed import ParsedSentence, Parser


def gold_text(gold: Path) -> str:
    """The raw text of every sentence in a CoNLL-U file, one sentence per paragraph."""
    prefix = "# text = "
    lines = gold.read_text(encoding="utf-8").splitlines()
    return "\n\n".join(line.removeprefix(prefix) for line in lines if line.startswith(prefix))


class CachedParser:
    """Keeps a parser's output on disk, keyed by language, model and input text, so
    comparing settings doesn't re-run slow models."""

    def __init__(self, lang: str, model: str, load: Callable[[], Parser], cache: Path) -> None:
        self._key = f"{lang}-{model}"
        self._load_parser = load
        self._cache = cache
        self._parser: Parser | None = None

    def _load(self) -> Parser:
        if self._parser is None:
            self._parser = self._load_parser()
        return self._parser

    @property
    def name(self) -> str:
        return self._load().name

    def __call__(self, text: str) -> list[ParsedSentence]:
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
        path = self._cache / f"{self._key}-{digest}.pickle"
        if path.exists():
            with path.open("rb") as f:
                return cast(list[ParsedSentence], pickle.load(f))
        parsed = self._load()(text)
        self._cache.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as f:
            pickle.dump(parsed, f)
        return parsed
