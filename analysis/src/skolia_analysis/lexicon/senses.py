"""Kaikki senses into the lexicon's: the part every language's conversion shares.

Wiktionary's sense tags are English whatever the language (genitive, plural, diminutive),
so a language only says which of them mark an inflected form and which a derivation.
"""

from collections.abc import Collection, Iterator, Sequence

from ..schema import Feats
from .kaikki import KaikkiEntry, KaikkiSense
from .schema import Example, Relation, Sense

MAX_EXAMPLES = 3


def sense(
    kaikki_sense: KaikkiSense,
    inflection_tags: Collection[str],
    when: list[Feats],
    extra_tags: Sequence[str] = (),
) -> Sense | None:
    """None for a sense with no gloss, or one that only points at the form's lemma
    ("genitive plural of kuna"): the analyser already gives such a word that lemma.
    when: the features that select the sense; empty for always."""
    glosses = kaikki_sense.get("glosses", [])
    tags = kaikki_sense.get("tags", [])
    if not glosses:
        return None
    is_pointer = bool(kaikki_sense.get("form_of") or kaikki_sense.get("alt_of"))
    if is_pointer and any(t in inflection_tags for t in tags):
        return None
    result: Sense = {
        "gloss": ": ".join(glosses),
        "tags": [t for t in tags if t != "form-of"] + list(extra_tags),
    }
    if when:
        result["when"] = when
    found = list(examples(kaikki_sense))
    if found:
        result["examples"] = found
    return result


def examples(kaikki_sense: KaikkiSense) -> Iterator[Example]:
    for example in kaikki_sense.get("examples", [])[:MAX_EXAMPLES]:
        text = example.get("text")
        if not text:
            continue
        result: Example = {"text": text}
        translation = example.get("translation") or example.get("english")
        if translation:
            result["translation"] = translation
        yield result


def derived_from(
    entry: KaikkiEntry, inflection_tags: Collection[str], derivation_tags: Sequence[str]
) -> Iterator[Relation]:
    """Words a form-of sense derives this one from ("diminutive of rubel"); the first of
    derivation_tags on the sense becomes the note."""
    seen: set[str] = set()
    for kaikki_sense in entry.get("senses", []):
        tags = kaikki_sense.get("tags", [])
        if any(t in inflection_tags for t in tags):
            continue
        for target in kaikki_sense.get("form_of", []):
            lemma = target.get("word")
            if not lemma or lemma in seen:
                continue
            seen.add(lemma)
            relation: Relation = {"type": "derived-from", "lemma": lemma}
            note = next((t for t in derivation_tags if t in tags), None)
            if note:
                relation["note"] = note
            yield relation
