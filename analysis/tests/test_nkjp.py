from skolia_analysis.nkjp import to_ud


def test_noun_with_animacy() -> None:
    assert list(to_ud("subst:sg:gen:m2", "pies")) == [
        ("NOUN", {"Number": "Sing", "Case": "Gen", "Gender": "Masc", "Animacy": "Nhum"})
    ]


def test_dotted_alternatives_expand() -> None:
    readings = list(to_ud("subst:sg:nom.acc:m3", "stół"))
    assert [f.get("Case") for _, f in readings] == ["Nom", "Acc"]


def test_present_tense_verb() -> None:
    assert list(to_ud("fin:sg:pri:imperf", "iść")) == [
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
    [(_, feats)] = to_ud("fin:sg:ter:perf", "zrobić")
    assert feats.get("Tense") == "Fut"


def test_preposition_drops_case_keeps_variant() -> None:
    assert list(to_ud("prep:loc:wok", "w")) == [("ADP", {"AdpType": "Prep", "Variant": "Long"})]


def test_plurale_tantum() -> None:
    [(_, feats)] = to_ud("subst:pl:nom:n:pt", "drzwi")
    assert feats.get("Number") == "Ptan"


def test_proper_name() -> None:
    [(upos, _)] = to_ud("subst:sg:gen:f", "Warszawa", proper_name=True)
    assert upos == "PROPN"


def test_function_words() -> None:
    [(upos, feats)] = to_ud("adj:sg:nom:m3:pos", "ten")
    assert upos == "DET"
    assert feats.get("PronType") == "Dem"
    assert "Degree" not in feats
    assert [upos for upos, _ in to_ud("part", "się")] == ["PRON"]
    assert [f.get("PronType") for _, f in to_ud("subst:sg:nom:n:ncol", "co")] == ["Int", "Rel"]
    assert [upos for upos, _ in to_ud("fin:sg:ter:imperf", "być")] == ["AUX", "VERB"]


def test_unknown_class_is_x() -> None:
    assert list(to_ud("whatever:sg", "x")) == [("X", {"Number": "Sing"})]
