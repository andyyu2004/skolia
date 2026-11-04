from skolia_analysis.valency import Valency, parse_line, read, split_top

SZUKAC = "szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)} + {prepnp(w,loc)}"
MIEC = "mieć: pewny: _: : imperf: subj{np(str)} + {np(str)} + {xp(locat)}"
MIEC_DOSC = (
    "mieć: pewny: _: : imperf: subj{np(str)} + {np(gen)} + {lex(advp(misc),pos,'dość',natr)}"
)
BAC_SIE = "bać się: pewny: _: : imperf: subj{np(str)} + {np(gen);cp(że)}"
NEG_ONLY = "bać się: pewny: neg: : imperf: subj{np(str)} + {np(dat)}"
WRONG = "szukać: zły: _: : imperf: subj{np(str)} + {np(dat)}"


def test_split_top_ignores_separators_inside_brackets() -> None:
    frame = "subj{np(str)} + {lex(np(gen),sg,'woda',ratr({adjp(agr)}+{np(gen)}))}"
    assert list(split_top(frame, " + ")) == [
        "subj{np(str)}",
        "{lex(np(gen),sg,'woda',ratr({adjp(agr)}+{np(gen)}))}",
    ]


def test_parse_line_keeps_cased_phrases_and_labels() -> None:
    parsed = parse_line(SZUKAC)
    assert parsed is not None
    lemma, frame = parsed
    assert lemma == "szukać"
    assert frame["idiom"] is False
    assert frame["slots"] == [
        {"labels": ["subj"], "phrases": [{"case": "str", "prep": None}]},
        {"labels": ["obj"], "phrases": [{"case": "gen", "prep": None}]},
        {"labels": [], "phrases": [{"case": "loc", "prep": "w"}]},
    ]


def test_wrong_frames_and_comments_are_skipped() -> None:
    assert parse_line(WRONG) is None
    assert parse_line("% a comment") is None


def valency(*lines: str) -> Valency:
    return Valency(read(lines), "walenty-test")


def test_lexical_case() -> None:
    requirement = valency(SZUKAC).bare_objects("szukać", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.lexical == {"Gen"}
    assert requirement.allowed(negated=False) == {"Gen"}


def test_structural_object_is_genitive_when_negated() -> None:
    requirement = valency(MIEC).bare_objects("mieć", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.structural
    assert requirement.allowed(negated=False) == {"Acc"}
    assert requirement.allowed(negated=True) == {"Gen"}


def test_idiom_frames_say_nothing_about_the_verb() -> None:
    # mieć dość czegoś: the genitive is the idiom's, not mieć's
    requirement = valency(MIEC, MIEC_DOSC).bare_objects("mieć", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.lexical == frozenset()


def test_reflexive_verbs_and_negation_only_frames() -> None:
    v = valency(BAC_SIE, NEG_ONLY)
    assert v.bare_objects("bać", reflexive=False, negated=False) is None
    plain = v.bare_objects("bać", reflexive=True, negated=False)
    negated = v.bare_objects("bać", reflexive=True, negated=True)
    assert plain is not None and negated is not None
    assert plain.lexical == {"Gen"}
    assert negated.lexical == {"Gen", "Dat"}
