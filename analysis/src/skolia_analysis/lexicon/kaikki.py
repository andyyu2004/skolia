"""Read Kaikki's Wiktionary extract: https://kaikki.org/dictionary/rawdata.html

One JSON object per line, one per (word, part of speech, etymology). Only the fields the
lexicon uses are declared. Wiktionary content is CC BY-SA 4.0 and GFDL.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import TypedDict, cast


class KaikkiForm(TypedDict, total=False):
    form: str
    tags: list[str]


class KaikkiTarget(TypedDict, total=False):
    word: str


class KaikkiExample(TypedDict, total=False):
    text: str
    english: str
    translation: str


class KaikkiSense(TypedDict, total=False):
    glosses: list[str]
    """Parent sense first for a subsense: ["to work; to toil", "to work on (...)"]."""
    tags: list[str]
    form_of: list[KaikkiTarget]
    """Set when the sense points at another word: "genitive plural of kuna",
    "diminutive of rubel", "female equivalent of pan"."""
    alt_of: list[KaikkiTarget]
    """Set for spelling variants: "alternative form of X"."""
    examples: list[KaikkiExample]


class KaikkiHeadTemplate(TypedDict, total=False):
    name: str
    """Wiktionary template, e.g. pl-noun."""
    args: dict[str, str]


class KaikkiEntry(TypedDict, total=False):
    word: str
    pos: str
    """noun, verb, adj, name (proper noun), ..."""
    senses: list[KaikkiSense]
    forms: list[KaikkiForm]
    head_templates: list[KaikkiHeadTemplate]
    etymology_number: int
    """Set when a word has several etymologies, each its own entry: 1, 2, ..."""


def read(path: Path) -> Iterator[KaikkiEntry]:
    with path.open(encoding="utf-8") as lines:
        for line in lines:
            yield cast(KaikkiEntry, json.loads(line))
