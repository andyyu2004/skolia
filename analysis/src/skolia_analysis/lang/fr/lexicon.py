"""French lexicon: Kaikki's French entries, with their forms as paradigms.

English Wiktionary gives each French verb's full conjugation (fr-conj-auto), each noun's
plural and each adjective's feminine and plural forms, so the paradigms come from there
and are stored in the lexicon. Their features follow UD French GSD, which the parser is
trained on: an imperfect is Tense=Imp, a conditional Mood=Cnd|Tense=Pres, a past
participle has Gender and Number and no Tense.
"""

from collections.abc import Iterable, Iterator, Mapping

from ...lexicon import senses as kaikki_senses
from ...lexicon.kaikki import KaikkiEntry, KaikkiForm, KaikkiSense, KaikkiSound
from ...lexicon.pronunciation import pronunciations
from ...lexicon.schema import Accent, Form, Paradigm, Sense
from ...lexicon.source import Converted, Pronounced
from ...schema import Feats, Gender, Mood, Number, Person, Tense, Upos

ATTRIBUTION = (
    "Meanings, forms and pronunciations from Wiktionary (https://en.wiktionary.org) via "
    "kaikki.org, CC BY-SA 4.0"
)

# Kaikki part of speech -> the UPOS the analyser gives such a word. Where the analyser
# differs (être, avoir as AUX; que as SCONJ), a bundle falls back to the same lemma under
# another UPOS.
KAIKKI_POS: dict[str, Upos] = {
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
    "conj": "CCONJ",
    "particle": "PART",
    "intj": "INTJ",
}
# Left out: affixes, letters, symbols, contractions (the parser splits du into de + le);
# phrases and proverbs become multi-word expressions later.

# Wiktionary files a pronominal verb's own senses under "se lever" or "s'asseoir"; the
# parser gives se as a word of its own and lever as the lemma
PRONOMINAL_PREFIXES = ("se ", "s'", "s’")  # noqa: RUF001 (Wiktionary uses both apostrophes)
PRONOMINAL_TAG = "pronominal"

# Tags on a form-of sense that make it an inflected form ("feminine plural of grand",
# "first-person singular present indicative of être"). The analyser already gives those
# words the lemma, so these senses add nothing.
INFLECTION_TAGS = {
    "singular",
    "plural",
    "first-person",
    "second-person",
    "third-person",
    "present",
    "past",
    "future",
    "imperfect",
    "historic",
    "conditional",
    "indicative",
    "subjunctive",
    "imperative",
    "infinitive",
    "participle",
    "gerund",
}
# A form-of sense with only these is a derived word (chienne, feminine of chien)
DERIVATION_TAGS = ("diminutive", "augmentative", "feminine", "masculine")
GENDER_TAGS: Mapping[str, Gender] = {"masculine": "Masc", "feminine": "Fem"}

# Forms that aren't an inflection of today's word: spellings, old forms, the extract's
# own bookkeeping rows
SKIPPED_FORM_TAGS = {
    "alternative",
    "obsolete",
    "archaic",
    "dated",
    "rare",
    "dialectal",
    "nonstandard",
    "misspelling",
    "abbreviation",
    "canonical",
    "table-tags",
    "inflection-template",
    "class",
    "romanization",
    "multiword-construction",
}

PERSON_TAGS: Mapping[str, Person] = {"first-person": "1", "second-person": "2", "third-person": "3"}
NUMBER_TAGS: Mapping[str, Number] = {"singular": "Sing", "plural": "Plur"}
# A finite form's mood and tense tags (with the person and number ones removed) -> UD
# French GSD's Mood and Tense
FINITE: Mapping[frozenset[str], tuple[Mood, Tense]] = {
    frozenset({"indicative", "present"}): ("Ind", "Pres"),
    frozenset({"indicative", "imperfect"}): ("Ind", "Imp"),
    frozenset({"indicative", "historic", "past"}): ("Ind", "Past"),
    frozenset({"indicative", "future"}): ("Ind", "Fut"),
    frozenset({"conditional"}): ("Cnd", "Pres"),
    frozenset({"subjunctive", "present"}): ("Sub", "Pres"),
    frozenset({"subjunctive", "imperfect"}): ("Sub", "Imp"),
    frozenset({"imperative"}): ("Imp", "Pres"),
}

