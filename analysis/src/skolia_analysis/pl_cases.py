"""Polish case: say why each word has its case.

Works on one sentence's tokens, using the dependency tree (head, deprel) and Walenty
(valency.py). Relation names are UD Polish PDB's:

    nie  -> advmod:neg on the verb          się -> expl:pv on an inherently reflexive verb
    do   -> case on the noun                pięć, wiele -> nummod:gov, det:numgov on the noun
    być  -> cop on the predicate noun       starego -> amod on psa

A correction step (switching a case the verb doesn't allow to one it does) was tried and
removed: it broke more words than it fixed on PDB dev, test and train (EVALUATION.md).
"""

from collections.abc import Sequence

from .schema import Case, CaseReason, Deprel, Token, Upos, VerbForm
from .valency import Requirement, Valency

# Complements whose case the verb decides
GOVERNED: frozenset[Deprel] = frozenset({"obj", "iobj", "obl:arg"})
NEGATION: Deprel = "advmod:neg"
REFLEXIVE: Deprel = "expl:pv"
PREPOSITION: Deprel = "case"
COPULA: Deprel = "cop"
FIXED: Deprel = "fixed"
COORDINATED: Deprel = "conj"
OBLIQUE: Deprel = "obl"
NOUN_COMPLEMENT: Deprel = "nmod:arg"
# Numerals from five up and quantity words (wiele, kilka, dużo) put the noun in the
# genitive: pięć psów, wiele razy
GOVERNING_NUMERAL: frozenset[Deprel] = frozenset({"nummod:gov", "det:numgov"})
# Words that take the case of the noun they describe or belong to: adjectives and
# determiners, the rest of a name (Jana Kowalskiego), and appositions (z bratem, lekarzem)
AGREEING: frozenset[Deprel] = frozenset(
    {
        *("amod", "amod:flat", "det", "det:poss", "det:nummod", "nummod", "acl"),
        *("flat", "flat:foreign", "nmod:flat", "appos"),
    }
)
SUBJECT: frozenset[Deprel] = frozenset({"nsubj", "nsubj:pass"})
POSSESSOR: frozenset[Deprel] = frozenset({"nmod", "nmod:poss"})
# An infinitive depending on another verb (mogli odnaleźć): negation passes down to it
INFINITIVE_COMPLEMENT: frozenset[Deprel] = frozenset({"xcomp", "csubj"})
# Participles and verbal nouns keep their verb's valency
VERBAL_FORMS: frozenset[VerbForm] = frozenset({"Part", "Vnoun", "Conv"})
VERBAL_NOUN: VerbForm = "Vnoun"
NOMINAL_HEADS: frozenset[Upos] = frozenset({"NOUN", "PROPN", "PRON"})


class Sentence:
    """Tokens of one sentence with their children, for walking the tree."""

    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.children: list[list[int]] = [[] for _ in tokens]
        for index, token in enumerate(tokens):
            if token["head"] is not None:
                self.children[token["head"]].append(index)

    def child(self, index: int, deprels: Deprel | frozenset[Deprel]) -> int | None:
        wanted = deprels if isinstance(deprels, frozenset) else frozenset({deprels})
        return next((c for c in self.children[index] if self.tokens[c]["deprel"] in wanted), None)

    def preposition_phrase(self, preposition: int) -> str:
        """The preposition with its fixed parts: w stosunku do (PDB hangs stosunku and
        do off w as fixed), in lower case."""
        parts = [
            preposition,
            *(c for c in self.children[preposition] if self.tokens[c]["deprel"] == FIXED),
        ]
        # Forms, not lemmas: w stosunku do, not w stosunek do
        return " ".join(self.tokens[i]["text"] for i in sorted(parts)).lower()

    def negation(self, verb: int) -> int | None:
        """The nie that negates this verb: its own, or that of the verb it's an infinitive
        complement of (nie mogli odnaleźć pana: nie hangs off mogli, the genitive lands
        on odnaleźć's object)."""
        index: int | None = verb
        while index is not None:
            own = self.child(index, NEGATION)
            if own is not None:
                return own
            token = self.tokens[index]
            index = token["head"] if token["deprel"] in INFINITIVE_COMPLEMENT else None
        return None

    def reflexive(self, verb: int) -> bool:
        return self.child(verb, REFLEXIVE) is not None

    def governing_verb(self, index: int) -> int | None:
        """The verb, participle or verbal noun whose complement this token is, without a
        preposition in between (szukam psa, zabraniające robienia, osiągnięcie pokoju)."""
        token = self.tokens[index]
        head = token["head"]
        if head is None or token["deprel"] not in GOVERNED:
            return None
        if self.child(index, PREPOSITION) is not None:
            return None
        governor = self.tokens[head]
        if governor["upos"] == "VERB" or governor["feats"].get("VerbForm") in VERBAL_FORMS:
            return head
        return None

    def requirement(self, valency: Valency, verb: int) -> Requirement | None:
        lemma = self.tokens[verb]["lemma"]
        if lemma is None:
            return None
        negated = self.negation(verb) is not None
        return valency.bare_objects(lemma, self.reflexive(verb), negated)


