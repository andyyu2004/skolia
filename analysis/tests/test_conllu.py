from skolia_analysis.blob import build
from skolia_analysis.conllu import write
from skolia_analysis.parsed import ParsedSentence, ParsedToken, ParsedWord

TEXT = "Dałem radę."


def word(text: str, lemma: str, head: int | None) -> ParsedWord:
    return ParsedWord(text, lemma, "X", None, {}, head, "dep" if head is not None else "root")


def test_fused_word_and_space_after() -> None:
    sentence = ParsedSentence(
        (
            ParsedToken("Dałem", 0, 5, (word("Dał", "dać", None), word("em", "być", 0))),
            ParsedToken("radę", 6, 10, (word("radę", "rada", 0),)),
            ParsedToken(".", 10, 11, (word(".", ".", 0),)),
        )
    )
    blob = build([sentence], lang="pl", analyzer="test", text=TEXT)
    lines = write(blob, TEXT).splitlines()
    assert lines[0] == "# text = Dałem radę."
    assert lines[1].split("\t") == ["1-2", "Dałem", *["_"] * 8]
    assert lines[2].split("\t")[:8] == ["1", "Dał", "dać", "X", "_", "_", "0", "root"]
    assert lines[3].split("\t")[6] == "1"
    assert lines[4].split("\t")[9] == "SpaceAfter=No"
    assert lines[5].split("\t")[9] == "_"