# Past participles that never agree: verbs that only take avoir and no direct object
# (il a plu, elle a pu). The others get their feminine and plural by the regular rule.
INVARIABLE_PARTICIPLES = {"été", "pu", "fallu", "plu", "ri", "souri", "nui", "suffi", "semblé"}

# Accents the reader shows; France's is the only one kept, so none is named
FRANCE_TAGS = {"France", "Paris", "Parisian"}
NOT_TODAY_TAGS = {"obsolete", "archaic", "dated", "Middle", "Old"}


class Source:
    attribution = ATTRIBUTION
    version = ""

    def convert(self, entry: KaikkiEntry) -> Converted | None:
        word, pos = entry.get("word", ""), entry.get("pos", "")
        upos = KAIKKI_POS.get(pos)
        extra_tags: list[str] = []
        if upos == "VERB" and word.startswith(PRONOMINAL_PREFIXES):
            word = next(word.removeprefix(p) for p in PRONOMINAL_PREFIXES if word.startswith(p))
            extra_tags.append(PRONOMINAL_TAG)
        if upos is None or not word or " " in word:
            return None
        senses = [
            s
            for kaikki_sense in entry.get("senses", [])
            if (s := _sense(kaikki_sense, upos, extra_tags)) is not None
        ]
        if not senses:
            return None
        relations = list(kaikki_senses.derived_from(entry, INFLECTION_TAGS, DERIVATION_TAGS))
        # A pronominal verb's forms are the verb's own, filed under it
        forms = [] if extra_tags else list(paradigm_forms(word, upos, entry.get("forms", [])))
        paradigms: list[Paradigm] = [{"homonym": "", "forms": forms}] if len(forms) > 1 else []
        return Converted(word, (upos,), senses, relations, paradigms)

    def pronounce(self, entry: KaikkiEntry) -> Pronounced | None:
        word, pos = entry.get("word", ""), entry.get("pos", "")
        upos = KAIKKI_POS.get(pos)
        if upos is None or not word or " " in word:
            return None
        found = pronunciations(entry.get("sounds", []), _accents)
        return Pronounced(word, (upos,), found) if found else None

    def hand_entries(self) -> Iterable[Converted]:
        return ()


def _sense(kaikki_sense: KaikkiSense, upos: Upos, extra_tags: list[str]) -> Sense | None:
    """A noun's sense tagged with one gender is selected by it: livre is a book as a
    masculine noun and a pound as a feminine one."""
    genders: list[Gender] = [
        GENDER_TAGS[t] for t in kaikki_sense.get("tags", []) if t in GENDER_TAGS
    ]
    when: list[Feats] = []
    if upos == "NOUN" and len(genders) == 1:
        when.append({"Gender": genders[0]})
    return kaikki_senses.sense(kaikki_sense, INFLECTION_TAGS, when, extra_tags)


def _accents(sound: KaikkiSound) -> list[Accent] | None:
    """Every sound without a region, and France's; None for other regions (Quebec,
    Louisiana) and older French."""
    tags = set(sound.get("tags", []))
    if tags & NOT_TODAY_TAGS:
        return None
    if not tags or tags & FRANCE_TAGS:
        return []
    return None


def paradigm_forms(word: str, upos: Upos, kaikki_forms: Iterable[KaikkiForm]) -> Iterator[Form]:
    """The headword and its inflections, each with every feature set it has, once."""
    seen: set[tuple[str, tuple[tuple[str, object], ...]]] = set()
    for form in _paradigm_forms(word, upos, kaikki_forms):
        key = (form["form"], tuple(sorted(form["feats"].items())))
        if key not in seen:
            seen.add(key)
            yield form


def _paradigm_forms(word: str, upos: Upos, kaikki_forms: Iterable[KaikkiForm]) -> Iterator[Form]:
    inflections = [
        (f.get("form", ""), set(f.get("tags", [])))
        for f in kaikki_forms
        if _is_inflection(f.get("form", ""), f.get("tags", []))
    ]
    match upos:
        case "NOUN" | "PROPN":
            yield _form(word, {"Number": "Sing"})
            for form, tags in inflections:
                if tags == {"plural"}:
                    yield _form(form, {"Number": "Plur"})
        case "ADJ":
            yield from _adjective_forms(word, inflections)
        case "VERB":
            yield from _verb_forms(word, inflections)
        case _:
            return


