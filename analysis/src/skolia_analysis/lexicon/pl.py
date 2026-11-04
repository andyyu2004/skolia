"""Polish lexicon: Kaikki entries in the analyser's conventions, paradigms from Morfeusz.

The analyser decides what a lemma_id looks like (PDB conventions: który is DET, dużo is
DET, participles belong to the verb), so each Kaikki headword is looked up in Morfeusz
and converted with the same code the analyser uses.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .. import pl
from ..nkjp import tag_class
from ..schema import Feats, Upos
from .kaikki import KaikkiEntry, KaikkiSense
from .schema import Example, Form, Paradigm, Relation, Sense

if TYPE_CHECKING:
    from morfeusz2 import Morfeusz

LANG = pl.LANG

# Kaikki part of speech -> the UPOS the analyser may give the same word. The first is the
# fallback when Morfeusz doesn't know the headword.
KAIKKI_POS: dict[str, tuple[Upos, ...]] = {
    "noun": ("NOUN", "PROPN"),
    "name": ("PROPN", "NOUN"),
    "verb": ("VERB", "AUX"),
    "adj": ("ADJ", "DET"),
    "adv": ("ADV", "DET", "PART"),
    "pron": ("PRON", "DET"),
    "det": ("DET",),
    "num": ("NUM", "DET"),
    "prep": ("ADP",),
    "postp": ("ADP",),
    "conj": ("CCONJ", "SCONJ"),
    "particle": ("PART", "AUX", "ADV"),
    "intj": ("INTJ",),
}
# Kaikki parts of speech left out: affixes, letters, punctuation; phrases and proverbs
# become multi-word expressions later.

REFLEXIVE_SUFFIX = " się"
"""Wiktionary has entries like "bać się"; the analyser gives bać + się as two tokens."""
REFLEXIVE_TAG = "się"

# Tags on a form-of sense that make it an inflected form ("genitive plural of kuna",
# "comparative of stary", "passive participle of robić"). The analyser already gives
# those words the target's lemma, so these senses add nothing.
INFLECTION_TAGS = {
    "singular",
    "plural",
    "nominative",
    "genitive",
    "dative",
    "accusative",
    "instrumental",
    "locative",
    "vocative",
    "first-person",
    "second-person",
    "third-person",
    "past",
    "present",
    "future",
    "conditional",
    "imperative",
    "indicative",
    "impersonal",
    "participle",
    "adverbial",
    "anterior",
    "comparative",
    "superlative",
}
# Tags that say how a form-of sense is derived, kept as the relation's note
DERIVATION_TAGS = (
    "diminutive",
    "augmentative",
    "endearing",
    "noun-from-verb",
    "frequentative",
    "feminine",
    "masculine",
)
ASPECT_TAGS = {"perfective", "imperfective"}
# Paradigms leave out PronType and ExtPos: the sentence decides them, not the form (jakie
# is interrogative, PronType=Int, or relative, Rel, depending on use), so the token's
# form still matches whichever the parser chose.
MAX_EXAMPLES = 3

# Wiktionary noun gender codes (pl-noun etc.) -> the analyser's features. Codes are
# gender-animacy with an optional -p for plural-only nouns: m-pr is a masculine person
# (student), m-anml an animal (pies), m-in inanimate (stół), vr-p a virile plural-only
# noun. nv-p (non-virile plural-only: drzwi) sets nothing comparable.
GENDER: dict[str, Feats] = {
    "m-pr": {"Gender": "Masc", "Animacy": "Hum"},
    "m-anml": {"Gender": "Masc", "Animacy": "Nhum"},
    "m-an": {"Gender": "Masc", "Animacy": "Nhum"},
    "m-in": {"Gender": "Masc", "Animacy": "Inan"},
    "m": {"Gender": "Masc"},
    "vr": {"Gender": "Masc", "Animacy": "Hum"},
    "f": {"Gender": "Fem"},
    "n": {"Gender": "Neut"},
}
GENDER_TEMPLATES = {"pl-noun", "pl-proper noun", "pl-prop"}
GENERIC_HEAD_TEMPLATE = "head"
PLURAL_ONLY_SUFFIX = "-p"

# Function words Wiktionary's extract lacks or glosses unhelpfully. The page for "i" is
# so large that its language sections live on subpages, which Kaikki doesn't read.
HAND_SENSES: dict[tuple[str, Upos], list[str]] = {
    ("i", "CCONJ"): ["and", "(i ... i ...) both ... and ..."],
    ("i", "PART"): ["also, too; even"],
}


@dataclass
class Converted:
    """One Kaikki entry as the analyser would see it."""

    lemma: str
    upos: tuple[Upos, ...]
    senses: list[Sense] = field(default_factory=lambda: list[Sense]())
    relations: list[Relation] = field(default_factory=lambda: list[Relation]())


class Converter:
    def __init__(self) -> None:
        import morfeusz2

        self._morf: Morfeusz = morfeusz2.Morfeusz()
        self._candidates = pl.MorfeuszCandidates()

    def __call__(self, entry: KaikkiEntry) -> Converted | None:
        """None for entries the analyser never looks up: affixes, phrases, inflected forms."""
        word, pos = entry.get("word", ""), entry.get("pos", "")
        if pos not in KAIKKI_POS or not word:
            return None
        extra_tags: list[str] = []
        if " " in word:
            if not (pos == "verb" and word.endswith(REFLEXIVE_SUFFIX)):
                return None
            word = word.removesuffix(REFLEXIVE_SUFFIX)
            extra_tags.append(REFLEXIVE_TAG)
        gender = _gender(entry)
        senses = [
            s
            for kaikki_sense in entry.get("senses", [])
            if (s := _sense(kaikki_sense, gender, extra_tags)) is not None
        ]
        if not senses:
            return None
        relations = list(_derived_from(entry)) + list(_aspect_partners(entry, word))
        return Converted(word, self._upos(word, pos), senses, relations)

    def _upos(self, word: str, pos: str) -> tuple[Upos, ...]:
        """The analyser's UPOS for this headword: Morfeusz readings with this lemma whose
        UPOS fits the Kaikki part of speech, or the default for it."""
        allowed = KAIKKI_POS[pos]
        (readings,) = self._candidates(word, [word])
        found = {r["upos"] for r in readings if r["lemma"] == word and r["upos"] in allowed}
        return tuple(u for u in allowed if u in found) or allowed[:1]

    def paradigms(self, lemma: str, upos: Upos) -> list[Paradigm]:
        """Every form of the lemma Morfeusz can generate, one paradigm per homonym. A verb's
        paradigm includes its participles and gerunds."""
        by_homonym: dict[str, list[Form]] = {}
        seen: set[tuple[str, str]] = set()
        for interpretation in self._morf.generate(lemma):
            orth, base, _tag, _names, _qualifiers = interpretation
            base_lemma, homonym = pl.split_homonym(base)
            if base_lemma != lemma:
                continue
            for reading in pl.interpretation_readings(interpretation):
                if not _in_paradigm(upos, reading["upos"], reading["xpos"]):
                    continue
                key = (orth, reading["xpos"])
                if key in seen:
                    continue
                seen.add(key)
                feats = reading["feats"].copy()
                feats.pop("PronType", None)
                feats.pop("ExtPos", None)
                form: Form = {"form": orth, "xpos": reading["xpos"], "feats": feats}
                by_homonym.setdefault(homonym, []).append(form)
        return [{"homonym": h, "forms": forms} for h, forms in by_homonym.items()]


def _in_paradigm(entry_upos: Upos, form_upos: Upos, xpos: str) -> bool:
    if entry_upos == "VERB":
        return form_upos in ("VERB", "AUX") or tag_class(xpos) in pl.VERB_FORM_CLASSES
    nominal = {"NOUN", "PROPN"}
    if entry_upos in nominal:
        return form_upos in nominal
    return form_upos == entry_upos


def _gender(entry: KaikkiEntry) -> list[Feats]:
    codes: list[str] = []
    for template in entry.get("head_templates", []):
        args = template.get("args", {})
        if template.get("name") in GENDER_TEMPLATES:
            codes += args.get("1", "").split(",")
        elif template.get("name") == GENERIC_HEAD_TEMPLATE:
            codes += [v for k, v in args.items() if k.startswith("g")]
    found: list[Feats] = []
    for code in codes:
        # drop qualifiers like m-an! or m-anml<l:colloquial>
        code = code.split("<")[0].rstrip("!").removesuffix(PLURAL_ONLY_SUFFIX)
        feats = GENDER.get(code)
        if feats is not None and feats not in found:
            found.append(feats)
    return found


def _sense(sense: KaikkiSense, gender: list[Feats], extra_tags: list[str]) -> Sense | None:
    glosses = sense.get("glosses", [])
    tags = sense.get("tags", [])
    if not glosses:
        return None
    is_pointer = bool(sense.get("form_of") or sense.get("alt_of"))
    if is_pointer and INFLECTION_TAGS.intersection(tags):
        return None
    result: Sense = {
        "gloss": ": ".join(glosses),
        "tags": [t for t in tags if t != "form-of"] + extra_tags,
    }
    if gender:
        result["when"] = gender
    examples = list(_examples(sense))
    if examples:
        result["examples"] = examples
    return result


def _examples(sense: KaikkiSense) -> Iterator[Example]:
    for example in sense.get("examples", [])[:MAX_EXAMPLES]:
        text = example.get("text")
        if not text:
            continue
        result: Example = {"text": text}
        translation = example.get("translation") or example.get("english")
        if translation:
            result["translation"] = translation
        yield result


def _derived_from(entry: KaikkiEntry) -> Iterator[Relation]:
    seen: set[str] = set()
    for sense in entry.get("senses", []):
        tags = sense.get("tags", [])
        if INFLECTION_TAGS.intersection(tags):
            continue
        for target in sense.get("form_of", []):
            lemma = target.get("word")
            if not lemma or lemma in seen:
                continue
            seen.add(lemma)
            relation: Relation = {"type": "derived-from", "lemma": lemma}
            note = next((t for t in DERIVATION_TAGS if t in tags), None)
            if note:
                relation["note"] = note
            yield relation


def _aspect_partners(entry: KaikkiEntry, word: str) -> Iterator[Relation]:
    """Wiktionary lists a verb's aspect partner as a form tagged only with its aspect."""
    if entry.get("pos") != "verb":
        return
    for form in entry.get("forms", []):
        partner = form.get("form", "")
        tags = set(form.get("tags", []))
        if partner and partner != word and tags and tags <= ASPECT_TAGS:
            yield {"type": "aspect-partner", "lemma": partner, "note": tags.pop()}


def hand_entries() -> Iterator[tuple[str, Upos, list[Sense]]]:
    for (lemma, upos), glosses in HAND_SENSES.items():
        yield lemma, upos, [{"gloss": g, "tags": []} for g in glosses]
