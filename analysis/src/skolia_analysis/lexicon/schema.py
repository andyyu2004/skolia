"""Shape of the lexicon entries and the per-document bundle JSON."""

from typing import Literal, NotRequired, TypedDict

from ..schema import Feats, Upos
from ..walenty.model import Schema


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
    """Morfeusz's homonym label, e.g. Sm1 (pies: cop) vs Sm2 (pies: dog)."""
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


class Bundle(TypedDict):
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
