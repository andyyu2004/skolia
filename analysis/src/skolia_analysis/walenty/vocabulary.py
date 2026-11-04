"""Every closed set in Walenty's notation (release 2018-07-26), as Literal types.

Values are the ones found in the data, not guessed. The parser checks each value with the
is_* functions below, so a value a newer release adds is a parse error until it's added.
"""

from typing import Literal, NewType, TypeGuard, cast, get_args

type PartOfSpeech = Literal["verb", "noun", "adj", "adv"]
"""Which Walenty file a schema comes from."""

type Certainty = Literal["certain", "doubtful", "colloquial", "archaic", "vulgar", "wrong"]
"""How sure the schema is. "wrong" schemata are kept in Walenty as warnings."""

CERTAINTY: dict[str, Certainty] = {
    "pewny": "certain",
    "wątpliwy": "doubtful",
    "potoczny": "colloquial",
    "archaiczny": "archaic",
    "wulgarny": "vulgar",
    "zły": "wrong",
    # The expansions file uses the feminine forms
    "pewna": "certain",
    "wątpliwa": "doubtful",
    "potoczna": "colloquial",
    "archaiczna": "archaic",
}

ANY = "_"
"""Walenty's "any value" for aspect, negation, number, gender and degree."""

type Aspect = Literal["perf", "imperf", "any"]
type Negation = Literal["aff", "neg", "any"]
"""aff: only without nie; neg: only with nie."""

type Label = Literal[
    "subj", "obj", "controller", "controllee", "controller2", "controllee2", "head"
]  # fmt: skip
"""subj: the subject. obj: the object that becomes the subject of the passive.
controller/controllee: in pomagam ci pisać, ci (controller) is who does pisać
(controllee). controller2/controllee2: a second such pair in the same schema (uważać
kogoś za mądrego: kogoś is mądry). head: what a position of a noun schema depends on."""

type CaseSpec = Literal[
    "nom", "gen", "dat", "acc", "inst", "loc", "str", "part", "agr", "pred", "postp"
]  # fmt: skip
"""A phrase's case. Beyond the six cases:
str    structural: nominative for a subject, accusative for an object, genitive when the
       verb is negated (mam czas / nie mam czasu)
part   partitive: genitive (some of) or accusative (all of): nalać wody / wodę
agr    agrees with what it depends on
pred   predicative: nominative or instrumental after być
postp  the special form after po: po polsku"""

type Preposition = Literal[
    "na", "z", "w", "do", "o", "za", "dla", "od", "po", "przez", "przed", "co do", "wobec",
    "nad", "względem", "między", "jako", "przeciw", "pod", "u", "przy", "wskutek", "ku",
    "wokół", "wśród", "spod", "bez", "śród", "pomiędzy", "dzięki", "pośród", "według",
    "poza", "wśrzód", "koło", "spośród", "poprzez", "ponad", "spomiędzy", "podczas",
    "sprzed", "wpośród", "wewnątrz", "zza", "dookoła", "per", "znad", "powyżej", "naokoło",
    "wkoło", "jak", "poniżej", "obok", "spoza", "dokoła", "mimo", "naprzeciw", "niż",
    "wzdłuż",
    # Only in the expansions file (the realisations of adverbials and complex prepositions)
    "lada", "naokół", "niedaleko", "niedaleko od", "nieopodal", "około", "opodal",
    "pobocz", "pobok", "podal", "podle", "popod", "pośrodku", "skroś", "sponad", "spopod",
    "via", "vis-à-vis", "wedle", "wokoło", "wskroś", "wskróś", "z dala od", "z daleka od",
]  # fmt: skip

ComplexPreposition = NewType("ComplexPreposition", str)
"""A multi-word preposition: na temat, w stosunku do. The expansions file defines each
one's structure (197 of them); the parser checks names against it."""

type Complementizer = Literal[
    "że", "żeby", "żeby2", "int", "rel", "jak", "kiedy", "gdy", "jakoby", "jeśli", "bo",
    "aż", "jakby", "zanim", "dopóki",
]  # fmt: skip
"""What introduces a clause, as cp(że). int: an indirect question (czy, co, kto ...);
rel: a relative clause. żeby2: a żeby clause that can also be a że clause in the
indicative (chcę, żeby przyszedł / mówił, że przyjdzie)."""

