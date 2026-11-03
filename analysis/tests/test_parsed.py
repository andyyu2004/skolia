import pytest

from skolia_analysis.parsed import AlignmentError, align


def test_align_finds_tokens_across_whitespace() -> None:
    text = "Idę do\n\nstarego psa."
    assert list(align(text, ["Idę", "do", "starego", "psa", "."])) == [
        (0, 3),
        (4, 6),
        (8, 15),
        (16, 19),
        (19, 20),
    ]


def test_align_refuses_to_skip_text() -> None:
    with pytest.raises(AlignmentError):
        list(align("Idę do psa.", ["Idę", "psa"]))
