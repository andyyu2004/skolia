"""Polish case: fix ambiguous cases with verb valency, and say why each word has its case.

Both work on one sentence's tokens, using the dependency tree (head, deprel) and Walenty
(valency.py). Relation names are UD Polish PDB's:

    nie  -> advmod:neg on the verb          się -> expl:pv on an inherently reflexive verb
    do   -> case on the noun                pięć, wiele -> nummod:gov, det:numgov on the noun
    być  -> cop on the predicate noun       starego -> amod on psa
"""

from collections.abc import Sequence
from typing import Literal

from .schema import Case, CaseReason, Feats, Reading, Token
from .valency import Requirement, Valency

# Complements whose case the verb decides
GOVERNED = {"obj", "iobj", "obl:arg"}
NEGATION = "advmod:neg"
REFLEXIVE = "expl:pv"
PREPOSITION = "case"
COPULA = "cop"
# Numerals from five up and quantity words (wiele, kilka, dużo) put the noun in the
# genitive: pięć psów, wiele razy
GOVERNING_NUMERAL = {"nummod:gov", "det:numgov"}
# Words that take the case of the noun they describe or belong to: adjectives and
# determiners, the rest of a name (Jana Kowalskiego), and appositions (z bratem, lekarzem)
AGREEING = {
    *("amod", "amod:flat", "det", "det:poss", "det:nummod", "nummod", "acl"),
    *("flat", "flat:foreign", "nmod:flat", "appos"),
}
NOUN_COMPLEMENT = "nmod:arg"
# Participles and verbal nouns keep their verb's valency
VERBAL_FORMS = {"Part", "Vnoun", "Conv"}
VERBAL_NOUN = "Vnoun"
SUBJECT = {"nsubj", "nsubj:pass"}
POSSESSOR = {"nmod", "nmod:poss"}
# An infinitive depending on another verb (mogli odnaleźć): negation passes down to it
INFINITIVE_COMPLEMENT = {"xcomp", "csubj"}
# Question and relative words (co, jaki, który) open their own clause; leave their case
CLAUSE_PRONOUNS = {"Int", "Rel"}
# The correction only touches the head nouns of complements; quantity words (więcej,
# dużo) are DET or NUM and have their own case rules
CORRECTABLE = {"NOUN", "PROPN", "PRON"}
NOMINAL_HEADS = {"NOUN", "PROPN", "PRON"}


