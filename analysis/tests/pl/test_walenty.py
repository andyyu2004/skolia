import re
from pathlib import Path

import pytest

from skolia_analysis.lang.pl.walenty.model import Phrase, Position
from skolia_analysis.lang.pl.walenty.parse import (
    WalentyError,
    parse_expansions,
    parse_positions,
    parse_schema,
    schema_lines,
)
from skolia_analysis.lang.pl.walenty.render import render_schema
from skolia_analysis.lang.pl.walenty.vocabulary import PartOfSpeech

WALENTY = Path(__file__).resolve().parents[3] / "data/walenty/text/walenty_20180630-text"


def phrase(text: str) -> Phrase:
    (position,) = parse_positions("{" + text + "}")
    (only,) = position["phrases"]
    return only


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("np(gen)", {"kind": "np", "case": "gen"}),
        ("adjp(agr)", {"kind": "adjp", "case": "agr"}),
        ("nump(str)", {"kind": "nump", "case": "str"}),
        ("prepnp(w,loc)", {"kind": "prepnp", "prep": "w", "case": "loc"}),
        ("prepnp(co do,gen)", {"kind": "prepnp", "prep": "co do", "case": "gen"}),
        ("prepadjp(po,postp)", {"kind": "prepadjp", "prep": "po", "case": "postp"}),
        ("prepnump(na,acc)", {"kind": "prepnump", "prep": "na", "case": "acc"}),
        ("comprepnp(w stosunku do)", {"kind": "comprepnp", "prep": "w stosunku do"}),
        ("cp(że)", {"kind": "cp", "complementizer": "że", "words": []}),
        ("cp(int[co;kto])", {"kind": "cp", "complementizer": "int", "words": ["co", "kto"]}),
        ("ncp(gen,żeby)", {"kind": "ncp", "case": "gen", "complementizer": "żeby", "words": []}),
        ("infp(perf)", {"kind": "infp", "aspect": "perf"}),
        ("infp(_)", {"kind": "infp", "aspect": "any"}),
        ("xp(locat)", {"kind": "xp", "category": "locat", "realisations": []}),
        (
            "xp(adl[prepnp(do,gen)])",
            {
                "kind": "xp",
                "category": "adl",
                "realisations": [{"kind": "prepnp", "prep": "do", "case": "gen"}],
            },
        ),
        ("advp(mod)", {"kind": "advp", "category": "mod"}),
        ("compar(jak)", {"kind": "compar", "comparator": "jak"}),
        ("refl", {"kind": "refl"}),
        ("E", {"kind": "E"}),
        (
            "fixed(prepnp(w,acc),'w kotka i myszkę')",
            {
                "kind": "fixed",
                "phrase": {"kind": "prepnp", "prep": "w", "case": "acc"},
                "text": "w kotka i myszkę",
            },
        ),
    ],
)
def test_phrase_types(text: str, expected: Phrase) -> None:
    assert phrase(text) == expected


def test_lex_nominal_with_required_modifier() -> None:
    # mieć na oku: oko in the plural after na + accusative, with a required possessive
    assert phrase("lex(prepnp(na,loc),sg,'oko',ratr1({possp}))") == {
        "kind": "lex",
        "phrase": {"kind": "prepnp", "prep": "na", "case": "loc"},
        "form": {"shape": "nominal", "number": "sg"},
        "lemmas": {"kind": "one", "lemma": "oko"},
        "modification": {
            "kind": "ratr1",
            "positions": [{"labels": [], "phrases": [{"kind": "possp"}]}],
        },
    }


def test_lex_adjectival_with_gender_alternatives_and_lemma_choice() -> None:
    lex = phrase("lex(adjp(agr),_,m1.m2.m3.f.n,pos,OR('swój';'własny'),natr)")
    assert lex["kind"] == "lex"
    assert lex["form"] == {
        "shape": "adjectival",
        "number": "any",
        "genders": ["m1", "m2", "m3", "f", "n"],
        "degree": "pos",
    }
    assert lex["lemmas"] == {"kind": "or", "lemmas": ["swój", "własny"]}


def test_lex_verbal_and_active_participle_reflexive_slots() -> None:
    infinitive = phrase("lex(infp(perf),_,'spojrzeć',,natr)")
    assert infinitive["kind"] == "lex"
    assert infinitive["form"] == {"shape": "verbal", "negation": "any", "reflexive": False}
    clause = phrase("lex(ncp(acc,rel[co]),aff,'należeć',się,natr)")
    assert clause["kind"] == "lex"
    assert clause["form"] == {"shape": "verbal", "negation": "aff", "reflexive": True}
    participle = phrase("lex(pactp(agr),agr,agr,aff,'bić',,natr)")
    assert participle["kind"] == "lex"
    assert participle["form"]["shape"] == "participial"


