"""Polish case: fix a case the verb rules out, and say why each word has its case.

Works on one sentence's tokens, using the dependency tree (head, deprel) and Walenty
(valency.py). Relation names are UD Polish PDB's:

    nie  -> advmod:neg on the verb          się -> expl:pv on an inherently reflexive verb
    do   -> case on the noun                pięć, wiele -> nummod:gov, det:numgov on the noun
    być  -> cop on the predicate noun       starego -> amod on psa

The correction is deliberately narrow: only verbs whose bare complements are all lexical
(szukać: genitive only), only forms that look the same in the parser's case and the
required one (psa: gen = acc), and not where się could be impersonal. EVALUATION.md has
what a broader version did on PDB and why the treebank undercounts it.
"""

from collections.abc import Sequence

from ...schema import Case, CaseReason, Deprel, Feats, Reading, Token, Upos, VerbForm
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
# The correction only touches the head nouns of complements; quantity words (więcej,
# dużo) are DET or NUM and have their own case rules
CORRECTABLE: frozenset[Upos] = frozenset({"NOUN", "PROPN", "PRON"})
# Question and relative words (co, jaki, który) open their own clause; leave their case
CLAUSE_PRONOUNS = frozenset({"Int", "Rel"})


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


def correct_cases(tokens: list[Token], valency: Valency) -> int:
    """Where a verb only takes lexical cases (szukać: genitive) and its complement has
    another, but the form also has the required case (psa: genitive = accusative), switch
    to that reading, and the words agreeing with it. Returns how many tokens changed.
    The parser's reading is kept under "parser" and the change under "case_correction"."""
    sentence = Sentence(tokens)
    changed = 0
    for index, token in enumerate(tokens):
        case = token["feats"].get("Case")
        verb = sentence.governing_verb(index)
        if case is None or verb is None or "candidates" not in token:
            continue
        verb_token = tokens[verb]
        lemma = verb_token["lemma"]
        if verb_token["upos"] != "VERB" or lemma is None:
            continue
        # dwóch funkcjonariuszy: the numeral, not the verb, makes the noun genitive
        if sentence.child(index, GOVERNING_NUMERAL) is not None:
            continue
        if token["upos"] not in CORRECTABLE or token["feats"].get("PronType") in CLAUSE_PRONOUNS:
            continue
        requirement = sentence.requirement(valency, verb)
        if requirement is None or requirement.structural or requirement.partitive:
            continue
        if sentence.reflexive(verb) and _may_be_impersonal(valency, lemma):
            continue
        allowed = requirement.lexical
        if not allowed or case in allowed:
            continue
        alternative = _only_reading_with_case(token, allowed)
        if alternative is None:
            continue
        new_case = alternative["feats"].get("Case")
        if new_case is None:
            continue
        _apply(token, alternative, case, lemma)
        changed += 1
        for child in sentence.children[index]:
            dependent = tokens[child]
            if dependent["deprel"] in AGREEING and dependent["feats"].get("Case") == case:
                agreeing = _only_reading_with_case(dependent, frozenset({new_case}))
                if agreeing is not None:
                    _apply(dependent, agreeing, case, lemma)
                    changed += 1
    return changed


def _may_be_impersonal(valency: Valency, lemma: str) -> bool:
    """się after a verb that also takes an ordinary object without się may be the
    impersonal się (takie przemiany nazywa się skojarzonymi: "one calls them"), not the
    reflexive verb (nazywać się: "to be called"), so the reflexive frames may not apply."""
    plain = valency.bare_objects(lemma, reflexive=False, negated=False)
    return plain is not None and plain.structural


def _only_reading_with_case(token: Token, allowed: frozenset[Case]) -> Reading | None:
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
    # The parser and the dictionary disagree on these without it mattering here
    rest.pop("PronType", None)
    rest.pop("ExtPos", None)
    return rest


def _apply(token: Token, reading: Reading, original: Case, governor: str) -> None:
    if "parser" not in token:
        token["parser"] = {
            "lemma": token["lemma"] or token["text"],
            "upos": token["upos"],
            "xpos": token["xpos"] or "",
            "feats": token["feats"],
        }
    feats: Feats = {**token["feats"], **reading["feats"]}
    token["feats"] = feats
    token["xpos"] = reading["xpos"] or None
    token["case_correction"] = {"original": original, "governor": governor}


def apply(sentences: Sequence[list[Token]], valency: Valency | None, correct: bool = True) -> int:
    """Correct cases where the verb rules them out (needs valency), then explain every
    case, sentence by sentence. Returns how many tokens the correction changed."""
    changed = 0
    for tokens in sentences:
        if valency is not None and correct:
            changed += correct_cases(tokens, valency)
        explain_cases(tokens, valency)
    return changed
