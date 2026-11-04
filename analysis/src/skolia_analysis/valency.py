"""Polish verb valency from Walenty (IPI PAN, CC BY-SA 4.0): which cases a verb's
complements take. http://zil.ipipan.waw.pl/Walenty

A Walenty line is one frame (schema) of one lemma:

    szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)} + {prepnp(w,loc)}
    lemma   certainty  negation  predicative  aspect  positions joined by " + "

Each position is {option;option;...}, optionally labelled (subj, obj, controller, ...).
Only phrases with a case are kept: np(case) (noun phrase), adjp(case), nump(case),
and prepnp(preposition,case) with its adjective and numeral variants. Clauses,
infinitives, adverbials and fixed idioms (lex(...)) are dropped.

Case values: nom gen dat acc inst loc as usual, plus
    str   structural: nominative for a subject, accusative for an object, genitive when
          the verb is negated (mam czas / nie mam czasu)
    part  partitive: genitive (some of) or accusative (all of): nalać wody / wodę
    agr   agrees with something else
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict, cast

from .schema import Case

FIELD_SEP = ": "
FIELDS = 6
COMMENT = "%"
REFLEXIVE_SUFFIX = " się"

# Certainty column: frames marked wrong (zły) are kept in Walenty only as warnings
SKIPPED_CERTAINTY = {"zły"}

type Negation = Literal["_", "neg", "aff"]
"""_: with or without nie; neg: only negated; aff: only not negated."""

type CaseSpec = Literal["nom", "gen", "dat", "acc", "inst", "loc", "str", "part", "agr"]
CASE_SPECS: frozenset[str] = frozenset(
    ("nom", "gen", "dat", "acc", "inst", "loc", "str", "part", "agr")
)

# Walenty case -> UD Case
UD_CASE: dict[str, Case] = {
    "nom": "Nom",
    "gen": "Gen",
    "dat": "Dat",
    "acc": "Acc",
    "inst": "Ins",
    "loc": "Loc",
}

NOMINAL_PHRASES = {"np", "adjp", "nump"}
PREPOSITIONAL_PHRASES = {"prepnp", "prepadjp", "prepnump"}
SUBJECT = "subj"
LEXICALISED = "lex("


class Phrase(TypedDict):
    case: CaseSpec
    prep: str | None
    """The preposition, for prepnp(w,loc); None for a bare noun phrase."""


class Slot(TypedDict):
    labels: list[str]
    """subj, obj, controller, controllee: empty for other complements."""
    phrases: list[Phrase]
    """Alternatives for the slot; only those with a case."""


class Frame(TypedDict):
    negation: Negation
    certainty: str
    idiom: bool
    """Has a fixed-word position (lex(...)): mieć dość czegoś. Its other slots belong to
    the idiom (the genitive is dość's), so they say nothing about the verb in general."""
    slots: list[Slot]


type Lexicon = dict[str, list[Frame]]
"""Frames by lemma, reflexive verbs with " się": "szukać", "bać się"."""


def split_top(text: str, separator: str) -> Iterator[str]:
    """Split on separator outside brackets: lex(...) nests + and ; inside."""
    depth = 0
    start = 0
    i = 0
    while i < len(text):
        char = text[i]
        if char in "({[":
            depth += 1
        elif char in ")}]":
            depth -= 1
        elif depth == 0 and text.startswith(separator, i):
            yield text[start:i]
            start = i + len(separator)
            i = start
            continue
        i += 1
    yield text[start:]


def parse_phrase(text: str) -> Phrase | None:
    """np(gen) -> gen; prepnp(w,loc) -> (w, loc); anything else -> None."""
    name, paren, rest = text.strip().partition("(")
    if not paren or not rest.endswith(")"):
        return None
    args = [a.strip() for a in rest[:-1].split(",")]
    if name in NOMINAL_PHRASES and args and args[0] in CASE_SPECS:
        return {"case": cast(CaseSpec, args[0]), "prep": None}
    if name in PREPOSITIONAL_PHRASES and len(args) >= 2 and args[1] in CASE_SPECS:
        return {"case": cast(CaseSpec, args[1]), "prep": args[0]}
    return None


def parse_slot(text: str) -> Slot | None:
    labels_text, brace, body = text.strip().partition("{")
    if not brace or not body.endswith("}"):
        return None
    phrases = [p for option in split_top(body[:-1], ";") if (p := parse_phrase(option))]
    if not phrases:
        return None
    labels = [label for label in labels_text.split(",") if label]
    return {"labels": labels, "phrases": phrases}


def parse_line(line: str) -> tuple[str, Frame] | None:
    if line.startswith(COMMENT) or not line.strip():
        return None
    fields = line.rstrip("\n").split(FIELD_SEP, FIELDS - 1)
    if len(fields) != FIELDS:
        return None
    lemma, certainty, negation, _predicative, _aspect, positions = fields
    if certainty in SKIPPED_CERTAINTY:
        return None
    if negation not in ("_", "neg", "aff"):
        return None
    position_texts = list(split_top(positions, " + "))
    slots = [s for position in position_texts if (s := parse_slot(position))]
    idiom = any(LEXICALISED in position for position in position_texts)
    return lemma.strip(), {
        "negation": negation,
        "certainty": certainty,
        "idiom": idiom,
        "slots": slots,
    }


def read(lines: Iterable[str]) -> Lexicon:
    frames: Lexicon = {}
    for line in lines:
        parsed = parse_line(line)
        if parsed is None:
            continue
        lemma, frame = parsed
        existing = frames.setdefault(lemma, [])
        if frame not in existing:
            existing.append(frame)
    return frames


class ValencyFile(TypedDict):
    version: str
    """walenty-{release date}: part of the analyzer version string."""
    frames: Lexicon


def write(frames: Lexicon, version: str, path: Path) -> None:
    content: ValencyFile = {"version": version, "frames": frames}
    path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")), "utf-8")


def build_main() -> None:
    import argparse
    import re
    import sys

    parser = argparse.ArgumentParser(
        prog="skolia-build-valency",
        description="Convert Walenty's verb file (plain-text release) into a frames file.",
    )
    parser.add_argument("walenty", type=Path, help="walenty_YYYYMMDD_verbs_verified.txt")
    parser.add_argument("out", type=Path, help="output .json")
    args = parser.parse_args()
    path: Path = args.walenty
    date = re.search(r"(\d{8})", path.name)
    version = f"walenty-{date.group(1) if date else 'unknown'}"
    with path.open(encoding="utf-8-sig") as lines:
        frames = read(lines)
    write(frames, version, args.out)
    count = sum(len(f) for f in frames.values())
    print(f"{version}: {count} frames for {len(frames)} lemmas", file=sys.stderr)


@dataclass(frozen=True)
class Requirement:
    """What a verb's frames allow for one complement."""

    lexical: frozenset[Case]
    """Cases the verb itself asks for (szukać: Gen; pomagać: Dat)."""
    structural: bool
    """An np(str) object: accusative, genitive when negated (mieć)."""
    partitive: bool
    """An np(part) object: genitive or accusative (nalać)."""

    def allowed(self, negated: bool) -> frozenset[Case]:
        cases = set(self.lexical)
        if self.structural:
            cases.add("Gen" if negated else "Acc")
        if self.partitive:
            cases.update(("Gen", "Acc"))
        return frozenset(cases)


class Valency:
    def __init__(self, frames: Lexicon, version: str) -> None:
        self._frames = frames
        self.version = version

    @classmethod
    def load(cls, path: Path) -> Valency:
        content = cast(ValencyFile, json.loads(path.read_text("utf-8")))
        return cls(content["frames"], content["version"])

    def known(self, lemma: str, reflexive: bool) -> bool:
        return _key(lemma, reflexive) in self._frames

    def bare_objects(self, lemma: str, reflexive: bool, negated: bool) -> Requirement | None:
        """Cases of the verb's non-subject noun complements without a preposition, from
        the frames that apply with or without negation. None if Walenty lacks the verb."""
        frames = self._frames.get(_key(lemma, reflexive))
        if frames is None:
            return None
        lexical: set[Case] = set()
        structural = partitive = False
        for frame in _applicable(frames, negated):
            if frame["idiom"]:
                continue
            for slot in frame["slots"]:
                if SUBJECT in slot["labels"]:
                    continue
                for phrase in slot["phrases"]:
                    if phrase["prep"] is not None:
                        continue
                    if phrase["case"] == "str":
                        structural = True
                    elif phrase["case"] == "part":
                        partitive = True
                    elif (case := UD_CASE.get(phrase["case"])) is not None:
                        lexical.add(case)
        return Requirement(frozenset(lexical), structural, partitive)


def _key(lemma: str, reflexive: bool) -> str:
    return lemma + REFLEXIVE_SUFFIX if reflexive else lemma


def _applicable(frames: list[Frame], negated: bool) -> Iterator[Frame]:
    for frame in frames:
        if frame["negation"] == "_" or (frame["negation"] == "neg") == negated:
            yield frame
