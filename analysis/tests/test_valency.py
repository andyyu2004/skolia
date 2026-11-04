from skolia_analysis.valency import Valency
from skolia_analysis.walenty.parse import empty_expansions, parse_schema

SZUKAC = "szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)} + {prepnp(w,loc)}"
MIEC = "mieć: pewny: _: : imperf: subj{np(str)} + {np(str)} + {xp(locat)}"
MIEC_DOSC = (
    "mieć: pewny: _: : imperf: subj{np(str)} + {np(gen)} + {lex(advp(misc),pos,'dość',natr)}"
)
BAC_SIE = "bać się: pewny: _: : imperf: subj{np(str)} + {np(gen);cp(że)}"
NEG_ONLY = "bać się: pewny: neg: : imperf: subj{np(str)} + {np(dat)}"
WRONG = "szukać: zły: _: : imperf: subj{np(str)} + {np(dat)}"


def valency(*lines: str) -> Valency:
    schemata = [parse_schema(line, "verb") for line in lines]
    return Valency(
        {"version": "walenty-test", "schemata": schemata, "expansions": empty_expansions()}
    )


def test_lexical_case() -> None:
    requirement = valency(SZUKAC).bare_objects("szukać", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.lexical == {"Gen"}
    assert requirement.allowed(negated=False) == {"Gen"}


def test_wrong_schemata_are_ignored() -> None:
    requirement = valency(SZUKAC, WRONG).bare_objects("szukać", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.lexical == {"Gen"}


def test_structural_object_is_genitive_when_negated() -> None:
    requirement = valency(MIEC).bare_objects("mieć", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.structural
    assert requirement.allowed(negated=False) == {"Acc"}
    assert requirement.allowed(negated=True) == {"Gen"}


def test_idiom_schemata_say_nothing_about_the_verb() -> None:
    # mieć dość czegoś: the genitive is the idiom's, not mieć's
    requirement = valency(MIEC, MIEC_DOSC).bare_objects("mieć", reflexive=False, negated=False)
    assert requirement is not None
    assert requirement.lexical == frozenset()


def test_reflexive_verbs_and_negation_only_schemata() -> None:
    v = valency(BAC_SIE, NEG_ONLY)
    assert v.bare_objects("bać", reflexive=False, negated=False) is None
    plain = v.bare_objects("bać", reflexive=True, negated=False)
    negated = v.bare_objects("bać", reflexive=True, negated=True)
    assert plain is not None and negated is not None
    assert plain.lexical == {"Gen"}
    assert negated.lexical == {"Gen", "Dat"}
