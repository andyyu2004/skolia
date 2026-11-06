"""Convert NKJP tags (the Polish tagset Morfeusz uses) to UD part of speech + features.

An NKJP tag is a grammatical class followed by feature values, separated by ":".
A "." inside a slot lists alternatives, so one tag can stand for several readings:

    subst:sg:nom.acc:m3   ->  noun, singular, nominative OR accusative, inanimate masculine

The output follows the conventions of the UD Polish PDB treebank (what Stanza is trained
on), so a dictionary reading can be compared directly with the parser's reading.
scripts/pl/eval_candidates.py measures how often it matches.

The tag alone can't say whether "ten" is a determiner or "co" a pronoun; those
lemma-specific rules live in function_words.py.
"""

import itertools
from collections.abc import Iterator
from typing import NamedTuple

from ...schema import Feats, Upos
from . import function_words

TAG_SEP = ":"
ALT_SEP = "."

# NKJP grammatical class -> UD UPOS
POS: dict[str, Upos] = {
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
    "winien": "VERB",  # winien, powinien
    "adv": "ADV",  # adverb: szybko
    "num": "NUM",  # numeral: dwa, dwoje
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
    "part": "PART",  # particle: nie, się, by (newer tagsets)
    "qub": "PART",  # particle (older name for part)
    "interj": "INTJ",  # interjection: och
    "interp": "PUNCT",  # punctuation
    "brev": "X",  # abbreviation: np.
    "dig": "X",  # number written in digits: 12
    "romandig": "X",  # Roman numeral: XII
    "sym": "SYM",  # symbol
    "frag": "X",  # fragment of a word
    "xxx": "X",  # foreign word
    "ign": "X",  # unknown to Morfeusz
}

# Features every word of a class has, whatever the rest of the tag says
CLASS_FEATS: dict[str, Feats] = {
    "fin": {"Mood": "Ind", "VerbForm": "Fin", "Voice": "Act"},
    "praet": {"Mood": "Ind", "Tense": "Past", "VerbForm": "Fin", "Voice": "Act"},
    "impt": {"Mood": "Imp", "VerbForm": "Fin", "Voice": "Act"},
    "imps": {"Mood": "Ind", "Person": "0", "Tense": "Past", "VerbForm": "Fin", "Voice": "Act"},
    "inf": {"VerbForm": "Inf", "Voice": "Act"},
    "pcon": {"Tense": "Pres", "VerbForm": "Conv", "Voice": "Act"},
    "pant": {"Tense": "Past", "VerbForm": "Conv", "Voice": "Act"},
    "pred": {"Mood": "Ind", "Tense": "Pres", "VerbForm": "Fin", "VerbType": "Quasi"},
    "winien": {
        "Mood": "Ind",
        "Tense": "Pres",
        "VerbForm": "Fin",
        "VerbType": "Mod",
        "Voice": "Act",
    },
    "bedzie": {"Mood": "Ind", "Tense": "Fut", "VerbForm": "Fin"},
    "pact": {"VerbForm": "Part", "Voice": "Act"},
    "ppas": {"VerbForm": "Part", "Voice": "Pass"},
    "ger": {"VerbForm": "Vnoun"},
    "ppron12": {"PronType": "Prs"},
    "ppron3": {"PronType": "Prs"},
    "siebie": {"PronType": "Prs", "Reflex": "Yes"},
    "prep": {"AdpType": "Prep"},
    "num": {"NumForm": "Word"},
    "adja": {"Hyph": "Yes"},
    "adjp": {"PrepCase": "Pre"},
    "adjc": {"Variant": "Short"},
    "brev": {"Abbr": "Yes"},
    "dig": {"NumForm": "Digit"},
    "romandig": {"NumForm": "Roman"},
}

