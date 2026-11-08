"""Read Kaikki's Wiktionary extract: https://kaikki.org/dictionary/rawdata.html

One JSON object per line, one per (word, part of speech, etymology). Only the fields the
lexicon uses are declared. Wiktionary content is CC BY-SA 4.0 and GFDL.
"""

import json
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import TypedDict, cast

from ..schema import Number, Person, Upos

# English Wiktionary's tags and parts of speech are the same in every language's extract;
# each language adds its own to these

# Kaikki part of speech -> the UPOS the analyser gives such a word
POS: Mapping[str, Upos] = {
    "noun": "NOUN",
    "name": "PROPN",
    "verb": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "pron": "PRON",
    "det": "DET",
    "article": "DET",
    "num": "NUM",
    "prep": "ADP",
    "postp": "ADP",
    "conj": "CCONJ",
    "particle": "PART",
    "intj": "INTJ",
}

# Tags on a form-of sense that make it an inflected form ("plural of dog"). The analyser
# already gives those words the lemma, so these senses add nothing.
INFLECTION_TAGS = frozenset(
    {
        "singular",
        "plural",
        "first-person",
        "second-person",
        "third-person",
        "present",
        "past",
        "participle",
        "indicative",
        "imperative",
    }
)
# Tags that say how a form-of sense is derived, kept as the relation's note
DERIVATION_TAGS = ("diminutive", "augmentative", "feminine", "masculine")

# Forms that aren't an inflection of today's word: spellings, old forms, the extract's
# own bookkeeping rows
SKIPPED_FORM_TAGS = frozenset(
    {
        "alternative",
        "obsolete",
        "archaic",
        "dialectal",
        "nonstandard",
        "misspelling",
        "abbreviation",
        "table-tags",
        "inflection-template",
        "class",
        "romanization",
    }
)

PERSON_TAGS: Mapping[str, Person] = {"first-person": "1", "second-person": "2", "third-person": "3"}
NUMBER_TAGS: Mapping[str, Number] = {"singular": "Sing", "plural": "Plur"}


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


class KaikkiSound(TypedDict, total=False):
    ipa: str
    """/ˈpjɛs/ (phonemic) or [ˈpjɛs] (phonetic). Other sounds carry audio, rhymes, ..."""
    tags: list[str]
    """Accent or period: Received-Pronunciation, General-American, Middle Polish, ..."""
    note: str
    """Free text, e.g. a region ("Kuyavia"), "normal speech" or "prescriptive"."""
    audio: str
    """Wikimedia Commons file name of a recording: De-frei.ogg. Never on a sound with ipa."""
    mp3_url: str
    """Commons' mp3 of the recording, which every browser plays."""


class KaikkiEntry(TypedDict, total=False):
    word: str
    pos: str
    """noun, verb, adj, name (proper noun), ..."""
    senses: list[KaikkiSense]
    sounds: list[KaikkiSound]
    forms: list[KaikkiForm]
    head_templates: list[KaikkiHeadTemplate]
    etymology_number: int
    """Set when a word has several etymologies, each its own entry: 1, 2, ..."""


def read(path: Path) -> Iterator[KaikkiEntry]:
    with path.open(encoding="utf-8") as lines:
        for line in lines:
            yield cast(KaikkiEntry, json.loads(line))
