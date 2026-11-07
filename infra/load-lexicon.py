#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Loads a language's lexicon into the lexicon D1 database (LEXICON in api/wrangler.jsonc):
  load-lexicon.py <staging|production|local> <sqlite>
sqlite is analysis's {lang}.sqlite (skolia-build-lexicon, or the Nix output
analysis#lexicon-{lang}); its meta table gives the language and version. Skipped if D1
already serves that version. The new version's rows go in beside the old ones, then
loaded points at it and the old rows are deleted (api/lexicon-migrations), so a load that
stops part way leaves the old version serving and can be run again. local is wrangler
dev's database. Needs the credentials infra/wrangler.sh needs.
"""

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import cast

WRANGLER = Path(__file__).resolve().parent / "wrangler.sh"
# D1's longest statement is 100 KB; the longest row is 35 KB (English)
MAX_STATEMENT_BYTES = 90_000


def wrangler(env: str, *args: str) -> str:
    target = ["--local"] if env == "local" else ["--remote"]
    command = [
        str(WRANGLER),
        "production" if env == "local" else env,
        "d1",
        "execute",
        "LEXICON",
        *target,
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
    return lang, version


def serving(env: str, lang: str) -> str | None:
    out = wrangler(
        env, "--json", "--command", f"SELECT version FROM loaded WHERE lang = {quote(lang)}"
    )
    results = cast(list[dict[str, list[dict[str, str]]]], json.loads(out))
    rows = results[0]["results"] if results else []
    return rows[0]["version"] if rows else None


def statements(db: sqlite3.Connection, lang: str, version: str) -> list[str]:
    head = "INSERT INTO entry (lemma_id, version, lang, lemma, upos, senses, relations) VALUES\n"
    out = [f"DELETE FROM entry WHERE lang = {quote(lang)} AND version = {quote(version)};"]
    values: list[str] = []
    size = len(head)
    rows = cast(
        list[tuple[str, str, str, str, str]],
        db.execute("SELECT lemma_id, lemma, upos, senses, relations FROM entry"),
    )
    for lemma_id, lemma, upos, senses, relations in rows:
        columns = (lemma_id, version, lang, lemma, upos, senses, relations)
        value = f"({', '.join(quote(v) for v in columns)})"
        if values and size + len(value.encode()) + 2 > MAX_STATEMENT_BYTES:
            out.append(head + ",\n".join(values) + ";")
            values, size = [], len(head)
        values.append(value)
        size += len(value.encode()) + 2
    if values:
        out.append(head + ",\n".join(values) + ";")
    out.append(
        f"INSERT INTO loaded (lang, version) VALUES ({quote(lang)}, {quote(version)}) "
        "ON CONFLICT (lang) DO UPDATE SET version = excluded.version;"
    )
    out.append(f"DELETE FROM entry WHERE lang = {quote(lang)} AND version != {quote(version)};")
    return out


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("staging", "production", "local"):
        raise SystemExit("usage: load-lexicon.py <staging|production|local> <sqlite>")
    env, path = sys.argv[1], Path(sys.argv[2])
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    lang, version = meta(db)
    if serving(env, lang) == version:
        print(f"{env}: {lang} already serves {version}")
        return
    with tempfile.TemporaryDirectory() as scratch:
        sql = Path(scratch) / f"lexicon-{lang}.sql"
        sql.write_text("\n".join(statements(db, lang, version)) + "\n")
        print(f"{env}: loading {lang} {version} ({sql.stat().st_size / 1e6:.0f} MB of SQL)")
        wrangler(env, "--yes", "--file", str(sql))
    if serving(env, lang) != version:
        raise SystemExit(f"{env}: {lang} doesn't serve {version} after loading it")
    print(f"{env}: {lang} serves {version}")


if __name__ == "__main__":
    main()
