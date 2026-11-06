"""English lexicon: Kaikki's English entries, with their forms as paradigms.

English Wiktionary lists each word's inflections (plural, third-person singular, past,
participles, comparative), and its irregular verbs in full (am, are, is, was, were), so
the paradigms come from there and are stored in the lexicon. Their features follow UD
English EWT, which the parser is trained on: finite verbs carry Person and Number, so a
form gets one feature set per person and number it serves.
"""

from collections.abc import Iterable, Iterator, Mapping

from ...blob import lemma_id
from ...lexicon import senses as kaikki_senses
from ...lexicon.bundle import Paradigms
from ...lexicon.kaikki import KaikkiEntry, KaikkiForm
from ...lexicon.schema import Form, Paradigm
from ...lexicon.source import Converted
from ...lexicon.store import Lexicon
from ...schema import Feats, Mood, Number, Person, Tense, Upos

ATTRIBUTION = (
    "Meanings and forms from Wiktionary (https://en.wiktionary.org) via kaikki.org, CC BY-SA 4.0"
)

# Kaikki part of speech -> the UPOS the analyser gives such a word. Where the analyser
# differs (can, will as AUX), a bundle falls back to the same lemma under another UPOS.
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
    "postp": "ADP",
    "conj": "CCONJ",
    "particle": "PART",
    "intj": "INTJ",
}
# Left out: affixes, letters, symbols, contractions (the parser splits don't into do +
# n't); phrases and proverbs become multi-word expressions later.

# Tags on a form-of sense that make it an inflected form ("plural of dog", "simple past of
# go"). The analyser already gives those words the lemma, so these senses add nothing.
INFLECTION_TAGS = {
    "singular",
    "plural",
    "first-person",
    "second-person",
    "third-person",
    "present",
    "past",
    "participle",
    "indicative",
    "subjunctive",
    "imperative",
    "infinitive",
    "gerund",
    "comparative",
    "superlative",
}
DERIVATION_TAGS = ("diminutive", "augmentative", "feminine", "masculine")

# Forms that aren't an inflection of today's word: spellings, old forms, the extract's
# own bookkeeping rows
SKIPPED_FORM_TAGS = {
    "alternative",
    "obsolete",
    "archaic",
    "dialectal",
    "nonstandard",
    "misspelling",
    "pronunciation-spelling",
    "abbreviation",
    "table-tags",
    "inflection-template",
    "class",
    "romanization",
}

PERSONS: tuple[Person, ...] = ("1", "2", "3")
NUMBERS: tuple[Number, ...] = ("Sing", "Plur")
PERSON_TAGS: Mapping[str, Person] = {"first-person": "1", "second-person": "2", "third-person": "3"}
NUMBER_TAGS: Mapping[str, Number] = {"singular": "Sing", "plural": "Plur"}
TENSE_TAGS: Mapping[str, Tense] = {"present": "Pres", "past": "Past"}


class Source:
    attribution = ATTRIBUTION
    version = ""

    def convert(self, entry: KaikkiEntry) -> Converted | None:
        word, pos = entry.get("word", ""), entry.get("pos", "")
        upos = KAIKKI_POS.get(pos)
        if upos is None or not word or " " in word:
            return None
        found = (
            kaikki_senses.sense(kaikki_sense, INFLECTION_TAGS, [])
            for kaikki_sense in entry.get("senses", [])
        )
        senses = [s for s in found if s is not None]
        if not senses:
            return None
        relations = list(kaikki_senses.derived_from(entry, INFLECTION_TAGS, DERIVATION_TAGS))
        forms = list(paradigm_forms(word, upos, entry.get("forms", [])))
        paradigms: list[Paradigm] = (
            [{"homonym": str(entry.get("etymology_number", "")), "forms": forms}]
            if len(forms) > 1
            else []
        )
        return Converted(word, (upos,), senses, relations, paradigms)

    def hand_entries(self) -> Iterable[Converted]:
        return ()


