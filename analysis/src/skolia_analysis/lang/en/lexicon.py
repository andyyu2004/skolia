"""English lexicon: Kaikki's English entries, with their forms as paradigms.

English Wiktionary lists each word's inflections (plural, third-person singular, past,
participles, comparative), and its irregular verbs in full (am, are, is, was, were), so
the paradigms come from there and are stored in the lexicon. Their features follow UD
English EWT, which the parser is trained on: finite verbs carry Person and Number, so a
form gets one feature set per person and number it serves.
"""

from collections.abc import Iterable, Iterator, Mapping

from ...lexicon import kaikki
from ...lexicon import senses as kaikki_senses
from ...lexicon.kaikki import KaikkiEntry, KaikkiForm, KaikkiSound
from ...lexicon.pronunciation import pronunciations, recordings
from ...lexicon.schema import Accent, Form, Paradigm
from ...lexicon.source import Converted, Pronounced
from ...schema import Feats, Mood, Number, Person, Tense, Upos

ATTRIBUTION = (
    "Meanings, forms and pronunciations from Wiktionary (https://en.wiktionary.org) via "
    "kaikki.org, CC BY-SA 4.0"
)

# Wiktionary's accent tags -> the accents the reader shows. British is Standard Southern
# British, the newer name for Received Pronunciation.
ACCENTS: tuple[Accent, ...] = ("UK", "US")
ACCENT_TAGS: Mapping[str, Accent] = {
    "Received-Pronunciation": "UK",
    "UK": "UK",
    "British": "UK",
    "General-American": "US",
    "US": "US",
}
# Some say the accent in a note instead: lead (the metal) has "Received Pronunciation,
# General American, CA]"
ACCENT_NOTES: Mapping[str, Accent] = {
    "Received Pronunciation": "UK",
    "General American": "US",
}
# Notes kept on a sound with no accent: a function word said stressed or not (of: /ɒv/,
# /əv/). Any other note is a region or a merger, like the tags left out.
FORM_NOTES = {"strong form", "weak form", "stressed form", "unstressed form"}
# Not how the word is said today, even when also tagged UK or US
NOT_TODAY_TAGS = {"obsolete", "archaic", "dialectal", "Early", "Middle"}

# Parts of speech are kaikki.POS. Where the analyser differs (can, will as AUX), a bundle
# falls back to the same lemma under another UPOS. Left out: affixes, letters, symbols,
# contractions (the parser splits don't into do + n't); phrases and proverbs become
# multi-word expressions later.

# Suffixes the parser splits off as words of their own: Wiktionary files the possessive
# (the dog's bone) under the suffix -'s, UD makes it a particle, lemma 's
ENCLITICS: dict[str, tuple[str, Upos]] = {"-'s": ("'s", "PART")}

INFLECTION_TAGS = kaikki.INFLECTION_TAGS | {
    "subjunctive",
    "infinitive",
    "gerund",
    "comparative",
    "superlative",
}

SKIPPED_FORM_TAGS = kaikki.SKIPPED_FORM_TAGS | {
    "pronunciation-spelling",
    # can's "participle" able: another word standing in for the missing form
    "suppletive",
}

# be's table lists thou art beside you are with the same tags and no archaic one. The few
# other untagged thou forms (sattest, victualleth) are on rare verbs and left alone.
UNTAGGED_ARCHAIC_FORMS = {"art", "'rt"}

PERSONS: tuple[Person, ...] = ("1", "2", "3")
NUMBERS: tuple[Number, ...] = ("Sing", "Plur")
TENSE_TAGS: Mapping[str, Tense] = {"present": "Pres", "past": "Past"}


