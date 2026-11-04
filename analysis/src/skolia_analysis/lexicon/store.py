"""The lexicon on the server: one SQLite file per language, one row per lemma_id.

Senses and relations are stored as JSON in the row: the lexicon is only ever read a whole
entry at a time. Paradigms aren't stored; Morfeusz generates them when a bundle is made.
"""

import json
import sqlite3
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import NamedTuple, cast

from ..schema import Upos
from .schema import Relation, Sense

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE entry (
    lemma_id TEXT PRIMARY KEY,
    lemma TEXT NOT NULL,
    lemma_lower TEXT NOT NULL,
    upos TEXT NOT NULL,
    senses TEXT NOT NULL,
    relations TEXT NOT NULL
);
CREATE INDEX entry_lemma ON entry (lemma);
CREATE INDEX entry_lemma_lower ON entry (lemma_lower);
"""


class Row(NamedTuple):
    lemma_id: str
    lemma: str
    upos: Upos
    senses: list[Sense]
    relations: list[Relation]


def write(path: Path, rows: Iterable[Row], meta: dict[str, str]) -> int:
    path.unlink(missing_ok=True)
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA)
        db.executemany("INSERT INTO meta VALUES (?, ?)", meta.items())
        count = 0
        for row in rows:
            db.execute(
                "INSERT INTO entry VALUES (?, ?, ?, ?, ?, ?)",
                (
                    row.lemma_id,
                    row.lemma,
                    row.lemma.lower(),
                    row.upos,
                    json.dumps(row.senses, ensure_ascii=False),
                    json.dumps(row.relations, ensure_ascii=False),
                ),
            )
            count += 1
    return count


class Lexicon:
    def __init__(self, path: Path) -> None:
        self._db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

    def meta(self) -> dict[str, str]:
        return dict(self._db.execute("SELECT key, value FROM meta").fetchall())

    def get(self, lemma_id: str) -> Row | None:
        found = self._select("WHERE lemma_id = ?", lemma_id)
        return next(found, None)

    def by_lemma(self, lemma: str) -> list[Row]:
        """Every part of speech filed under this lemma, most senses first."""
        return sorted(self._select("WHERE lemma = ?", lemma), key=lambda r: -len(r.senses))

    def by_lowercase(self, lemma: str) -> list[Row]:
        rows = self._select("WHERE lemma_lower = ?", lemma.lower())
        return sorted(rows, key=lambda r: -len(r.senses))

    def _select(self, where: str, value: str) -> Iterator[Row]:
        query = f"SELECT lemma_id, lemma, upos, senses, relations FROM entry {where}"
        for lemma_id, lemma, upos, senses, relations in self._db.execute(query, (value,)):
            yield Row(
                lemma_id,
                lemma,
                cast(Upos, upos),
                cast(list[Sense], json.loads(senses)),
                cast(list[Relation], json.loads(relations)),
            )
