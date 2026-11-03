from skolia_analysis.nkjp import to_ud


def test_noun_with_animacy() -> None:
    assert list(to_ud("subst:sg:gen:m2")) == [
        ("NOUN", {"Number": "Sing", "Case": "Gen", "Gender": "Masc", "Animacy": "Nhum"})
    ]


def test_dotted_alternatives_expand() -> None:
    readings = list(to_ud("subst:sg:nom.acc:m3"))
    assert [f["Case"] for _, f in readings] == ["Nom", "Acc"]


def test_verb() -> None:
    assert list(to_ud("fin:sg:pri:imperf")) == [
        ("VERB", {"Number": "Sing", "Person": "1", "Aspect": "Imp"})
    ]


def test_unknown_class_is_x() -> None:
    assert list(to_ud("whatever:sg")) == [("X", {"Number": "Sing"})]
