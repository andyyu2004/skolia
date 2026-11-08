"""Shape of the lexicon entries and the per-document bundle JSON."""

from typing import Literal, NotRequired, TypedDict

from ..lang.pl.walenty.model import Schema
from ..schema import Feats, Upos


class Example(TypedDict):
    text: str
    translation: NotRequired[str]


class Sense(TypedDict):
    gloss: str
    tags: list[str]
    """Wiktionary's labels: slang, dated, transitive, ..."""
    when: NotRequired[list[Feats]]
    """The sense applies to a token whose feats include any one of these, e.g. the dog
    sense of pies has [{"Gender": "Masc", "Animacy": "Nhum"}]. Absent: always applies."""
    examples: NotRequired[list[Example]]


type RelationType = Literal[
    "aspect-partner",  # robić <-> zrobić
    "derived-from",  # pani <- pan (feminine), rubelek <- rubel (diminutive)
]


class Relation(TypedDict):
    type: RelationType
    lemma: str
    note: NotRequired[str]
    """How it's derived: feminine, diminutive, noun-from-verb, ..."""


class Form(TypedDict):
    form: str
    xpos: str
    feats: Feats


class Paradigm(TypedDict):
    homonym: str
    """Tells apart a lemma's tables with different forms, e.g. Morfeusz's Sm1 (pies: cop) vs
    Sm2 (pies: dog). Empty when the lemma has one table."""
    forms: list[Form]


type FormRow = tuple[str, list[int]]
"""A form and every feature set it has, as indices into Bundle.feats:
["psa", [3, 7]] is psa as genitive and as accusative. Listing each (form, feats) pair in
full made verb paradigms ~9x bigger: a participle declines for gender, number and case."""


class BundleParadigm(TypedDict):
    """To highlight a token's form, match its text and its feats minus PronType and ExtPos,
    which the sentence decides and paradigms leave out."""

    homonym: str
    forms: list[FormRow]


type Accent = Literal["UK", "US"]


class Pronunciation(TypedDict):
    ipa: str
    """In the International Phonetic Alphabet, phonemic: /ˈpjɛs/."""
    accents: NotRequired[list[Accent]]
    """Absent when Wiktionary gives it for every accent (all of Polish's)."""


class Recording(TypedDict):
    """A Wiktionary sound with a recording, as Kaikki gives it."""

    audio: str
    """Wikimedia Commons file name: De-frei.ogg. Its page,
    commons.wikimedia.org/wiki/File:<audio>, credits the speaker and gives the licence."""
    mp3_url: str
    tags: NotRequired[list[str]]
    """Where the speaker is from, as Wiktionary tags it: Germany, Berlin."""


class Entry(TypedDict):
    lemma: str
    upos: Upos
    senses: list[Sense]
    relations: list[Relation]
    paradigms: list[BundleParadigm]
    frames: list[Schema]
    """How the word combines with others (Walenty valency schemata), for a verb both
    with and without się (Schema.reflexive). Empty when Walenty lacks the word."""


type Match = Literal[
    "exact",  # same lemma and part of speech
    "other-pos",  # same lemma, the lexicon files it under another part of speech
    "lowercase",  # the lemma lowercased (Krakowski -> krakowski)
    "none",  # no senses; the entry has only the paradigm
]


BUNDLE_SCHEMA = 1
"""The bundle's JSON shape. Documents keep their bundle until ingest redoes them, so the
reader has to read every schema still stored. Add a field as NotRequired and bump
BUNDLER_VERSION instead (pronunciations). Bump this only when the shape changes, and
keep reading the older schema in the reader until a batch re-ingest retires it."""

BUNDLER_VERSION = "4"
"""The bundle-making code's version (lexicon/bundle.py and the plugins' bundlers). Bump it
when a change gives different bundles for the same analysis and lexicon (the lookup
fallbacks, how paradigms are made). It's in every bundle's name, so a bump re-bundles each
document once; ingest reuses the analysis, so that costs a second or two a document."""


class Bundle(TypedDict):
    schema: int
    """BUNDLE_SCHEMA when it was made."""
    lang: str
    lexicon: str
    """Lexicon version: sources and their dates."""
    attribution: str
    entries: dict[str, Entry]
    """By lemma_id."""
    lookup: dict[str, str]
    """Token lemma_id -> entry lemma_id, only where they differ (other-pos, lowercase)."""
    match: dict[str, Match]
    """How each token lemma_id was resolved."""
    feats: list[Feats]
    """Every distinct feature set in the paradigms, referred to by index from FormRow."""
    pronunciations: NotRequired[dict[str, list[Pronunciation]]]
    """Absent from bundles made before bundler version 3.

    By pronunciation_key(word, upos), for each token's text and each entry's lemma that
    Wiktionary has one for. Words spelled alike can differ by part of speech (lead, the
    metal, is /lɛd/; the verb is /liːd/)."""
    recordings: NotRequired[dict[str, list[Recording]]]
    """Absent from bundles made before bundler version 4.

    By pronunciation_key, like pronunciations. Apart from them because Wiktionary doesn't
    say which transcription a recording is of."""


def pronunciation_key(word: str, upos: Upos) -> str:
    """psa, NOUN -> psa:NOUN"""
    return f"{word}:{upos}"
