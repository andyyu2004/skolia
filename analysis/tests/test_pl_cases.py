"""One test per case rule, on hand-built trees (PDB relation names), so no parser runs."""

from skolia_analysis.pl_cases import correct_cases, explain_cases
from skolia_analysis.schema import Case, Deprel, Feats, Reading, Token, Upos
from skolia_analysis.valency import Valency, read

VALENCY = Valency(
    read(
        [
            "szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)}",
            "mieć: pewny: _: : imperf: subj{np(str)} + {np(str)}",
            "pomagać: pewny: _: : imperf: subj{np(str)} + {np(dat)}",
            "odnaleźć: pewny: _: : perf: subj{np(str)} + obj{np(str)}",
            "czytać: pewny: _: : imperf: subj{np(str)} + obj{np(str)}",
            "artykułować: pewny: _: : imperf: subj{np(str)} + obj{np(str)}",
        ]
    ),
    "walenty-test",
)


def tok(
    text: str,
    lemma: str,
    upos: Upos,
    head: int | None,
    deprel: Deprel,
    feats: Feats | None = None,
) -> Token:
    return {
        "start": 0,
        "end": 0,
        "text": text,
        "lemma": lemma,
        "lemma_id": None,
        "upos": upos,
        "xpos": None,
        "feats": feats or {},
        "head": head,
        "deprel": deprel,
    }


def noun(text: str, lemma: str, head: int | None, deprel: Deprel, case: Case) -> Token:
    feats: Feats = {"Case": case, "Number": "Sing", "Gender": "Masc", "Animacy": "Nhum"}
    return tok(text, lemma, "NOUN", head, deprel, feats)


def reading(lemma: str, case: Case) -> Reading:
    feats: Feats = {"Case": case, "Number": "Sing", "Gender": "Masc", "Animacy": "Nhum"}
    return {"lemma": lemma, "upos": "NOUN", "xpos": f"subst:sg:{case.lower()}:m2", "feats": feats}


def reasons(tokens: list[Token]) -> list[tuple[str, str | None, int | None]]:
    explain_cases(tokens, VALENCY)
    return [
        (t["text"], r["rule"], r.get("trigger"))
        if (r := t.get("case_reason"))
        else (t["text"], None, None)
        for t in tokens
    ]


def reason_of(tokens: list[Token], index: int) -> tuple[str | None, int | None, str | None]:
    explain_cases(tokens, VALENCY)
    r = tokens[index].get("case_reason")
    return (r["rule"], r.get("trigger"), r.get("governor")) if r else (None, None, None)


def test_negation_makes_a_structural_object_genitive() -> None:
    # Nie mam czasu
    tokens = [
        tok("Nie", "nie", "PART", 1, "advmod:neg"),
        tok("mam", "mieć", "VERB", None, "root"),
        noun("czasu", "czas", 1, "iobj", "Gen"),
    ]
    assert reason_of(tokens, 2) == ("negation", 0, "mieć")


def test_negation_reaches_an_infinitive_complement() -> None:
    # nie mogli odnaleźć pana: nie hangs off mogli
    tokens = [
        tok("nie", "nie", "PART", 1, "advmod:neg"),
        tok("mogli", "móc", "VERB", None, "root"),
        tok("odnaleźć", "odnaleźć", "VERB", 1, "xcomp"),
        noun("pana", "pan", 2, "obj", "Gen"),
    ]
    assert reason_of(tokens, 3) == ("negation", 0, "odnaleźć")


def test_structural_object_is_accusative() -> None:
    # Mam czas
    tokens = [tok("Mam", "mieć", "VERB", None, "root"), noun("czas", "czas", 0, "obj", "Acc")]
    assert reason_of(tokens, 1) == ("structural", 0, "mieć")


def test_verb_asks_for_its_case_and_adjectives_agree() -> None:
    # Pomagam starszemu bratu
    tokens = [
        tok("Pomagam", "pomagać", "VERB", None, "root"),
        tok("starszemu", "stary", "ADJ", 2, "amod", {"Case": "Dat"}),
        noun("bratu", "brat", 0, "iobj", "Dat"),
    ]
    assert reasons(tokens) == [
        ("Pomagam", None, None),
        ("starszemu", "agreement", 2),
        ("bratu", "verb", 0),
    ]


