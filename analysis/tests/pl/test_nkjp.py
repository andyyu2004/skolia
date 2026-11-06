from skolia_analysis.lang.pl.nkjp import UdReading, to_ud
from skolia_analysis.schema import Feats, Upos


def pos_feats(readings: list[UdReading]) -> list[tuple[Upos, Feats]]:
    return [(r.upos, r.feats) for r in readings]


def test_noun_with_animacy() -> None:
    assert pos_feats(list(to_ud("subst:sg:gen:m2", "pies"))) == [
        ("NOUN", {"Number": "Sing", "Case": "Gen", "Gender": "Masc", "Animacy": "Nhum"})
    ]


def test_dotted_alternatives_expand_with_their_own_tag() -> None:
    readings = list(to_ud("subst:sg:nom.acc:m3", "stół"))
    assert [r.feats.get("Case") for r in readings] == ["Nom", "Acc"]
    assert [r.xpos for r in readings] == ["subst:sg:nom:m3", "subst:sg:acc:m3"]


def test_present_tense_verb() -> None:
    assert pos_feats(list(to_ud("fin:sg:pri:imperf", "iść"))) == [
        (
            "VERB",
            {
                "Mood": "Ind",
                "VerbForm": "Fin",
                "Voice": "Act",
                "Number": "Sing",
                "Person": "1",
                "Aspect": "Imp",
                "Tense": "Pres",
            },
        )
    ]


def test_perfective_non_past_is_future() -> None:
    [reading] = to_ud("fin:sg:ter:perf", "zrobić")
    assert reading.feats.get("Tense") == "Fut"


def test_preposition_drops_case_keeps_variant() -> None:
    assert pos_feats(list(to_ud("prep:loc:wok", "w"))) == [
        ("ADP", {"AdpType": "Prep", "Variant": "Long"})
    ]


def test_plurale_tantum() -> None:
    [reading] = to_ud("subst:pl:nom:n:pt", "drzwi")
    assert reading.feats.get("Number") == "Ptan"


def test_proper_name() -> None:
    [reading] = to_ud("subst:sg:gen:f", "Warszawa", proper_name=True)
    assert reading.upos == "PROPN"


def test_function_words() -> None:
    [ten] = to_ud("adj:sg:nom:m3:pos", "ten")
    assert ten.upos == "DET"
    assert ten.feats.get("PronType") == "Dem"
    assert "Degree" not in ten.feats
    assert [r.upos for r in to_ud("part", "się")] == ["PRON"]
    assert [r.feats.get("PronType") for r in to_ud("subst:sg:nom:n:ncol", "co")] == ["Int", "Rel"]
    assert [r.upos for r in to_ud("fin:sg:ter:imperf", "być")] == ["AUX", "VERB"]


def test_unknown_class_is_x() -> None:
    assert pos_feats(list(to_ud("whatever:sg", "x"))) == [("X", {"Number": "Sing"})]