def test_lex_comparison() -> None:
    comparison = phrase("lex(compar(jak),lex(np(nom),sg,'ogień',natr))")
    assert comparison["kind"] == "lexcompar"
    assert [p["lemmas"] for p in comparison["parts"]] == [{"kind": "one", "lemma": "ogień"}]


def test_labels_and_alternatives() -> None:
    positions: list[Position] = parse_positions("subj,controller{np(str)} + {np(gen);cp(że)}")
    assert [p["labels"] for p in positions] == [["subj", "controller"], []]
    assert [p["kind"] for p in positions[1]["phrases"]] == ["np", "cp"]


def test_schema_columns() -> None:
    schema = parse_schema("bać się: pewny: neg: : imperf: subj{np(str)} + {np(gen)}", "verb")
    assert (schema["lemma"], schema["reflexive"]) == ("bać", True)
    assert (schema["certainty"], schema["negation"], schema["aspect"]) == (
        "certain",
        "neg",
        "imperf",
    )
    assert not schema["predicative"]


@pytest.mark.parametrize(
    "line",
    [
        "szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)} + {prepnp(w,loc)}",
        "dać: pewny: _: : perf: {infp(_)} + {lex(np(str),sg,'rada',natr)}",
        "uważać: pewny: _: : imperf: subj,controller{np(str)} + controllee,controller2{infp(_)}"
        " + controllee2{prepadjp(za,acc)}",
        "oczekiwać: pewny: _: : imperf: subj{np(str)} + {cp(aż)} + {lex(xp(mod[prepnp(z,inst)]),"
        "_,'serce',ratr1({lex(pactp(agr),agr,agr,aff,'bić',,atr1({advp(mod)}))}))}",
        "strach: pewny: : : : {np(gen)} + {possp}",
        "pewny: pewny: : pred: : {cp(że)}",
    ],
)
def test_round_trip(line: str) -> None:
    pos: PartOfSpeech = (
        "noun" if line.startswith("strach") else "adj" if line.startswith("pewny") else "verb"
    )
    assert render_schema(parse_schema(line, pos)) == line


@pytest.mark.parametrize(
    "text",
    [
        "{np(abl)}",
        "{prepnp(zzz,gen)}",
        "{cp(bogus)}",
        "{frobnicate(x)}",
        "{lex(np(gen),sg,'a',xxx)}",
    ],
)
def test_unknown_values_are_errors(text: str) -> None:
    with pytest.raises(WalentyError):
        parse_positions(text)


def test_expansions_blocks() -> None:
    expansions = parse_expansions(
        [
            "xp(abl)-->\n",
            "    advp(abl)\t[pewna]\n",
            "    comprepnp(od strony)\t[pewna]\n",
            "advp(abl)-->\n",
            "    skąd\t[pewna]\n",
            "    skądinąd\t[archaiczna]\n",
            "comprepnp(od strony)-->\n",
            "    lex(prepnp(od,gen),sg,'strona',ratr1({np(gen)}+{adjp(agr)}))\t[pewna]\n",
            "przeciw-->\n",
            "    przeciwko\n",
        ]
    )
    assert [r["positions"][0]["phrases"][0]["kind"] for r in expansions["adverbials"]["abl"]] == [
        "advp",
        "comprepnp",
    ]
    assert expansions["adverbs"]["abl"][1] == {"word": "skądinąd", "certainty": "archaic"}
    assert "od strony" in expansions["complex_prepositions"]
    assert expansions["variants"] == {"przeciw": ["przeciwko"]}


@pytest.mark.skipif(not WALENTY.exists(), reason="Walenty not downloaded (see DEVELOP.md)")
def test_whole_release_parses_and_round_trips() -> None:
    expansions = parse_expansions(
        (WALENTY / "phrase_types_expand_20180726.txt").open(encoding="utf-8")
    )
    known = frozenset(expansions["complex_prepositions"])
    files: list[tuple[str, PartOfSpeech]] = [
        ("verbs", "verb"),
        ("nouns", "noun"),
        ("adjs", "adj"),
        ("advs", "adv"),
    ]
    count = 0
    for kind, pos in files:
        path = WALENTY / kind / f"walenty_20180726_{kind}_verified.txt"
        for line in schema_lines(path.open(encoding="utf-8")):
            rendered = render_schema(parse_schema(line, pos, known))
            assert normalise(rendered) == normalise(line), line
            count += 1
    assert count == 96829


def normalise(line: str) -> str:
    """OR's lemma separator is written both , and ; in the release; render uses ;."""
    with_or = re.sub(r"OR\(([^)]*)\)", lambda m: "OR(" + m.group(1).replace(",", ";") + ")", line)
    return with_or.strip()
