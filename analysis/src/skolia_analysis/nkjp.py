"""Convert NKJP tags (the Polish tagset Morfeusz uses) to UD part of speech + features.

An NKJP tag is a grammatical class followed by feature values, separated by ":".
A "." inside a slot lists alternatives, so one tag can stand for several readings:

    subst:sg:nom.acc:m3   ->  noun, singular, nominative OR accusative, inanimate masculine

The conversion is approximate and value-by-value: each NKJP value maps to one UD feature
on its own. Values not listed below (e.g. wok/nwok, akc/nakc, col/ncol) are dropped.
"""

import itertools
from collections.abc import Iterator

from .schema import Feats

TAG_SEP = ":"
ALT_SEP = "."
UNKNOWN_UPOS = "X"

# NKJP grammatical class -> UD UPOS
POS = {
    "subst": "NOUN",  # noun: pies
    "depr": "NOUN",  # depreciative noun, m1 noun in a demeaning form: te chłopy
    "ger": "NOUN",  # gerund, verbal noun: robienie
    "burk": "NOUN",  # bound word, only occurs in fixed phrases: (na) wskroś
    "adj": "ADJ",  # adjective: stary
    "adja": "ADJ",  # adjective as first part of a compound: polsko(-niemiecki)
    "adjp": "ADJ",  # adjective after a preposition: (po) polsku
    "adjc": "ADJ",  # short predicative adjective: zdrów, gotów
    "pact": "ADJ",  # active participle: robiący
    "ppas": "ADJ",  # passive participle: robiony
    "winien": "ADJ",  # winien, powinien
    "adv": "ADV",  # adverb: szybko
    "num": "NUM",  # cardinal numeral: dwa
    "numcol": "NUM",  # collective numeral: dwoje
    "ppron12": "PRON",  # 1st/2nd person pronoun: ja, ty, mi
    "ppron3": "PRON",  # 3rd person pronoun: on, jej
    "siebie": "PRON",  # reflexive pronoun: siebie, sobie
    "fin": "VERB",  # non-past finite form (present if imperfective, future if perfective): idę
    "praet": "VERB",  # past "l-form": zrobił
    "impt": "VERB",  # imperative: zrób
    "imps": "VERB",  # impersonal -no/-to form: zrobiono
    "inf": "VERB",  # infinitive: pomóc
    "pcon": "VERB",  # present adverbial participle: robiąc
    "pant": "VERB",  # perfect adverbial participle: zrobiwszy
    "pred": "VERB",  # predicative: trzeba, można
    "bedzie": "AUX",  # future form of być: będę
    "aglt": "AUX",  # person ending split off a past verb: (zrobił)em
    "prep": "ADP",  # preposition: do
    "conj": "CCONJ",  # coordinating conjunction: i, ale
    "comp": "SCONJ",  # subordinating conjunction: że, bo
    "qub": "PART",  # particle: nie, się
    "interj": "INTJ",  # interjection: och
    "interp": "PUNCT",  # punctuation
    "brev": "X",  # abbreviation: np.
    "xxx": "X",  # foreign word
    "ign": "X",  # unknown to Morfeusz
}

# NKJP feature value -> (UD feature, UD value)
FEATS = {
    "sg": ("Number", "Sing"),  # singular
    "pl": ("Number", "Plur"),  # plural
    "nom": ("Case", "Nom"),  # nominative
    "gen": ("Case", "Gen"),  # genitive
    "dat": ("Case", "Dat"),  # dative
    "acc": ("Case", "Acc"),  # accusative
    "inst": ("Case", "Ins"),  # instrumental
    "loc": ("Case", "Loc"),  # locative
    "voc": ("Case", "Voc"),  # vocative
    "f": ("Gender", "Fem"),  # feminine
    "n": ("Gender", "Neut"),  # neuter
    "n1": ("Gender", "Neut"),  # neuter subtypes from older Morfeusz versions
    "n2": ("Gender", "Neut"),
    "pri": ("Person", "1"),  # primary: 1st person
    "sec": ("Person", "2"),  # secondary: 2nd person
    "ter": ("Person", "3"),  # tertiary: 3rd person
    "imperf": ("Aspect", "Imp"),  # imperfective: robić
    "perf": ("Aspect", "Perf"),  # perfective: zrobić
    "pos": ("Degree", "Pos"),  # positive: stary
    "com": ("Degree", "Cmp"),  # comparative: starszy
    "sup": ("Degree", "Sup"),  # superlative: najstarszy
    "aff": ("Polarity", "Pos"),  # affirmative gerund/participle: robienie
    "neg": ("Polarity", "Neg"),  # negated gerund/participle: nierobienie
}

# NKJP splits masculine into three genders; UD has one Masc plus Animacy
MASC_ANIMACY = {
    "m1": "Hum",  # human: student, studenta (Acc = Gen)
    "m2": "Nhum",  # animate non-human: pies, psa (Acc = Gen)
    "m3": "Inan",  # inanimate: stół, stół (Acc = Nom)
}


def expand(tag: str) -> Iterator[tuple[str, ...]]:
    slots = (slot.split(ALT_SEP) for slot in tag.split(TAG_SEP))
    return itertools.product(*slots)


def to_ud(tag: str) -> Iterator[tuple[str, Feats]]:
    for grammatical_class, *values in expand(tag):
        feats: Feats = {}
        for value in values:
            if value in MASC_ANIMACY:
                feats["Gender"] = "Masc"
                feats["Animacy"] = MASC_ANIMACY[value]
            elif value in FEATS:
                key, ud_value = FEATS[value]
                feats[key] = ud_value
        yield POS.get(grammatical_class, UNKNOWN_UPOS), feats
