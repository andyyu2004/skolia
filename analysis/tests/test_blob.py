from skolia_analysis.blob import lemma_id, match_expressions
from skolia_analysis.schema import ExpressionDef

DAC_SOBIE_RADE: list[ExpressionDef] = [
    {"id": "pl:dać sobie radę", "lemmas": ["dać", "siebie", "rada"]}
]


def test_lemma_id() -> None:
    assert lemma_id("pl", "pies", "NOUN") == "pl:pies:NOUN"
    assert lemma_id("pl", ".", "PUNCT") is None


def test_expression_matches_inflected_forms_by_lemma() -> None:
    lemmas = ["ona", "dać", "siebie", "rada", "."]
    assert match_expressions(lemmas, DAC_SOBIE_RADE) == [
        {"from": 1, "to": 3, "id": "pl:dać sobie radę"}
    ]


def test_expression_no_match() -> None:
    exprs: list[ExpressionDef] = [{"id": "x", "lemmas": ["w", "ogóle"]}]
    assert match_expressions(["nie", "wiem"], exprs) == []


def test_expression_steps_over_gaps() -> None:
    lemmas = ["dać", "być", "siebie", "rada", "."]
    gaps = [False, True, False, False, False]
    assert match_expressions(lemmas, DAC_SOBIE_RADE) == []
    assert match_expressions(lemmas, DAC_SOBIE_RADE, gaps) == [
        {"from": 0, "to": 3, "id": "pl:dać sobie radę"}
    ]
