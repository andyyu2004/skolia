import pytest

from skolia_analysis.ud import UnknownLabel, parse_deprel, parse_feats, parse_upos


def test_parse_feats() -> None:
    assert parse_feats("Case=Gen|Number=Sing") == {"Case": "Gen", "Number": "Sing"}
    assert parse_feats("Number[psor]=Plur") == {"Number[psor]": "Plur"}
    assert parse_feats(None) == {}


def test_unknown_feature_value_raises() -> None:
    with pytest.raises(UnknownLabel):
        parse_feats("Case=Abl")
    with pytest.raises(UnknownLabel):
        parse_feats("Evident=Nfh")


def test_labels() -> None:
    assert parse_upos("NOUN") == "NOUN"
    assert parse_upos(None) == "X"
    assert parse_deprel("aux:clitic") == "aux:clitic"
    with pytest.raises(UnknownLabel):
        parse_upos("NOUNS")
    with pytest.raises(UnknownLabel):
        parse_deprel("obj:weird")
