from typing import Literal

from skolia_analysis.lang.fr.lemmas import dictionary_lemma, relemmatize
from skolia_analysis.parsed import ParsedSentence, ParsedToken, ParsedWord
from skolia_analysis.schema import Feats, Upos


def word(text: str, lemma: str, upos: Upos, feats: Feats) -> ParsedWord:
    return ParsedWord(text, lemma, upos, None, feats, None, None)


def possessive(
    text: str, owner_person: Literal["1", "2", "3"], owner_number: Literal["Sing", "Plur"]
) -> ParsedWord:
    """GSD's lemma, son, and the owner's person and number."""
    feats: Feats = {"Poss": "Yes", "PronType": "Prs"}
    feats["Person[psor]"] = owner_person
    feats["Number[psor]"] = owner_number
    return word(text, "son", "DET", feats)


def pronoun(text: str, lemma: str, feats: Feats | None = None) -> ParsedWord:
    return word(text, lemma, "PRON", {"PronType": "Prs", **(feats or {})})


def test_a_possessive_is_under_its_owner_s_headword() -> None:
    # GSD lemmatizes them all son
    assert dictionary_lemma(possessive("ma", "1", "Sing")) == "mon"
    assert dictionary_lemma(possessive("tes", "2", "Sing")) == "ton"
    assert dictionary_lemma(possessive("sa", "3", "Sing")) == "son"
    assert dictionary_lemma(possessive("nos", "1", "Plur")) == "notre"
    assert dictionary_lemma(possessive("vos", "2", "Plur")) == "votre"
    assert dictionary_lemma(possessive("leurs", "3", "Plur")) == "leur"


def test_a_personal_pronoun_is_its_own_headword() -> None:
    # GSD gives il, elle and le the lemma lui, je and me moi, se soi
    assert dictionary_lemma(pronoun("il", "lui", {"Case": "Nom"})) == "il"
    assert dictionary_lemma(pronoun("Elle", "lui", {"Case": "Nom"})) == "elle"
    assert dictionary_lemma(pronoun("je", "moi", {"Case": "Nom"})) == "je"
    assert dictionary_lemma(pronoun("lui", "lui", {"Case": "Dat"})) == "lui"
    assert dictionary_lemma(pronoun("moi", "moi", {"Emph": "Yes"})) == "moi"
    assert dictionary_lemma(pronoun("y", "y")) == "y"


def test_elided_inverted_and_plural_pronouns() -> None:
    assert dictionary_lemma(pronoun("j'", "moi")) == "je"
    assert dictionary_lemma(pronoun("m’", "moi")) == "me"  # noqa: RUF001
    assert dictionary_lemma(pronoun("s'", "soi", {"Reflex": "Yes"})) == "se"
    assert dictionary_lemma(pronoun("l'", "lui", {"Gender": "Fem", "Case": "Acc"})) == "la"
    assert dictionary_lemma(pronoun("l'", "lui", {"Case": "Acc"})) == "le"
    assert dictionary_lemma(pronoun("-t-elle", "lui")) == "elle"
    assert dictionary_lemma(pronoun("-il", "lui")) == "il"
    assert dictionary_lemma(pronoun("les", "lui", {"Case": "Acc"})) == "le"
    assert dictionary_lemma(pronoun("eux", "lui", {"Emph": "Yes"})) == "lui"


def test_other_words_keep_the_parser_s_lemma() -> None:
    assert dictionary_lemma(word("le", "le", "DET", {"Definite": "Def"})) is None
    assert dictionary_lemma(word("qui", "qui", "PRON", {"PronType": "Rel"})) is None


def test_relemmatize_keeps_the_features() -> None:
    ma = possessive("ma", "1", "Sing")
    chienne = word("chienne", "chienne", "NOUN", {"Gender": "Fem", "Number": "Sing"})
    sentence = ParsedSentence(
        (ParsedToken("ma", 0, 2, (ma,)), ParsedToken("chienne", 3, 10, (chienne,)))
    )
    [out] = relemmatize([sentence])
    assert [w.lemma for t in out.tokens for w in t.words] == ["mon", "chienne"]
    assert out.tokens[0].words[0].feats == ma.feats
    assert out.tokens[1].words[0] is chienne
