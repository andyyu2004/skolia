"""The typed model back in Walenty's notation, so a round trip shows nothing was lost.

Rendering is canonical: positions joined by " + " at the top level and "+" inside
modifications, lemma lists joined by "," for XOR and ";" for OR (the release mixes both
for OR; tests compare with that normalised).
"""

from collections.abc import Sequence
from typing import assert_never

from .model import (
    LemmaChoice,
    Lex,
    LexForm,
    Modification,
    Phrase,
    Position,
    Schema,
    inflects_like,
)
from .vocabulary import ANY

CERTAINTY_NAME = {
    "certain": "pewny",
    "doubtful": "wątpliwy",
    "colloquial": "potoczny",
    "archaic": "archaiczny",
    "vulgar": "wulgarny",
    "wrong": "zły",
}


def _any(value: str) -> str:
    return ANY if value == "any" else value


def _words(words: Sequence[str]) -> str:
    return "[" + ";".join(words) + "]" if words else ""


def render_phrase(phrase: Phrase) -> str:
    match phrase["kind"]:
        case "np" | "adjp" | "nump" | "ppasp" | "pactp":
            return f"{phrase['kind']}({phrase['case']})"
        case "prepnp" | "prepadjp" | "prepnump" | "prepgerp" | "prepppasp":
            return f"{phrase['kind']}({phrase['prep']},{phrase['case']})"
        case "comprepnp":
            return f"comprepnp({phrase['prep']})"
        case "cp":
            return f"cp({phrase['complementizer']}{_words(phrase['words'])})"
        case "ncp":
            return f"ncp({phrase['case']},{phrase['complementizer']}{_words(phrase['words'])})"
        case "prepncp":
            words = _words(phrase["words"])
            return f"prepncp({phrase['prep']},{phrase['case']},{phrase['complementizer']}{words})"
        case "infp":
            return f"infp({_any(phrase['aspect'])})"
        case "xp":
            realisations = ";".join(render_phrase(r) for r in phrase["realisations"])
            inside = f"[{realisations}]" if realisations else ""
            return f"xp({phrase['category']}{inside})"
        case "advp":
            return f"advp({phrase['category']})"
        case "compar":
            return f"compar({phrase['comparator']})"
        case "fixed":
            return f"fixed({render_phrase(phrase['phrase'])},'{phrase['text']}')"
        case "lex":
            return _lex(phrase)
        case "lexcompar":
            parts = "+".join(_lex(p) for p in phrase["parts"])
            return f"lex({render_phrase(phrase['phrase'])},{parts})"
        case "possp" | "refl" | "recip" | "or" | "nonch" | "E" | "distrp" | "qub":
            return phrase["kind"]
        case _:
            assert_never(phrase)


def _lex(lex: Lex) -> str:
    inflection = _form(lex["form"])
    lemmas = _lemmas(lex["lemmas"])
    # Active participles have a się slot after the lemma; passive ones don't
    active = inflects_like(lex["phrase"])["kind"] == "pactp"
    middle = _form_with_lemmas(lex["form"], inflection, lemmas, active)
    return f"lex({render_phrase(lex['phrase'])},{middle},{_modification(lex['modification'])})"


def _form(form: LexForm) -> list[str]:
    """The inflection slots that come before the lemmas."""
    match form["shape"]:
        case "nominal":
            return [_any(form["number"])]
        case "adjectival":
            genders = ".".join(_any(g) for g in form["genders"])
            return [_any(form["number"]), genders, _any(form["degree"])]
        case "participial":
            genders = ".".join(_any(g) for g in form["genders"])
            return [_any(form["number"]), genders, _any(form["negation"])]
        case "verbal":
            return [_any(form["negation"])]
        case "gerund":
            return [_any(form["number"]), _any(form["negation"])]
        case "numeral":
            return [_lemmas(form["numeral"])]
        case "adverbial":
            return [_any(form["degree"])]
        case "particle":
            return []
        case _:
            assert_never(form)


def _form_with_lemmas(form: LexForm, inflection: list[str], lemmas: str, active: bool) -> str:
    """Inflection, lemmas, and the się slot that follows the lemmas for verbal shapes."""
    slots = [*inflection, lemmas]
    match form["shape"]:
        case "verbal" | "gerund":
            slots.append("się" if form["reflexive"] else "")
        case "participial":
            if active:
                slots.append("się" if form["reflexive"] else "")
        case _:
            pass
    return ",".join(slots)


def _lemmas(choice: LemmaChoice) -> str:
    match choice["kind"]:
        case "one":
            return f"'{choice['lemma']}'"
        case "xor":
            return "XOR(" + ",".join(f"'{lemma}'" for lemma in choice["lemmas"]) + ")"
        case "or":
            return "OR(" + ";".join(f"'{lemma}'" for lemma in choice["lemmas"]) + ")"
        case _:
            assert_never(choice)


def _modification(modification: Modification) -> str:
    if not modification["positions"]:
        return modification["kind"]
    return f"{modification['kind']}({render_positions(modification['positions'], '+')})"


def render_position(position: Position) -> str:
    labels = ",".join(position["labels"])
    return labels + "{" + ";".join(render_phrase(p) for p in position["phrases"]) + "}"


def render_positions(positions: list[Position], separator: str = " + ") -> str:
    return separator.join(render_position(p) for p in positions)


def render_schema(schema: Schema) -> str:
    lemma = schema["lemma"] + (" się" if schema["reflexive"] else "")
    verb = schema["pos"] == "verb"
    negation = _any(schema["negation"]) if verb else ""
    aspect = _any(schema["aspect"]) if verb else ""
    fields = [
        lemma,
        CERTAINTY_NAME[schema["certainty"]],
        negation,
        "pred" if schema["predicative"] else "",
        aspect,
        render_positions(schema["positions"]),
    ]
    return ": ".join(fields)