class Sentence:
    """Tokens of one sentence with their children, for walking the tree."""

    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.children: list[list[int]] = [[] for _ in tokens]
        for index, token in enumerate(tokens):
            if token["head"] is not None:
                self.children[token["head"]].append(index)

    def child(self, index: int, deprels: str | set[str]) -> int | None:
        wanted = {deprels} if isinstance(deprels, str) else deprels
        return next((c for c in self.children[index] if self.tokens[c]["deprel"] in wanted), None)

    def preposition_phrase(self, preposition: int) -> str:
        """The preposition with its fixed parts: w stosunku do (PDB hangs stosunku and
        do off w as fixed), in lower case."""
        parts = [
            preposition,
            *(c for c in self.children[preposition] if self.tokens[c]["deprel"] == "fixed"),
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

    def negated(self, verb: int) -> bool:
        return self.negation(verb) is not None

    def reflexive(self, verb: int) -> bool:
        return self.child(verb, REFLEXIVE) is not None

    def governing_verb(self, index: int, verbal: bool = False) -> int | None:
        """The verb whose complement this token is, without a preposition in between.
        verbal: also participles and verbal nouns, which have the verb as lemma
        (zabraniające robienia, osiągnięcie pokoju)."""
        token = self.tokens[index]
        head = token["head"]
        if head is None or token["deprel"] not in GOVERNED:
            return None
        if self.child(index, PREPOSITION) is not None:
            return None
        governor = self.tokens[head]
        if governor["upos"] == "VERB":
            return head
        if verbal and governor["feats"].get("VerbForm") in VERBAL_FORMS:
            return head
        return None

    def requirement(self, valency: Valency, verb: int) -> Requirement | None:
        lemma = self.tokens[verb]["lemma"]
        if lemma is None:
            return None
        return valency.bare_objects(lemma, self.reflexive(verb), self.negated(verb))


type Correction = Literal["off", "lexical", "all"]
"""Which verbs' requirements may override the parser's case:
lexical: only verbs whose bare complements are all lexical (szukać: genitive only), so a
    subject mislabelled as an object can't be turned accusative
all: also verbs with a structural (np(str)) or partitive object"""
CORRECTIONS: tuple[Correction, ...] = ("off", "lexical", "all")


def correct_cases(tokens: list[Token], valency: Valency, mode: Correction = "lexical") -> int:
    """Where a verb's complement has a case the verb doesn't allow, and the form also has
    exactly one allowed case (psa is genitive or accusative; szukać takes the genitive),
    switch to that reading, and the words agreeing with it too. Returns how many tokens
    changed. The parser's reading is kept under "parser"."""
    if mode == "off":
        return 0
    sentence = Sentence(tokens)
    changed = 0
    for index, token in enumerate(tokens):
        case = token["feats"].get("Case")
        verb = sentence.governing_verb(index)
        if case is None or verb is None or "candidates" not in token:
            continue
        # dwóch funkcjonariuszy: the numeral, not the verb, makes the noun genitive
        if sentence.child(index, GOVERNING_NUMERAL) is not None:
            continue
        if token["upos"] not in CORRECTABLE or token["feats"].get("PronType") in CLAUSE_PRONOUNS:
            continue
        requirement = sentence.requirement(valency, verb)
        if requirement is None:
            continue
        if mode == "lexical" and (requirement.structural or requirement.partitive):
            continue
        allowed = requirement.allowed(sentence.negated(verb))
        if not allowed or case in allowed:
            continue
        alternative = _only_reading_with_case(token, allowed)
        if alternative is None:
            continue
        new_case = alternative["feats"].get("Case")
        _apply(token, alternative)
        changed += 1
        for child in sentence.children[index]:
            dependent = tokens[child]
            if dependent["deprel"] in AGREEING and dependent["feats"].get("Case") == case:
                agreeing = _only_reading_with_case(dependent, {new_case} if new_case else set())
                if agreeing is not None:
                    _apply(dependent, agreeing)
                    changed += 1
    return changed


def _only_reading_with_case(token: Token, allowed: set[Case] | frozenset[Case]) -> Reading | None:
    """The token's dictionary reading that differs only in case, if exactly one allowed
    case is available."""
    matches = [
        r
        for r in token.get("candidates", [])
        if r["lemma"] == token["lemma"]
        and r["upos"] == token["upos"]
        and r["feats"].get("Case") in allowed
        and _without_case(r["feats"]) == _without_case(token["feats"])
    ]
    cases = {r["feats"].get("Case") for r in matches}
    return matches[0] if len(cases) == 1 else None


def _without_case(feats: Feats) -> dict[str, object]:
    rest: dict[str, object] = dict(feats)
    rest.pop("Case", None)
    return rest


def _apply(token: Token, reading: Reading) -> None:
    if "parser" not in token:
        token["parser"] = {
            "lemma": token["lemma"] or token["text"],
            "upos": token["upos"],
            "xpos": token["xpos"] or "",
            "feats": token["feats"],
        }
    token["feats"] = reading["feats"]
    token["xpos"] = reading["xpos"] or None


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
    if head is not None and deprel == "fixed" and tokens[head]["upos"] == "ADP":
        return _with_governor({"rule": "preposition", "trigger": head}, tokens[head])
    same_case_as_head = head is not None and tokens[head]["feats"].get("Case") == case
    if head is not None and same_case_as_head and deprel in AGREEING:
        return {"rule": "agreement", "trigger": head}
    if head is not None and same_case_as_head and deprel == "conj":
        return {"rule": "coordination", "trigger": head}
    numeral = sentence.child(index, GOVERNING_NUMERAL)
    if numeral is not None and case == "Gen":
        return {"rule": "numeral", "trigger": numeral}
    verb = sentence.governing_verb(index, verbal=True)
    if verb is not None:
        reason = _verb_reason(sentence, verb, case, valency)
        if reason is not None:
            return reason
    if head is not None and deprel in SUBJECT and case == "Nom":
        return {"rule": "subject", "trigger": head}
    copula = sentence.child(index, COPULA)
    if copula is not None and case == "Ins":
        return _with_governor({"rule": "predicate", "trigger": copula}, tokens[copula])
    if (
        head is not None
        and deprel in POSSESSOR
        and case == "Gen"
        and tokens[head]["upos"] in NOMINAL_HEADS
    ):
        return {"rule": "possessive", "trigger": head}
    # A noun's own complement is genitive; a verbal noun's object too, even where the
    # verb takes the accusative: czytać książkę -> czytanie książki
    if (
        head is not None
        and deprel == NOUN_COMPLEMENT
        and case == "Gen"
        and tokens[head]["upos"] in NOMINAL_HEADS
    ):
        verbal = tokens[head]["feats"].get("VerbForm") == "Vnoun"
        complement: CaseReason = {
            "rule": "verbal-noun" if verbal else "noun-complement",
            "trigger": head,
        }
        return _with_governor(complement, tokens[head])
    if head is not None and deprel == "obl" and case == "Ins":
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


def apply(sentences: Sequence[list[Token]], valency: Valency | None, correct: Correction) -> int:
    """Explain cases sentence by sentence, first correcting them with valency if asked.
    Returns how many tokens the correction changed.

    "all" on PDB fixed 4 words and broke 0 on dev, but fixed 2 and broke 6 on test
    (scripts/eval_ud.py --valency). The breaks were subjects the parser had labelled as
    objects (inverted word order) of verbs with a structural object, so a correct
    nominative became accusative: valency can't help when the tree is wrong. "lexical"
    leaves those verbs alone; see analysis/EVALUATION.md for its numbers."""
    changed = 0
    for tokens in sentences:
        if valency is not None:
            changed += correct_cases(tokens, valency, correct)
        explain_cases(tokens, valency)
    return changed