class Source:
    attribution = ATTRIBUTION
    version = ""

    def convert(self, entry: KaikkiEntry) -> Converted | None:
        word, pos = entry.get("word", ""), entry.get("pos", "")
        upos = kaikki.POS.get(pos)
        if pos == "suffix" and word in ENCLITICS:
            word, upos = ENCLITICS[word]
        if upos is None or not word or " " in word:
            return None
        found = (
            kaikki_senses.sense(kaikki_sense, INFLECTION_TAGS, [])
            for kaikki_sense in entry.get("senses", [])
        )
        senses = [s for s in found if s is not None]
        if not senses:
            return None
        relations = list(kaikki_senses.derived_from(entry, INFLECTION_TAGS, kaikki.DERIVATION_TAGS))
        forms = list(paradigm_forms(word, upos, entry.get("forms", [])))
        # Wiktionary splits a word by etymology, usually with the same forms (bank, the
        # shore and the institution); merge keeps one copy of each table
        paradigms: list[Paradigm] = [{"homonym": "", "forms": forms}] if len(forms) > 1 else []
        return Converted(word, (upos,), senses, relations, paradigms)

    def pronounce(self, entry: KaikkiEntry) -> Pronounced | None:
        word, pos = entry.get("word", ""), entry.get("pos", "")
        upos = kaikki.POS.get(pos)
        if pos == "suffix" and word in ENCLITICS:
            word, upos = ENCLITICS[word]
        if upos is None or not word or " " in word:
            return None
        sounds = entry.get("sounds", [])
        found, heard = pronunciations(sounds, _accents), recordings(sounds)
        return Pronounced(word, (upos,), found, heard) if found or heard else None

    def hand_entries(self) -> Iterable[Converted]:
        return ()


def _accents(sound: KaikkiSound) -> list[Accent] | None:
    """UK, US, or both from the tags, else from the note; every accent when there are
    neither. None for other accents (Scotland, Australia) and older English."""
    tags, note = sound.get("tags", []), sound.get("note", "")
    if NOT_TODAY_TAGS.intersection(tags):
        return None
    accents: set[Accent]
    if tags:
        accents = {ACCENT_TAGS[t] for t in tags if t in ACCENT_TAGS}
    elif note and note not in FORM_NOTES:
        accents = {accent for text, accent in ACCENT_NOTES.items() if text in note}
    else:
        return []
    return [a for a in ACCENTS if a in accents] or None


def paradigm_forms(word: str, upos: Upos, kaikki_forms: Iterable[KaikkiForm]) -> Iterator[Form]:
    """The headword and its inflections, each with every feature set it has, once: Kaikki
    lists a verb's forms from the headword line (walked: past) and again from its
    conjugation table (walked: first-person singular past)."""
    seen: set[tuple[str, tuple[tuple[str, object], ...]]] = set()
    for form in _paradigm_forms(word, upos, kaikki_forms):
        key = (form["form"], tuple(sorted(form["feats"].items())))
        if key not in seen:
            seen.add(key)
            yield form


def _paradigm_forms(word: str, upos: Upos, kaikki_forms: Iterable[KaikkiForm]) -> Iterator[Form]:
    kaikki_forms = list(kaikki_forms)
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
            # A modal's table gives its infinitive as "-" (can, must: no to can)
            no_infinitive = any(
                f.get("form") == "-" and "infinitive" in f.get("tags", []) for f in kaikki_forms
            )
            yield from _verb_forms(word, inflections, no_infinitive)
        case _:
            return


def _verb_forms(
    word: str, inflections: list[tuple[str, set[str]]], no_infinitive: bool
) -> Iterator[Form]:
    """The base form is the infinitive, the imperative, and the present of every person
    and number no other form covers (all but the third-person singular, usually). A verb
    Wiktionary gives no inflections (could, would, ought) has no paradigm."""
    if not inflections:
        return
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
    if not no_infinitive:
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
    persons: list[Person] = [
        kaikki.PERSON_TAGS[t] for t in tags if t in kaikki.PERSON_TAGS
    ] or list(PERSONS)
    numbers: list[Number] = [
        kaikki.NUMBER_TAGS[t] for t in tags if t in kaikki.NUMBER_TAGS
    ] or list(NUMBERS)
    for person in persons:
        for number in numbers:
            yield person, number


def _is_inflection(form: str, tags: list[str]) -> bool:
    # "more beautiful" and the like: two tokens, never one token's form
    return (
        bool(form)
        and " " not in form
        and form != "-"
        and form not in UNTAGGED_ARCHAIC_FORMS
        and not SKIPPED_FORM_TAGS.intersection(tags)
    )


def _form(text: str, feats: Feats) -> Form:
    # English tags are UD's: there is no separate language-specific tag to keep
    return {"form": text, "xpos": "", "feats": feats}
