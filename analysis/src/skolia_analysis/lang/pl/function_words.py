"""Polish words whose UD reading depends on the lemma, not just the NKJP tag.

Morfeusz tags "ten" as an ordinary adjective and "co" as an ordinary noun; UD treats them
as a determiner and a pronoun with a PronType. These are closed classes (a fixed, small set
of function words), so they are listed here. The readings follow the UD Polish PDB
conventions. A lemma with several entries is ambiguous out of context (co: "what?" or
"which"), so it gets one reading per entry.
"""

from collections.abc import Iterator
from typing import Literal

from ...schema import Feats, Upos

type PosFeats = tuple[Upos, Feats]

DEM: Feats = {"PronType": "Dem"}  # demonstrative: ten, tam
REL: Feats = {"PronType": "Rel"}  # relative: który (the one which)
INT: Feats = {"PronType": "Int"}  # interrogative: który? (which?)
IND: Feats = {"PronType": "Ind"}  # indefinite: ktoś, jakiś
TOT: Feats = {"PronType": "Tot"}  # total: wszystko, każdy
NEG: Feats = {"PronType": "Neg"}  # negative: nic, żaden

# NKJP noun (subst) -> UD PRON
PRONOUN_NOUNS: dict[str, list[Feats]] = {
    "to": [DEM],
    "co": [INT, REL],
    "kto": [INT, REL],
    "cóż": [INT],
    "coś": [IND],
    "ktoś": [IND],
    "cokolwiek": [IND],
    "ktokolwiek": [IND],
    "nic": [NEG],
    "nikt": [NEG],
    "wszystko": [TOT],
    "wszyscy": [TOT],
}

# NKJP adjective (adj) -> UD DET, without Degree
DETERMINER_ADJECTIVES: dict[str, list[Feats]] = {
    "ten": [DEM],
    "taki": [DEM],
    "tamten": [DEM],
    "tenże": [DEM],
    "ów": [DEM],
    "który": [REL, INT],
    "jaki": [REL, INT],
    "jakiś": [IND],
    "jakikolwiek": [IND],
    "któryś": [IND],
    "pewien": [IND],
    "niektóry": [IND],
    "niejaki": [IND],
    "niejeden": [IND],
    "każdy": [TOT],
    "wszystek": [TOT],
    "wszelki": [TOT],
    "żaden": [NEG],
    "mój": [{"Person": "1", "Number[psor]": "Sing", "Poss": "Yes", "PronType": "Prs"}],
    "twój": [{"Person": "2", "Number[psor]": "Sing", "Poss": "Yes", "PronType": "Prs"}],
    "nasz": [{"Person": "1", "Number[psor]": "Plur", "Poss": "Yes", "PronType": "Prs"}],
    "wasz": [{"Person": "2", "Number[psor]": "Plur", "Poss": "Yes", "PronType": "Prs"}],
    "swój": [{"Poss": "Yes", "PronType": "Prs", "Reflex": "Yes"}],
    "czyjś": [{"Poss": "Yes", "PronType": "Ind"}],
}

# NKJP numeral (num) -> UD DET, without NumForm
DETERMINER_NUMERALS: dict[str, list[Feats]] = {
    "ile": [{"NumType": "Card", "PronType": "Int"}],
    "tyle": [{"NumType": "Card", "PronType": "Dem"}],
    "kilka": [IND],
    "kilkanaście": [IND],
    "kilkadziesiąt": [IND],
    "kilkaset": [IND],
    "parę": [IND],
    "wiele": [IND],
    "niewiele": [IND],
    "więcej": [IND],
    "mniej": [IND],
    "dużo": [IND],
    "mało": [IND],
    "sporo": [IND],
    "trochę": [IND],
    "oba": [IND],
}

# NKJP adverb (adv) that UD marks with a PronType
PRONOMINAL_ADVERBS: dict[str, list[Feats]] = {
    "tak": [DEM],
    "tam": [DEM],
    "tu": [DEM],
    "tutaj": [DEM],
    "wtedy": [DEM],
    "wówczas": [DEM],
    "dlatego": [DEM],
    "stąd": [DEM],
    "stamtąd": [DEM],
    "dotąd": [DEM],
    "odtąd": [DEM],
    "kiedy": [INT, REL],
    "jak": [INT, REL],
    "gdzie": [INT, REL],
    "skąd": [INT, REL],
    "dlaczego": [INT],
    "czemu": [INT],
    "odkąd": [INT],
    "dokąd": [INT],
    "którędy": [INT],
    "jakże": [INT],
    "gdzieś": [IND],
    "kiedyś": [IND],
    "jakoś": [IND],
    "kiedykolwiek": [IND],
    "niekiedy": [IND],
    "nigdy": [NEG],
    "nigdzie": [NEG],
    "zawsze": [TOT],
    "wszędzie": [TOT],
}