def paradigm_forms(word: str, upos: Upos, kaikki_forms: Iterable[KaikkiForm]) -> Iterator[Form]:
    """The headword and its inflections, each with every feature set it has."""
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
        case "ADJ" | "ADV":
            yield _form(word, {"Degree": "Pos"})
            for form, tags in inflections:
                if tags == {"comparative"}:
                    yield _form(form, {"Degree": "Cmp"})
                elif tags == {"superlative"}:
                    yield _form(form, {"Degree": "Sup"})
        case "VERB":
            yield from _verb_forms(word, inflections)
        case _:
            return


def _verb_forms(word: str, inflections: list[tuple[str, set[str]]]) -> Iterator[Form]:
    """The base form is the infinitive, the imperative, and the present of every person
    and number no other form covers (all but the third-person singular, usually)."""
    present_taken: set[tuple[Person, Number]] = set()
    for form, tags in inflections:
        if "participle" in tags:
            tense = next((TENSE_TAGS[t] for t in tags if t in TENSE_TAGS), None)
            if tense == "Past":
                yield _form(form, {"Tense": "Past", "VerbForm": "Part"})
                yield _form(form, {"Tense": "Past", "VerbForm": "Part", "Voice": "Pass"})
            elif tense == "Pres":
                yield _form(form, {"Tense": "Pres", "VerbForm": "Part"})
                yield _form(form, {"VerbForm": "Ger"})
            continue
        if "imperative" in tags or "infinitive" in tags:
            # be's own tables list them; the base form below covers them
            continue
        finite: Tense | None = next((TENSE_TAGS[t] for t in tags if t in TENSE_TAGS), None)
        if finite is None:
            continue
        mood: Mood = "Sub" if "subjunctive" in tags else "Ind"
        for person, number in _persons(tags):
            if finite == "Pres" and mood == "Ind":
                present_taken.add((person, number))
            yield _form(
                form,
                {
                    "Mood": mood,
                    "Number": number,
                    "Person": person,
                    "Tense": finite,
                    "VerbForm": "Fin",
                },
            )
    yield _form(word, {"VerbForm": "Inf"})
    yield _form(word, {"Mood": "Imp", "VerbForm": "Fin"})
    for person in PERSONS:
        for number in NUMBERS:
            if (person, number) not in present_taken:
                feats: Feats = {
                    "Mood": "Ind",
                    "Number": number,
                    "Person": person,
                    "Tense": "Pres",
                    "VerbForm": "Fin",
                }
                yield _form(word, feats)


def _persons(tags: set[str]) -> Iterator[tuple[Person, Number]]:
    """The persons and numbers a finite form's tags name; all of them when it names none
    (the past of a regular verb: walked)."""
    persons: list[Person] = [PERSON_TAGS[t] for t in tags if t in PERSON_TAGS] or list(PERSONS)
    numbers: list[Number] = [NUMBER_TAGS[t] for t in tags if t in NUMBER_TAGS] or list(NUMBERS)
    for person in persons:
        for number in numbers:
            yield person, number


def _is_inflection(form: str, tags: list[str]) -> bool:
    # "more beautiful" and the like: two tokens, never one token's form
    return (
        bool(form) and " " not in form and form != "-" and not SKIPPED_FORM_TAGS.intersection(tags)
    )


def _form(text: str, feats: Feats) -> Form:
    # English tags are UD's: there is no separate language-specific tag to keep
    return {"form": text, "xpos": "", "feats": feats}


def stored_paradigms(lexicon: Lexicon, lang: str) -> Paradigms:
    """The paradigms skolia-build-lexicon stored with each entry."""

    def paradigms(lemma: str, upos: Upos) -> list[Paradigm]:
        entry_id = lemma_id(lang, lemma, upos)
        row = lexicon.get(entry_id) if entry_id is not None else None
        return row.paradigms if row is not None else []

    return paradigms