def test_preposition_including_multi_word_prepositions() -> None:
    # w stosunku do Estonii: PDB hangs stosunku and do off w as fixed
    tokens = [
        tok("w", "w", "ADP", 3, "case"),
        noun("stosunku", "stosunek", 0, "fixed", "Loc"),
        tok("do", "do", "ADP", 0, "fixed"),
        noun("Estonii", "Estonia", None, "root", "Gen"),
    ]
    assert reason_of(tokens, 3) == ("preposition", 0, "w stosunku do")


def test_governing_numeral_takes_the_genitive() -> None:
    # Wiele osób przyszło
    tokens = [
        tok("Wiele", "wiele", "DET", 1, "det:numgov", {"Case": "Nom"}),
        noun("osób", "osoba", 2, "nsubj", "Gen"),
        tok("przyszło", "przyjść", "VERB", None, "root"),
    ]
    assert reason_of(tokens, 1) == ("numeral", 0, None)


def test_verbal_noun_object_is_genitive() -> None:
    # czytanie książek
    tokens = [
        tok("czytanie", "czytać", "NOUN", None, "root", {"Case": "Nom", "VerbForm": "Vnoun"}),
        noun("książek", "książka", 0, "obj", "Gen"),
    ]
    assert reason_of(tokens, 1) == ("verbal-noun", 0, "czytać")


def test_subject_predicate_possessive_vocative_coordination() -> None:
    # Brat Kasi jest lekarzem
    tokens = [
        noun("Brat", "brat", 3, "nsubj", "Nom"),
        noun("Kasi", "Kasia", 0, "nmod", "Gen"),
        tok("jest", "być", "AUX", 3, "cop"),
        noun("lekarzem", "lekarz", None, "root", "Ins"),
    ]
    assert [r for _, r, _ in reasons(tokens)] == ["subject", "possessive", None, "predicate"]
    assert reason_of([noun("Kasiu", "Kasia", None, "vocative", "Voc")], 0)[0] == "vocative"
    # ryż i pszenica
    listing = [
        noun("ryż", "ryż", None, "root", "Nom"),
        noun("pszenica", "pszenica", 0, "conj", "Nom"),
    ]
    assert reason_of(listing, 1) == ("coordination", 0, None)


def szukam_psa(case: Case) -> list[Token]:
    psa = noun("psa", "pies", 0, "obj", case)
    psa["candidates"] = [reading("pies", "Gen"), reading("pies", "Acc")]
    return [tok("Szukam", "szukać", "VERB", None, "root"), psa]


def test_lexical_correction_fixes_an_ambiguous_form() -> None:
    # psa is genitive or accusative; szukać only takes the genitive
    tokens = szukam_psa("Acc")
    assert correct_cases(tokens, VALENCY, "lexical") == 1
    assert tokens[1]["feats"].get("Case") == "Gen"
    assert tokens[1].get("parser", {}).get("feats", {}).get("Case") == "Acc"
    assert reason_of(tokens, 1) == ("verb", 0, "szukać")


def test_correction_off_leaves_the_parser_alone() -> None:
    tokens = szukam_psa("Acc")
    assert correct_cases(tokens, VALENCY, "off") == 0
    assert tokens[1]["feats"].get("Case") == "Acc"


def test_lexical_correction_skips_verbs_with_a_structural_object() -> None:
    # usta artykułowały: the parser labelled the subject as the object (from PDB test);
    # "all" would make it accusative, "lexical" leaves verbs with np(str) alone
    usta = noun("usta", "usta", 1, "obj", "Nom")
    usta["candidates"] = [reading("usta", "Nom"), reading("usta", "Acc")]
    tokens = [
        tok("Wargi", "warga", "NOUN", 1, "nsubj"),
        tok("artykułowały", "artykułować", "VERB", None, "root"),
        usta,
    ]
    tokens[2]["head"] = 1
    assert correct_cases(tokens, VALENCY, "lexical") == 0
    assert tokens[2]["feats"].get("Case") == "Nom"


def test_correction_skips_numerals_and_question_words() -> None:
    # szukam dwóch psów: the numeral makes psów genitive whatever the verb says
    tokens = szukam_psa("Acc")
    tokens.append(tok("dwóch", "dwa", "NUM", 1, "nummod:gov", {"Case": "Acc"}))
    assert correct_cases(tokens, VALENCY, "all") == 0
    # co: a question word opens its own clause
    co = szukam_psa("Acc")
    co[1]["feats"]["PronType"] = "Int"
    co[1]["upos"] = "PRON"
    assert correct_cases(co, VALENCY, "all") == 0
