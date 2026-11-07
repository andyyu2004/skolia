"""The lexicon review cards read, which infra/load-lexicon.py puts in the API's D1 lexicon:
each entry with its lemma's pronunciations and paradigms, in the bundle's compact form, and
the feature sets the paradigms point into, one row per feature.

A paradigm's forms are ["psa", [1, 3]]: psa is feature sets 1 and 3, genitive and
accusative singular. Set 1 is the rows (1, Case, Gen), (1, Number, Sing), ... in featureset.
"""

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path

from ..schema import Feats, Upos
from .bundle import FeatsTable, compact, pronounce
from .schema import Paradigm
from .store import Lexicon

CARDS_VERSION = 1
"""Goes up when what this adds to an entry changes, so every environment loads it again."""

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE entry (
    lemma_id TEXT PRIMARY KEY,
    lemma TEXT NOT NULL,
    lemma_lower TEXT NOT NULL,
    upos TEXT NOT NULL,
    senses TEXT NOT NULL,
    relations TEXT NOT NULL,
    pronunciations TEXT NOT NULL,
    paradigms TEXT NOT NULL
);
CREATE TABLE featureset (
    id INTEGER NOT NULL,
    feature TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (id, feature)
);
"""

type Paradigms = Callable[[str, Upos], list[Paradigm]]


def version(lexicon: Lexicon) -> str:
    return f"{lexicon.version()}+cards{CARDS_VERSION}"


def build(lexicon: Lexicon, paradigms: Paradigms | None, out: Path) -> int:
    """paradigms generates a lemma's, for a language whose lexicon stores none (Polish)."""
    table: list[Feats] = []
    feats = FeatsTable(table)
    out.unlink(missing_ok=True)
    count = 0
    with sqlite3.connect(out) as db:
        db.executescript(SCHEMA)
        meta = {**lexicon.meta(), "version": version(lexicon)}
        db.executemany("INSERT INTO meta VALUES (?, ?)", meta.items())
        for row in lexicon.rows():
            found = paradigms(row.lemma, row.upos) if paradigms else row.paradigms
            db.execute(
                "INSERT INTO entry VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row.lemma_id,
                    row.lemma,
                    row.lemma.lower(),
                    row.upos,
                    _json(row.senses),
                    _json(row.relations),
                    _json(pronounce(lexicon, row.lemma, row.upos)),
                    _json([compact(p, feats) for p in found]),
                ),
            )
            count += 1
        db.executemany(
            "INSERT INTO featureset VALUES (?, ?, ?)",
            ((i, k, str(v)) for i, f in enumerate(table) for k, v in f.items()),
        )
    return count


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
