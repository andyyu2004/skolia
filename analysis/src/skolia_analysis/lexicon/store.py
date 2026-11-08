"""The lexicon on the server: one SQLite file per language, one row per lemma_id.

Senses, relations and paradigms are stored as JSON in the row: the lexicon is only ever
read a whole entry at a time. A language whose paradigms are generated when a bundle is
made (Polish, by Morfeusz) stores none.
"""

import json
import sqlite3
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from typing import NamedTuple, cast

from ..schema import Upos
from .schema import Paradigm, Pronunciation, Recording, Relation, Sense

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE entry (
    lemma_id TEXT PRIMARY KEY,
    lemma TEXT NOT NULL,
    lemma_lower TEXT NOT NULL,
    upos TEXT NOT NULL,
    senses TEXT NOT NULL,
    relations TEXT NOT NULL,
    paradigms TEXT NOT NULL
);
CREATE INDEX entry_lemma ON entry (lemma);
CREATE INDEX entry_lemma_lower ON entry (lemma_lower);
CREATE TABLE pronunciation (
    word TEXT NOT NULL,
    upos TEXT NOT NULL,
    pronunciations TEXT NOT NULL,
    recordings TEXT NOT NULL,
    PRIMARY KEY (word, upos)
);
"""


class Row(NamedTuple):
    lemma_id: str
    lemma: str
    upos: Upos
    senses: list[Sense]
    relations: list[Relation]
    paradigms: list[Paradigm]


class PronunciationRow(NamedTuple):
    word: str
    """As written, an inflected form or a lemma: psa, pies."""
    upos: Upos
    pronunciations: list[Pronunciation]
    recordings: list[Recording]


def write(
    path: Path,
    rows: Iterable[Row],
    meta: dict[str, str],
    pronunciations: Callable[[], Iterable[PronunciationRow]] = lambda: (),
) -> int:
    """pronunciations is called after rows is used up: the build collects both in one pass
    over the Kaikki extract."""
    path.unlink(missing_ok=True)
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA)
        db.executemany("INSERT INTO meta VALUES (?, ?)", meta.items())
        count = 0
        for row in rows:
            db.execute(
                "INSERT INTO entry VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    row.lemma_id,
                    row.lemma,
                    row.lemma.lower(),
                    row.upos,
                    json.dumps(row.senses, ensure_ascii=False),
                    json.dumps(row.relations, ensure_ascii=False),
                    json.dumps(row.paradigms, ensure_ascii=False),
                ),
            )
            count += 1
        db.executemany(
            "INSERT INTO pronunciation VALUES (?, ?, ?, ?)",
            (
                (
                    p.word,
                    p.upos,
                    json.dumps(p.pronunciations, ensure_ascii=False),
                    json.dumps(p.recordings, ensure_ascii=False),
                )
                for p in pronunciations()
            ),
        )
    return count


class Lexicon:
    def __init__(self, path: Path) -> None:
        self._db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

    def meta(self) -> dict[str, str]:
        return dict(self._db.execute("SELECT key, value FROM meta").fetchall())

    def version(self) -> str:
        """The lexicon's version: its sources and their dates. Bundle names depend on it,
        so a lexicon without one is refused."""
        version = self.meta().get("version")
        if not version:
            raise ValueError("the lexicon has no version in its meta table")
        return version

    def get(self, lemma_id: str) -> Row | None:
        found = self._select("WHERE lemma_id = ?", lemma_id)
        return next(found, None)

    def by_lemma(self, lemma: str) -> list[Row]:
        """Every part of speech filed under this lemma, most senses first."""
        return sorted(self._select("WHERE lemma = ?", lemma), key=lambda r: -len(r.senses))

    def by_lowercase(self, lemma: str) -> list[Row]:
        rows = self._select("WHERE lemma_lower = ?", lemma.lower())
        return sorted(rows, key=lambda r: -len(r.senses))

    def pronunciations(self, word: str) -> dict[Upos, list[Pronunciation]]:
        """By part of speech: lead is /lɛd/ as a noun, /liːd/ as a verb."""
        found = self._db.execute(
            "SELECT upos, pronunciations FROM pronunciation WHERE word = ?", (word,)
        )
        return {cast(Upos, upos): json.loads(p) for upos, p in found if p != "[]"}

    def recordings(self, word: str) -> dict[Upos, list[Recording]]:
        found = self._db.execute(
            "SELECT upos, recordings FROM pronunciation WHERE word = ?", (word,)
        )
        return {cast(Upos, upos): json.loads(r) for upos, r in found if r != "[]"}

    def rows(self) -> Iterator[Row]:
        """Every entry, by lemma_id."""
        return self._select("ORDER BY lemma_id")

    def _select(self, where: str, *values: str) -> Iterator[Row]:
        query = f"SELECT lemma_id, lemma, upos, senses, relations, paradigms FROM entry {where}"
        for lemma_id, lemma, upos, senses, relations, paradigms in self._db.execute(query, values):
            yield Row(
                lemma_id,
                lemma,
                cast(Upos, upos),
                cast(list[Sense], json.loads(senses)),
                cast(list[Relation], json.loads(relations)),
                cast(list[Paradigm], json.loads(paradigms)),
            )
