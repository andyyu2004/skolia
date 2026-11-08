#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["wordfreq==3.1.1"]
# ///
"""Loads a language's lexicon into its D1 database (LEXICON_{LANG} in api/wrangler.jsonc):
  load-lexicon.py <staging|production|pr-N|local> <sqlite> [--sample N] [--persist-to DIR]
sqlite is analysis's {lang}.cards.sqlite (skolia-build-cards, or the Nix output
analysis#cards-lexicon-{lang}); its meta table gives the language and version. Skipped if D1
already serves that version. The new version's rows go in beside the old ones, then
loaded points at it and the old rows are deleted in batches (api/lexicon-migrations), so a
load that stops part way leaves the old version serving and can be run again. local is wrangler
dev's database, or with --persist-to, the one in DIR (api/scripts/e2e.sh). --sample loads only the entries for wordfreq's N most common words, for
previews, and their version ends in +sampleN. Needs the credentials infra/wrangler.sh needs.
"""

import argparse
import json
import re
import sqlite3
import subprocess
import tempfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import wordfreq

WRANGLER = Path(__file__).resolve().parent / "wrangler.sh"
# D1's longest statement is 100 KB; the longest row is 35 KB (English)
MAX_STATEMENT_BYTES = 90_000
# Old rows deleted per statement, so no one statement deletes a whole language
CLEAN_BATCH = 50_000


@dataclass(frozen=True)
class Target:
    """A language's lexicon database in an environment. persist_to: wrangler dev's state
    directory, for local."""

    env: str
    lang: str
    persist_to: Path | None = None


def wrangler(target: Target, *args: str) -> str:
    where = ["--remote"]
    if target.env == "local":
        where = ["--local"]
        if target.persist_to is not None:
            where += ["--persist-to", str(target.persist_to.resolve())]
    command = [
        str(WRANGLER),
        "production" if target.env == "local" else target.env,
        "d1",
        "execute",
        f"LEXICON_{target.lang.upper()}",
        *where,
        *args,
    ]
    return subprocess.run(command, stdout=subprocess.PIPE, text=True, check=True).stdout


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def meta(db: sqlite3.Connection) -> tuple[str, str]:
    rows = dict(cast(list[tuple[str, str]], db.execute("SELECT key, value FROM meta").fetchall()))
    lang, version = rows.get("lang"), rows.get("version")
    if lang is None or version is None:
        raise SystemExit("the lexicon's meta table has no lang or version")
    if not re.fullmatch(r"[a-z]+", lang):
        raise SystemExit(f"the lexicon's lang isn't a language code: {lang}")
    return lang, version


def serving(target: Target) -> str | None:
    out = wrangler(target, "--json", "--command", "SELECT version FROM loaded")
    results = cast(list[dict[str, list[dict[str, str]]]], json.loads(out))
    rows = results[0]["results"] if results else []
    return rows[0]["version"] if rows else None


def selection(lang: str, sample: int | None) -> str:
    columns = "SELECT lemma_id, lemma, upos, senses, relations, pronunciations, paradigms FROM entry"
    if sample is None:
        return columns
    # A word's every entry (run the noun and the verb), not its proper nouns
    words = json.dumps(wordfreq.top_n_list(lang, sample))
    return (
        f"{columns} WHERE upos != 'PROPN' "
        f"AND lemma_lower IN (SELECT value FROM json_each({quote(words)}))"
    )


def statements(
    db: sqlite3.Connection, lang: str, version: str, sample: int | None
) -> list[str]:
    which = f"version = {quote(version)}"
    out = [f"DELETE FROM entry WHERE {which};", f"DELETE FROM featureset WHERE {which};"]
    entries = cast(list[tuple[str, ...]], db.execute(selection(lang, sample)))
    out += inserts(
        "INSERT INTO entry (lemma_id, version, lemma, upos, senses, relations, "
        "pronunciations, paradigms) VALUES",
        ((lemma_id, version, *rest) for lemma_id, *rest in entries),
    )
    features = cast(list[tuple[int, str, str]], db.execute("SELECT id, feature, value FROM featureset"))
    out += inserts(
        "INSERT INTO featureset (version, id, feature, value) VALUES",
        ((version, str(i), feature, value) for i, feature, value in features),
        numeric=frozenset({1}),
    )
    out.append(
        f"INSERT INTO loaded (id, version) VALUES (1, {quote(version)}) "
        "ON CONFLICT (id) DO UPDATE SET version = excluded.version;"
    )
    return out


