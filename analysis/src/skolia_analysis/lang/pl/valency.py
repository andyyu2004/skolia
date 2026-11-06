"""Which cases a Polish verb's complements take, from Walenty (walenty/, CC BY-SA 4.0).

skolia-build-valency parses the whole plain-text release into the typed model
(walenty/model.py) and writes it as one JSON file: every schema of verbs, nouns,
adjectives and adverbs, plus the expansions. Valency answers questions about it.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

from ...schema import Case, Upos
from .walenty.model import Expansions, Phrase, Schema
from .walenty.parse import parse_expansions, parse_schema, schema_lines
from .walenty.vocabulary import CaseSpec, Lemma, PartOfSpeech

# Walenty case -> UD Case
UD_CASE: dict[CaseSpec, Case] = {
    "nom": "Nom",
    "gen": "Gen",
    "dat": "Dat",
    "acc": "Acc",
    "inst": "Ins",
    "loc": "Loc",
}

# Which Walenty file a lexicon entry's part of speech looks in
WALENTY_POS: dict[Upos, PartOfSpeech] = {
    "VERB": "verb",
    "AUX": "verb",
    "NOUN": "noun",
    "PROPN": "noun",
    "ADJ": "adj",
    "ADV": "adv",
}

# The release's files, by part of speech
FILES: dict[PartOfSpeech, str] = {
    "verb": "verbs/walenty_{date}_verbs_verified.txt",
    "noun": "nouns/walenty_{date}_nouns_verified.txt",
    "adj": "adjs/walenty_{date}_adjs_verified.txt",
    "adv": "advs/walenty_{date}_advs_verified.txt",
}
EXPANSIONS_FILE = "phrase_types_expand_{date}.txt"
# Idiom parts: their slots belong to the idiom (mieć dość czegoś), not the word
IDIOMATIC = frozenset({"lex", "lexcompar", "fixed"})


class ValencyFile(TypedDict):
    version: str
    """walenty-{release date}: part of the analyzer version string."""
    schemata: list[Schema]
    expansions: Expansions


def read_release(root: Path, date: str) -> ValencyFile:
    """Parse every verified schema and the expansions of a release folder."""
    with (root / EXPANSIONS_FILE.format(date=date)).open(encoding="utf-8") as lines:
        expansions = parse_expansions(lines)
    complex_prepositions = frozenset(expansions["complex_prepositions"])
    schemata: list[Schema] = []
    for pos, name in FILES.items():
        with (root / name.format(date=date)).open(encoding="utf-8") as lines:
            schemata += [
                parse_schema(line, pos, complex_prepositions) for line in schema_lines(lines)
            ]
    return {"version": f"walenty-{date}", "schemata": schemata, "expansions": expansions}


def write(content: ValencyFile, path: Path) -> None:
    path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")), "utf-8")


def build_main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        prog="skolia-build-valency",
        description="Parse Walenty's plain-text release into one typed JSON file.",
    )
    parser.add_argument("release", type=Path, help="the unzipped walenty_YYYYMMDD-text folder")
    parser.add_argument("out", type=Path, help="output .json")
    args = parser.parse_args()
    root: Path = args.release
    expansions = sorted(root.glob(EXPANSIONS_FILE.format(date="*")))
    if not expansions:
        sys.exit(f"no {EXPANSIONS_FILE.format(date='*')} in {root}")
    date = re.search(r"(\d{8})", expansions[-1].name)
    if date is None:
        sys.exit(f"no date in {expansions[-1].name}")
    content = read_release(root, date.group(1))
    write(content, args.out)
    lemmas = {(s["pos"], s["lemma"], s["reflexive"]) for s in content["schemata"]}
    print(
        f"{content['version']}: {len(content['schemata'])} schemata for {len(lemmas)} lemmas",
        file=sys.stderr,
    )


@dataclass(frozen=True)
class Requirement:
    """What a word's schemata allow for its complements without a preposition."""

    lexical: frozenset[Case]
    """Cases the word itself asks for (szukać: Gen; pomagać: Dat)."""
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


type Key = tuple[PartOfSpeech, Lemma, bool]
"""(part of speech, lemma, takes się)."""


class Valency:
    def __init__(self, content: ValencyFile) -> None:
        self.version = content["version"]
        self.expansions = content["expansions"]
        self._schemata: dict[Key, list[Schema]] = {}
        for schema in content["schemata"]:
            key = (schema["pos"], schema["lemma"], schema["reflexive"])
            self._schemata.setdefault(key, []).append(schema)

    @classmethod
    def load(cls, path: Path) -> Valency:
        return cls(cast(ValencyFile, json.loads(path.read_text("utf-8"))))

    def schemata(self, lemma: str, reflexive: bool, pos: PartOfSpeech = "verb") -> list[Schema]:
        return self._schemata.get((pos, Lemma(lemma), reflexive), [])

    def frames(self, lemma: str, upos: Upos) -> list[Schema]:
        """A lexicon entry's schemata for the word sheet: with and without się, leaving
        out those Walenty marks wrong."""
        pos = WALENTY_POS.get(upos)
        if pos is None:
            return []
        both = self.schemata(lemma, False, pos) + self.schemata(lemma, True, pos)
        return [s for s in both if s["certainty"] != "wrong"]

    def bare_objects(
        self, lemma: str, reflexive: bool, negated: bool, pos: PartOfSpeech = "verb"
    ) -> Requirement | None:
        """Cases of the word's non-subject noun complements without a preposition, from
        the schemata that apply with or without negation, leaving out idioms and schemata
        marked wrong. None if Walenty lacks the word."""
        schemata = self.schemata(lemma, reflexive, pos)
        if not schemata:
            return None
        lexical: set[Case] = set()
        structural = partitive = False
        for phrase in _bare_complements(schemata, negated):
            match phrase["kind"]:
                case "np" | "adjp" | "nump":
                    if phrase["case"] == "str":
                        structural = True
                    elif phrase["case"] == "part":
                        partitive = True
                    elif (case := UD_CASE.get(phrase["case"])) is not None:
                        lexical.add(case)
                case _:
                    pass
        return Requirement(frozenset(lexical), structural, partitive)


def _bare_complements(schemata: list[Schema], negated: bool) -> Iterator[Phrase]:
    for schema in schemata:
        if schema["certainty"] == "wrong":
            continue
        if schema["negation"] != "any" and (schema["negation"] == "neg") != negated:
            continue
        phrases = [p for position in schema["positions"] for p in position["phrases"]]
        if any(p["kind"] in IDIOMATIC for p in phrases):
            continue
        for position in schema["positions"]:
            if "subj" not in position["labels"]:
                yield from position["phrases"]