def explain_cases(tokens: list[Token], valency: Valency | None) -> None:
    """Set case_reason on every token with a case that a rule explains."""
    sentence = Sentence(tokens)
    for index, token in enumerate(tokens):
        case = token["feats"].get("Case")
        if case is None:
            continue
        reason = _reason(sentence, index, case, valency)
        if reason is not None:
            token["case_reason"] = reason


def _reason(
    sentence: Sentence, index: int, case: Case, valency: Valency | None
) -> CaseReason | None:
    tokens = sentence.tokens
    token = tokens[index]
    head = token["head"]
    deprel = token["deprel"]
    if case == "Voc":
        return {"rule": "vocative"}
    preposition = sentence.child(index, PREPOSITION)
    if preposition is not None and tokens[preposition]["upos"] == "ADP":
        return {
            "rule": "preposition",
            "trigger": preposition,
            "governor": sentence.preposition_phrase(preposition),
        }
    # Fixed phrases hang their noun off the preposition: w stanie, na przykład
    if head is not None and deprel == FIXED and tokens[head]["upos"] == "ADP":
        return _with_governor({"rule": "preposition", "trigger": head}, tokens[head])
    same_case_as_head = head is not None and tokens[head]["feats"].get("Case") == case
    if head is not None and same_case_as_head and deprel in AGREEING:
        return {"rule": "agreement", "trigger": head}
    if head is not None and same_case_as_head and deprel == COORDINATED:
        return {"rule": "coordination", "trigger": head}
    numeral = sentence.child(index, GOVERNING_NUMERAL)
    if numeral is not None and case == "Gen":
        return {"rule": "numeral", "trigger": numeral}
    verb = sentence.governing_verb(index)
    if verb is not None:
        reason = _verb_reason(sentence, verb, case, valency)
        if reason is not None:
            return reason
    if head is not None and deprel in SUBJECT and case == "Nom":
        return {"rule": "subject", "trigger": head}
    copula = sentence.child(index, COPULA)
    if copula is not None and case == "Ins":
        return _with_governor({"rule": "predicate", "trigger": copula}, tokens[copula])
    nominal_head = head is not None and tokens[head]["upos"] in NOMINAL_HEADS
    if head is not None and nominal_head and deprel in POSSESSOR and case == "Gen":
        return {"rule": "possessive", "trigger": head}
    # A noun's own complement is genitive; a verbal noun's object too, even where the
    # verb takes the accusative: czytać książkę -> czytanie książki
    if head is not None and nominal_head and deprel == NOUN_COMPLEMENT and case == "Gen":
        verbal = tokens[head]["feats"].get("VerbForm") == VERBAL_NOUN
        complement: CaseReason = {
            "rule": "verbal-noun" if verbal else "noun-complement",
            "trigger": head,
        }
        return _with_governor(complement, tokens[head])
    if head is not None and deprel == OBLIQUE and case == "Ins":
        return {"rule": "instrumental", "trigger": head}
    return None


def _verb_reason(
    sentence: Sentence, verb: int, case: Case, valency: Valency | None
) -> CaseReason | None:
    negation = sentence.negation(verb)
    requirement = sentence.requirement(valency, verb) if valency else None
    verb_token = sentence.tokens[verb]
    if requirement is not None and case in requirement.lexical:
        return _with_governor({"rule": "verb", "trigger": verb}, verb_token)
    structural = requirement is None or requirement.structural
    if verb_token["feats"].get("VerbForm") == VERBAL_NOUN:
        # A verbal noun's structural object is genitive, not accusative
        if case == "Gen" and structural:
            return _with_governor({"rule": "verbal-noun", "trigger": verb}, verb_token)
        return None
    if case == "Gen" and structural and negation is not None:
        return _with_governor({"rule": "negation", "trigger": negation}, verb_token)
    if case == "Acc" and structural:
        return _with_governor({"rule": "structural", "trigger": verb}, verb_token)
    if requirement is not None and requirement.partitive and case in ("Gen", "Acc"):
        return _with_governor({"rule": "partitive", "trigger": verb}, verb_token)
    return None


def _with_governor(reason: CaseReason, governor: Token) -> CaseReason:
    if governor["lemma"]:
        reason["governor"] = governor["lemma"]
    return reason


def apply(sentences: Sequence[list[Token]], valency: Valency | None) -> None:
    """Explain cases, sentence by sentence."""
    for tokens in sentences:
        explain_cases(tokens, valency)
