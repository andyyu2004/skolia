from skolia_analysis.reconcile import same_lemma_and_upos, same_upos
from skolia_analysis.schema import Feats, Reading, Upos


def reading(lemma: str, upos: Upos, feats: Feats, xpos: str = "") -> Reading:
    return {"lemma": lemma, "upos": upos, "xpos": xpos, "feats": feats}


FEM_LOC_PL = reading(
    "rękawiczka", "NOUN", {"Case": "Loc", "Gender": "Fem", "Number": "Plur"}, "subst:pl:loc:f"
)


def test_allowed_reading_is_kept() -> None:
    assert same_upos(FEM_LOC_PL, [FEM_LOC_PL]) is None


def test_impossible_gender_is_fixed() -> None:
    parser = reading(
        "rękawiczka",
        "NOUN",
        {"Animacy": "Inan", "Case": "Loc", "Gender": "Masc", "Number": "Plur"},
    )
    assert same_lemma_and_upos(parser, [FEM_LOC_PL]) == FEM_LOC_PL


def test_invented_lemma_is_replaced_only_by_upos_policy() -> None:
    dictionary = reading("rozpryskiwać", "VERB", {"Aspect": "Imp"})
    parser = reading("rozpryskować", "VERB", {"Aspect": "Imp"})
    assert same_lemma_and_upos(parser, [dictionary]) is None
    assert same_upos(parser, [dictionary]) == dictionary


def test_part_of_speech_is_never_changed_by_upos_policy() -> None:
    parser = reading("stary", "NOUN", {"Case": "Gen"})
    assert same_upos(parser, [reading("stary", "ADJ", {"Case": "Gen"})]) is None


def test_words_the_dictionary_describes_differently_are_kept() -> None:
    dictionary = reading("w", "ADP", {"AdpType": "Prep", "Variant": "Short"})
    multiword_head = reading("w", "ADP", {"AdpType": "Prep", "ExtPos": "ADP"})
    abbreviation = reading("procent", "NOUN", {"Abbr": "Yes"})
    assert same_upos(multiword_head, [dictionary]) is None
    assert same_upos(abbreviation, [reading("proca", "NOUN", {"Case": "Gen"})]) is None


def test_lemma_case_is_kept() -> None:
    parser = reading("Nowy", "ADJ", {"Case": "Loc", "Gender": "Fem"})
    dictionary = reading("nowy", "ADJ", {"Case": "Loc", "Gender": "Masc"})
    fixed = same_upos(parser, [dictionary])
    assert fixed is not None
    assert fixed["lemma"] == "Nowy"