type WhWord = Literal[
    "co", "czemu", "czy", "czyj", "dlaczego", "dokąd", "gdzie", "ile", "jak", "jaki",
    "kiedy", "kto", "którędy", "który", "odkąd", "skąd", "jakoby", "jakby",
]  # fmt: skip
"""Question and relative words: what cp(int) and cp(rel) can start with (the int and rel
lists in the expansions file), and what cp(int[co;kto]) limits a clause to."""

type AdverbialCategory = Literal[
    "locat", "adl", "abl", "perl", "temp", "dur", "mod", "caus", "instr", "dest", "misc", "pron"
]  # fmt: skip
"""locat: where. adl: where to. abl: where from. perl: which way. temp: when. dur: how
long. mod: how. caus: why. instr: with what. dest: what for. misc: other. pron: a
pronominal adverb."""

type Comparator = Literal["jak", "jako", "niż", "co"]

type NumberSpec = Literal["sg", "pl", "agr", "any"]
type GenderSpec = Literal["m1", "m2", "m3", "f", "n", "agr", "any"]
type DegreeSpec = Literal["pos", "com", "sup", "agr", "any"]

type Atom = Literal["possp", "refl", "recip", "or", "nonch", "E", "distrp", "qub"]
"""Phrases without arguments.
possp   a possessive (mój, czyj, a genitive noun)
refl    się as a reflexive object      recip  się meaning "each other"
or      direct speech (oratio recta)    nonch  a non-chosen pronoun (coś, nic, wszystko)
E       no subject at all               distrp distributive po (po jabłku)
qub     a particle (only inside lex)"""

type Modifiability = Literal["natr", "atr", "atr1", "ratr", "ratr1"]
"""Whether a fixed word in an idiom takes modifiers.
natr   none                       atr    any of the listed, optionally
atr1   at most one of the listed  ratr   at least the listed (required)
ratr1  exactly one of the listed"""

Lemma = NewType("Lemma", str)
"""A dictionary form as Walenty writes it: 'rada', 'bóg'."""


def literal_values(alias: object) -> frozenset[str]:
    """All strings in a Literal, unwrapping `type X = ...` aliases."""
    while hasattr(alias, "__value__"):
        alias = cast(object, alias.__value__)  # pyright: ignore[reportAttributeAccessIssue]
    return frozenset(cast(tuple[str, ...], get_args(alias)))


ASPECTS = literal_values(Aspect)
NEGATIONS = literal_values(Negation)
LABELS = literal_values(Label)
CASE_SPECS = literal_values(CaseSpec)
PREPOSITIONS = literal_values(Preposition)
COMPLEMENTIZERS = literal_values(Complementizer)
WH_WORDS = literal_values(WhWord)
ADVERBIAL_CATEGORIES = literal_values(AdverbialCategory)
COMPARATORS = literal_values(Comparator)
NUMBERS = literal_values(NumberSpec)
GENDERS = literal_values(GenderSpec)
DEGREES = literal_values(DegreeSpec)
ATOMS = literal_values(Atom)
MODIFIABILITIES = literal_values(Modifiability)


def is_aspect(value: str) -> TypeGuard[Aspect]:
    return value in ASPECTS


def is_negation(value: str) -> TypeGuard[Negation]:
    return value in NEGATIONS


def is_label(value: str) -> TypeGuard[Label]:
    return value in LABELS


def is_case_spec(value: str) -> TypeGuard[CaseSpec]:
    return value in CASE_SPECS


def is_preposition(value: str) -> TypeGuard[Preposition]:
    return value in PREPOSITIONS


def is_complementizer(value: str) -> TypeGuard[Complementizer]:
    return value in COMPLEMENTIZERS


def is_wh_word(value: str) -> TypeGuard[WhWord]:
    return value in WH_WORDS


def is_adverbial_category(value: str) -> TypeGuard[AdverbialCategory]:
    return value in ADVERBIAL_CATEGORIES


def is_comparator(value: str) -> TypeGuard[Comparator]:
    return value in COMPARATORS


def is_number(value: str) -> TypeGuard[NumberSpec]:
    return value in NUMBERS


def is_gender(value: str) -> TypeGuard[GenderSpec]:
    return value in GENDERS


def is_degree(value: str) -> TypeGuard[DegreeSpec]:
    return value in DEGREES


def is_atom(value: str) -> TypeGuard[Atom]:
    return value in ATOMS


def is_modifiability(value: str) -> TypeGuard[Modifiability]:
    return value in MODIFIABILITIES
