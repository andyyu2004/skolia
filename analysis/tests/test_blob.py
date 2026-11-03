from skolia_analysis.blob import lemma_id, match_expressions, parse_feats
from skolia_analysis.schema import ExpressionDef


def test_parse_feats() -> None:
    assert parse_feats("Case=Gen|Number=Sing") == {"Case": "Gen", "Number": "Sing"}
    assert parse_feats(None) == {}


def test_lemma_id() -> None:
    assert lemma_id("pl", "pies", "NOUN") == "pl:pies:NOUN"
    assert lemma_id("pl", ".", "PUNCT") is None


def test_expression_matches_inflected_forms_by_lemma() -> None:
    exprs: list[ExpressionDef] = [{"id": "pl:dać sobie radę", "lemmas": ["dać", "siebie", "rada"]}]
    lemmas = ["ona", "dać", "siebie", "rada", "."]
    assert match_expressions(lemmas, exprs) == [{"from": 1, "to": 3, "id": "pl:dać sobie radę"}]


def test_expression_no_match() -> None:
    exprs: list[ExpressionDef] = [{"id": "x", "lemmas": ["w", "ogóle"]}]
    assert match_expressions(["nie", "wiem"], exprs) == []
