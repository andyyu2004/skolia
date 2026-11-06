"""One test per case rule, on hand-built trees (PDB relation names), so no parser runs."""

from skolia_analysis.lang.pl.cases import correct_cases, explain_cases
from skolia_analysis.lang.pl.valency import Valency
from skolia_analysis.lang.pl.walenty.parse import empty_expansions, parse_schema
from skolia_analysis.schema import Case, Deprel, Feats, Reading, Token, Upos

SCHEMATA = [
    "szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)}",
    "mieć: pewny: _: : imperf: subj{np(str)} + {np(str)}",
    "pomagać: pewny: _: : imperf: subj{np(str)} + {np(dat)}",
    "odnaleźć: pewny: _: : perf: subj{np(str)} + obj{np(str)}",
    "czytać: pewny: _: : imperf: subj{np(str)} + obj{np(str)}",
    "bać się: pewny: _: : imperf: subj{np(str)} + {np(gen)}",
    "oczekiwać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)}",
    # nazywać has an ordinary object without się, so a się after it may be impersonal
    "nazywać: pewny: _: : imperf: subj{np(str)} + obj{np(str)} + {adjp(inst)}",
    "nazywać się: pewny: _: : imperf: subj{np(str)} + {np(nom)}",
]
VALENCY = Valency(
    {
        "version": "walenty-test",
        "schemata": [parse_schema(line, "verb") for line in SCHEMATA],
        "expansions": empty_expansions(),
    }
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


def reading(lemma: str, case: Case, upos: Upos = "NOUN") -> Reading:
    feats: Feats = {"Case": case, "Number": "Sing", "Gender": "Masc", "Animacy": "Nhum"}
    return {"lemma": lemma, "upos": upos, "xpos": f"x:{case.lower()}", "feats": feats}


def ambiguous(token: Token, *cases: Case) -> Token:
    """Give a token dictionary readings that differ only in case, like psa (gen = acc)."""
    token["candidates"] = [reading(token["lemma"] or "", c, token["upos"]) for c in cases]
    return token


def szukam_starego_psa(case: Case) -> list[Token]:
    stary = tok("starego", "stary", "ADJ", 2, "amod")
    stary["feats"] = {"Case": case, "Number": "Sing", "Gender": "Masc", "Animacy": "Nhum"}
    return [
        tok("Szukam", "szukać", "VERB", None, "root"),
        ambiguous(stary, "Gen", "Acc"),
        ambiguous(noun("psa", "pies", 0, "obj", case), "Gen", "Acc"),
    ]


def test_lexical_genitive_object() -> None:
    assert reason_of(szukam_starego_psa("Gen"), 2) == ("verb", 0, "szukać")


def test_genitive_verb_corrects_a_look_alike_accusative_and_its_adjective() -> None:
    # The parser tags psa accusative; szukać only takes the genitive, and psa (like
    # starego) is the same form in both
    tokens = szukam_starego_psa("Acc")
    assert correct_cases(tokens, VALENCY) == 2
    assert [t["feats"].get("Case") for t in tokens[1:]] == ["Gen", "Gen"]
    assert tokens[2].get("case_correction") == {"original": "Acc", "governor": "szukać"}
    assert tokens[2].get("parser", {}).get("feats", {}).get("Case") == "Acc"
    assert reason_of(tokens, 2) == ("verb", 0, "szukać")


def test_correction_from_the_treebank_review() -> None:
    # Urzędnicy boją się go; mama oczekiwała mnie: PDB annotates both accusative, but the
    # verbs take the genitive and go/mnie look the same in both
    accusative: Feats = {"Case": "Acc", "Number": "Sing", "Gender": "Masc", "Animacy": "Nhum"}
    go = ambiguous(tok("go", "on", "PRON", 0, "iobj", accusative.copy()), "Gen", "Acc")
    boja = [tok("boją", "bać", "VERB", None, "root"), go, tok("się", "się", "PRON", 0, "expl:pv")]
    assert correct_cases(boja, VALENCY) == 1
    mnie = ambiguous(tok("mnie", "ja", "PRON", 0, "obj", accusative.copy()), "Gen", "Acc")
    assert correct_cases([tok("oczekiwała", "oczekiwać", "VERB", None, "root"), mnie], VALENCY) == 1


def test_no_correction_where_się_may_be_impersonal() -> None:
    # Takie przemiany nazywa się skojarzonymi: "one calls such changes ...", an
    # accusative object; not nazywać się (to be called) + nominative
    przemiany = ambiguous(noun("przemiany", "przemiana", 0, "obj", "Acc"), "Nom", "Acc")
    tokens = [
        tok("nazywa", "nazywać", "VERB", None, "root"),
        przemiany,
        tok("się", "się", "PRON", 0, "expl:pv"),
    ]
    assert correct_cases(tokens, VALENCY) == 0


def test_no_correction_for_verbs_with_a_structural_object() -> None:
    # usta artykułowały: the parser labelled the subject as the object (from PDB test)
    usta = ambiguous(noun("usta", "usta", 0, "obj", "Nom"), "Nom", "Acc")
    assert correct_cases([tok("artykułowały", "czytać", "VERB", None, "root"), usta], VALENCY) == 0


def test_no_correction_with_a_numeral_or_for_question_words() -> None:
    tokens = szukam_starego_psa("Acc")
    tokens.append(tok("dwóch", "dwa", "NUM", 2, "nummod:gov", {"Case": "Acc"}))
    assert correct_cases(tokens, VALENCY) == 0
    question = szukam_starego_psa("Acc")
    question[2]["feats"]["PronType"] = "Int"
    question[2]["upos"] = "PRON"
    assert correct_cases(question, VALENCY) == 0