def inserts(
    head: str, rows: Iterable[Sequence[str]], numeric: frozenset[int] = frozenset()
) -> list[str]:
    """Multi-row INSERTs, each under D1's longest statement. Columns in numeric aren't quoted."""
    out: list[str] = []
    values: list[str] = []
    size = len(head) + 1
    for row in rows:
        cells = (v if i in numeric else quote(v) for i, v in enumerate(row))
        value = f"({', '.join(cells)})"
        if values and size + len(value.encode()) + 2 > MAX_STATEMENT_BYTES:
            out.append(head + "\n" + ",\n".join(values) + ";")
            values, size = [], len(head) + 1
        values.append(value)
        size += len(value.encode()) + 2
    if values:
        out.append(head + "\n" + ",\n".join(values) + ";")
    return out


def clean(target: Target, version: str) -> None:
    """Deletes the rows of other versions, in batches. Run on every load, so a load that
    stopped after repointing loaded is cleaned up by the next."""
    old = f"FROM entry WHERE version != {quote(version)}"
    batch = f"SELECT lemma_id, version {old} LIMIT {CLEAN_BATCH}"
    delete = f"DELETE FROM entry WHERE (lemma_id, version) IN ({batch})"
    # wrangler's local output doesn't count a delete's changes, so ask what's left
    count = f"SELECT count(*) AS n {old}"
    while (left := remaining(target, count)) > 0:
        print(f"{target.env}: deleting {left} old {target.lang} rows")
        wrangler(target, "--command", delete)
    # A few thousand rows per version
    wrangler(target, "--command", f"DELETE FROM featureset WHERE version != {quote(version)}")


def remaining(target: Target, count: str) -> int:
    results = cast(
        list[dict[str, list[dict[str, int]]]],
        json.loads(wrangler(target, "--json", "--command", count)),
    )
    return results[0]["results"][0]["n"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Loads a language's lexicon into its D1 database.")
    parser.add_argument("env", help="staging, production, pr-N or local")
    parser.add_argument("sqlite", type=Path, help="analysis's {lang}.cards.sqlite")
    parser.add_argument("--sample", type=int, help="only wordfreq's N most common words")
    parser.add_argument("--persist-to", type=Path, help="wrangler dev's state directory (local)")
    args = parser.parse_args()
    env = cast(str, args.env)
    path = cast(Path, args.sqlite)
    sample = cast(int | None, args.sample)
    persist_to = cast(Path | None, args.persist_to)
    if not re.fullmatch(r"staging|production|pr-[0-9]+|local", env):
        parser.error("env must be staging, production, pr-N or local")
    if persist_to is not None and env != "local":
        parser.error("--persist-to is for local")
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    lang, version = meta(db)
    target = Target(env, lang, persist_to)
    if sample is not None:
        version = f"{version}+sample{sample}"
    if serving(target) == version:
        print(f"{env}: {lang} already serves {version}")
        clean(target, version)
        return
    with tempfile.TemporaryDirectory() as scratch:
        sql = Path(scratch) / f"lexicon-{lang}.sql"
        sql.write_text("\n".join(statements(db, lang, version, sample)) + "\n")
        print(f"{env}: loading {lang} {version} ({sql.stat().st_size / 1e6:.0f} MB of SQL)")
        wrangler(target, "--yes", "--file", str(sql))
    if serving(target) != version:
        raise SystemExit(f"{env}: {lang} doesn't serve {version} after loading it")
    print(f"{env}: {lang} serves {version}")
    clean(target, version)

if __name__ == "__main__":
    main()