# Conjunctions introducing a comparison (Comp: większy niż, jak) or a predicate (Pred: jako)
COMPARATIVE_CONJUNCTIONS: dict[str, list[Feats]] = {
    "jako": [{"ConjType": "Pred"}],
    "jak": [{"ConjType": "Comp"}, {}],  # also plain "how": nie wiem, jak
    "niż": [{"ConjType": "Comp"}],
    "aniżeli": [{"ConjType": "Comp"}],
    "jakby": [{"ConjType": "Comp"}],
    "jakoby": [{"ConjType": "Comp"}],
    "niczym": [{"ConjType": "Comp"}],
}

# Adpositions that follow their noun: dwa lata temu
POSTPOSITIONS: dict[str, Feats] = {
    "temu": {"AdpType": "Post", "Case": "Acc"},
}

# NKJP particle (part / qub). Anything not listed is a plain PART.
PARTICLES: dict[str, list[PosFeats]] = {
    "się": [("PRON", {"PronType": "Prs", "Reflex": "Yes"})],
    "nie": [("PART", {"Polarity": "Neg"})],
    "by": [("AUX", {})],  # conditional: zrobiłby(m)
    "niech": [("AUX", {})],  # niech zrobi: let him do it
    "niechaj": [("AUX", {})],
    "czy": [("PART", {"PartType": "Int"})],  # yes/no question marker
    "czyż": [("PART", {"PartType": "Int"})],
    "czyżby": [("PART", {"PartType": "Int"})],
    "może": [("PART", {"PartType": "Mod"})],  # maybe
}

# Verbs UD tags AUX when they are a copula or form a tense/passive, VERB otherwise
# (jest kot: there is a cat). Which one depends on the sentence, so both are candidates.
AUX_OR_VERB = {"być", "zostać", "zostawać", "bywać"}
VERB_CLASSES = {"fin", "praet", "impt", "inf", "pcon", "bedzie"}

# "to" as a predicative (pred) is a copula: Warszawa to stolica.
AUX_PREDICATIVES = {"to"}


def _with(feats: Feats, extra: Feats, drop: Literal["Degree", "NumForm"] | None = None) -> Feats:
    merged: Feats = {}
    merged.update(feats)
    merged.update(extra)
    if drop:
        merged.pop(drop, None)
    return merged


def adjust(grammatical_class: str, lemma: str, upos: Upos, feats: Feats) -> Iterator[PosFeats]:
    if grammatical_class == "subst" and lemma in PRONOUN_NOUNS:
        for extra in PRONOUN_NOUNS[lemma]:
            yield "PRON", _with(feats, extra)
    elif grammatical_class == "adj" and lemma in DETERMINER_ADJECTIVES:
        for extra in DETERMINER_ADJECTIVES[lemma]:
            yield "DET", _with(feats, extra, drop="Degree")
    elif grammatical_class == "num" and lemma in DETERMINER_NUMERALS:
        for extra in DETERMINER_NUMERALS[lemma]:
            yield "DET", _with(feats, extra, drop="NumForm")
    elif grammatical_class == "adv" and lemma in PRONOMINAL_ADVERBS:
        for extra in PRONOMINAL_ADVERBS[lemma]:
            yield "ADV", _with(feats, extra)
    elif grammatical_class == "comp" and lemma in COMPARATIVE_CONJUNCTIONS:
        for extra in COMPARATIVE_CONJUNCTIONS[lemma]:
            yield "SCONJ", _with(feats, extra)
    elif grammatical_class == "conj" and lemma in COMPARATIVE_CONJUNCTIONS:
        yield "CCONJ", feats
        for extra in COMPARATIVE_CONJUNCTIONS[lemma]:
            yield "SCONJ", _with(feats, extra)
    elif grammatical_class == "prep" and lemma in POSTPOSITIONS:
        yield "ADP", _with(feats, POSTPOSITIONS[lemma])
    elif grammatical_class in ("part", "qub"):
        for particle_upos, extra in PARTICLES.get(lemma, [("PART", {})]):
            yield particle_upos, _with(feats, extra)
    elif grammatical_class == "pred" and lemma in AUX_PREDICATIVES:
        yield "AUX", feats
    elif grammatical_class in VERB_CLASSES and lemma in AUX_OR_VERB:
        yield "AUX", feats
        yield "VERB", feats
    else:
        yield upos, feats