# NKJP tag value -> the UD features it sets. Values not listed (congr, rec, ncol, agl,
# nagl, pun, npun) have no UD counterpart in the PDB conventions.
VALUE_FEATS: dict[str, Feats] = {
    "sg": {"Number": "Sing"},  # singular
    "pl": {"Number": "Plur"},  # plural
    "pt": {"Number": "Ptan"},  # plurale tantum, overrides pl: drzwi
    "nom": {"Case": "Nom"},  # nominative
    "gen": {"Case": "Gen"},  # genitive
    "dat": {"Case": "Dat"},  # dative
    "acc": {"Case": "Acc"},  # accusative
    "inst": {"Case": "Ins"},  # instrumental
    "loc": {"Case": "Loc"},  # locative
    "voc": {"Case": "Voc"},  # vocative
    "m1": {"Gender": "Masc", "Animacy": "Hum"},  # human masculine: student
    "m2": {"Gender": "Masc", "Animacy": "Nhum"},  # animate masculine: pies
    "m3": {"Gender": "Masc", "Animacy": "Inan"},  # inanimate masculine: stół
    "f": {"Gender": "Fem"},  # feminine
    "n": {"Gender": "Neut"},  # neuter
    "n1": {"Gender": "Neut"},  # neuter subtypes from older Morfeusz versions
    "n2": {"Gender": "Neut"},
    "pri": {"Person": "1"},  # primary: 1st person
    "sec": {"Person": "2"},  # secondary: 2nd person
    "ter": {"Person": "3"},  # tertiary: 3rd person
    "imperf": {"Aspect": "Imp"},  # imperfective: robić
    "perf": {"Aspect": "Perf"},  # perfective: zrobić
    "pos": {"Degree": "Pos"},  # positive: stary
    "com": {"Degree": "Cmp"},  # comparative: starszy
    "sup": {"Degree": "Sup"},  # superlative: najstarszy
    "aff": {"Polarity": "Pos"},  # affirmative gerund/participle: robienie
    "neg": {"Polarity": "Neg"},  # negated gerund/participle: nierobienie
    "akc": {"Variant": "Long"},  # accented pronoun form: jego, mnie
    "nakc": {"Variant": "Short"},  # unaccented pronoun form: go, mi
    "wok": {"Variant": "Long"},  # vocalic form: we, ze, (zrobił)em
    "nwok": {"Variant": "Short"},  # non-vocalic form: w, z, (zrobiła)m
    "praep": {"PrepCase": "Pre"},  # pronoun form after a preposition: (do) niego
    "npraep": {"PrepCase": "Npr"},  # pronoun form elsewhere: jego
    "col": {"NumType": "Sets"},  # collective: dwoje
}

# Participles (robiący, robiony) and gerunds (robienie) are tagged ADJ and NOUN but have the
# verb as lemma (the PDB convention), and for a learner they are forms of the verb
VERB_FORM_CLASSES = {"pact", "ppas", "ger"}


def expand(tag: str) -> Iterator[tuple[str, ...]]:
    slots = (slot.split(ALT_SEP) for slot in tag.split(TAG_SEP))
    return itertools.product(*slots)


def tag_class(tag: str) -> str:
    return tag.split(TAG_SEP, 1)[0]


class UdReading(NamedTuple):
    upos: Upos
    feats: Feats
    xpos: str
    """The NKJP tag with alternatives resolved: "subst:sg:nom.acc:m3" -> "subst:sg:acc:m3"."""


def to_ud(tag: str, lemma: str, proper_name: bool = False) -> Iterator[UdReading]:
    """All UD readings of one NKJP tag for a given lemma.

    proper_name: Morfeusz labelled the reading as a name (place, person, ...), so a noun
    becomes PROPN.
    """
    for slots in expand(tag):
        grammatical_class, *values = slots
        feats: Feats = {}
        feats.update(CLASS_FEATS.get(grammatical_class, {}))
        for value in values:
            feats.update(VALUE_FEATS.get(value, {}))
        if grammatical_class == "prep":
            # UD Polish keeps the case a preposition governs out of FEATS (it's in xpos)
            feats.pop("Case", None)
        if grammatical_class == "fin":
            feats["Tense"] = "Fut" if feats.get("Aspect") == "Perf" else "Pres"
        upos = POS.get(grammatical_class, "X")
        if upos == "NOUN" and proper_name:
            upos = "PROPN"
        xpos = TAG_SEP.join(slots)
        for final_upos, final_feats in function_words.adjust(grammatical_class, lemma, upos, feats):
            yield UdReading(final_upos, final_feats, xpos)