def _adjective_forms(word: str, inflections: list[tuple[str, set[str]]]) -> Iterator[Form]:
    """The headword is the masculine singular, and the feminine too when Wiktionary gives
    no feminine (rapide). A plural without a gender is the masculine one, and the
    feminine one when there's no other (rapides)."""
    feminine = [f for f, tags in inflections if tags == {"feminine"}]
    feminine_plural = [f for f, tags in inflections if tags == {"feminine", "plural"}]
    yield _form(word, {"Gender": "Masc", "Number": "Sing"})
    if not feminine:
        yield _form(word, {"Gender": "Fem", "Number": "Sing"})
    for form, tags in inflections:
        bare = tags - {"before-vowel"}
        if bare in ({"feminine"}, {"feminine", "singular"}):
            yield _form(form, {"Gender": "Fem", "Number": "Sing"})
        elif bare == {"masculine", "singular"}:
            # bel, the masculine before a vowel: un bel homme
            yield _form(form, {"Gender": "Masc", "Number": "Sing"})
        elif bare == {"masculine", "plural"}:
            yield _form(form, {"Gender": "Masc", "Number": "Plur"})
        elif bare == {"feminine", "plural"}:
            yield _form(form, {"Gender": "Fem", "Number": "Plur"})
        elif bare == {"plural"}:
            yield _form(form, {"Gender": "Masc", "Number": "Plur"})
            if not feminine_plural:
                yield _form(form, {"Gender": "Fem", "Number": "Plur"})


def _verb_forms(word: str, inflections: list[tuple[str, set[str]]]) -> Iterator[Form]:
    """A verb Wiktionary gives no conjugation has no paradigm."""
    if not inflections:
        return
    yield _form(word, {"VerbForm": "Inf"})
    for form, tags in inflections:
        if tags == {"gerund", "participle", "present"}:
            # GSD gives the present participle VerbForm=Part alone; other French
            # treebanks add Tense=Pres
            yield _form(form, {"VerbForm": "Part"})
            yield _form(form, {"Tense": "Pres", "VerbForm": "Part"})
            continue
        # A verb that's only pronominal tags its participle reflexive (fié, of se fier)
        if tags - {"reflexive"} == {"participle", "past"}:
            yield from _past_participles(form)
            continue
        persons: list[Person] = [PERSON_TAGS[t] for t in tags if t in PERSON_TAGS]
        numbers: list[Number] = [NUMBER_TAGS[t] for t in tags if t in NUMBER_TAGS]
        rest = tags - PERSON_TAGS.keys() - NUMBER_TAGS.keys()
        finite = FINITE.get(frozenset(rest))
        if finite is None or len(persons) != 1 or len(numbers) != 1:
            continue
        mood, tense = finite
        yield _form(
            form,
            {
                "Mood": mood,
                "Number": numbers[0],
                "Person": persons[0],
                "Tense": tense,
                "VerbForm": "Fin",
            },
        )


def _past_participles(masculine: str) -> Iterator[Form]:
    """Wiktionary gives the masculine singular; the others follow the rule: +e, +s, +es,
    no s after s or x (pris, prise, pris, prises), -û loses its accent (dû, due), -ous
    becomes -oute (dissous, dissoute)."""
    yield _form(masculine, {"Gender": "Masc", "Number": "Sing", "VerbForm": "Part"})
    if masculine in INVARIABLE_PARTICIPLES:
        return
    stem = masculine.removesuffix("û") + "u" if masculine.endswith("û") else masculine
    feminine = masculine.removesuffix("s") + "te" if masculine.endswith("ous") else stem + "e"
    plural = masculine if masculine.endswith(("s", "x")) else stem + "s"
    yield _form(feminine, {"Gender": "Fem", "Number": "Sing", "VerbForm": "Part"})
    yield _form(plural, {"Gender": "Masc", "Number": "Plur", "VerbForm": "Part"})
    yield _form(feminine + "s", {"Gender": "Fem", "Number": "Plur", "VerbForm": "Part"})


def _is_inflection(form: str, tags: list[str]) -> bool:
    # "avoir + past participle" and the like: several tokens, never one token's form
    return (
        bool(form) and " " not in form and form != "-" and not SKIPPED_FORM_TAGS.intersection(tags)
    )


def _form(text: str, feats: Feats) -> Form:
    # French tags are UD's: there is no separate language-specific tag to keep
    return {"form": text, "xpos": "", "feats": feats}
