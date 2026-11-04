"""Walenty's notation as tagged unions.

Every variant is a TypedDict whose "kind" (or "shape") is a Literal, so a union of them
narrows like a Rust enum: `match phrase["kind"]` is checked for exhaustiveness by pyright
(end with `case _: assert_never(phrase)`), and it serializes to JSON and to a TypeScript
discriminated union as is.

    szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)} + {prepnp(w,loc)}

    Schema(lemma="szukać", certainty="certain", aspect="imperf", negation="any",
           positions=[Position(labels=["subj"], phrases=[NounPhrase(case="str")]),
                      Position(labels=["obj"],  phrases=[NounPhrase(case="gen")]),
                      Position(labels=[],       phrases=[PrepNounPhrase(prep="w", case="loc")])])

A phrase is a group of words with one main word (its head) that fills one slot of a
schema as a unit: in "szukam starego psa", "starego psa" is one noun phrase headed by psa.
Walenty names phrase types by their head, and a "prep" prefix means a preposition comes
first and decides the case:

    np         noun phrase: a noun or pronoun with its modifiers     (szukam) starego psa
    adjp       adjective phrase: an adjective with its modifiers     (jest) bardzo zmęczony
    nump       numeral phrase: a number with the counted noun        (kupił) dwa psy
    prepnp     preposition + noun phrase                             (mieszka) w dużym domu
    prepadjp   preposition + adjective phrase                        (mówić) po polsku
    prepnump   preposition + numeral phrase                          (podzielić) na dwie części

Each carries a case: np(gen) is a noun phrase in the genitive; prepnp(w,loc) is "w"
followed by a noun phrase in the locative. The other types follow the same pattern:
ppasp/pactp (participle phrases), prepgerp (preposition + verbal noun), comprepnp
(multi-word preposition), cp/ncp/prepncp (clauses), infp (infinitive), xp/advp
(adverbials), compar (comparison), lex (a fixed word in an idiom).
"""

# Variants refer to Phrase and Position before they're defined (a phrase can contain
# phrases), so annotations are evaluated lazily
from __future__ import annotations

from typing import Literal, NewType, TypedDict

from .vocabulary import (
    AdverbialCategory,
    Aspect,
    Atom,
    CaseSpec,
    Certainty,
    Comparator,
    Complementizer,
    ComplexPreposition,
    DegreeSpec,
    GenderSpec,
    Label,
    Lemma,
    Modifiability,
    Negation,
    NumberSpec,
    PartOfSpeech,
    Preposition,
    WhWord,
)

FixedText = NewType("FixedText", str)
"""The exact words of a frozen phrase: fixed(prepnp(w,acc),'w kotka i myszkę')."""

# --- Phrases with a case ------------------------------------------------------------


class NounPhrase(TypedDict):
    """np(gen): noun phrase. A noun (or pronoun) with whatever describes it, in one case:
    np(gen) in "szukam starego psa" is "starego psa"; np(dat) in "pomagam bratu" is
    "bratu"; np(str) is a subject or object (structural case, see CaseSpec)."""

    kind: Literal["np"]
    case: CaseSpec


class AdjectivePhrase(TypedDict):
    """adjp(agr): adjective phrase. An adjective with its modifiers, as a complement:
    "czuję się zmęczony" (adjp(agr): agrees with the subject), "uważam go za mądrego"
    is prepadjp. adjp(pred) is a predicate after być: "jest zdrowy"."""

    kind: Literal["adjp"]
    case: CaseSpec


class NumeralPhrase(TypedDict):
    """nump(str): numeral phrase. A number together with what it counts, where the
    numeral rather than the noun is in charge: "kupił dwa psy", "przyszło pięciu
    studentów" (the numeral makes studentów genitive)."""

    kind: Literal["nump"]
    case: CaseSpec


class PassiveParticiplePhrase(TypedDict):
    """ppasp(agr): passive participle phrase. A passive participle (zrobiony, "done")
    with its modifiers: "wyglądał na zmęczonego" uses the prep form, "czuł się
    oszukany" this one."""

    kind: Literal["ppasp"]
    case: CaseSpec


class ActiveParticiplePhrase(TypedDict):
    """pactp(agr): active participle phrase. An active participle (robiący, "doing")
    with its modifiers."""

    kind: Literal["pactp"]
    case: CaseSpec


# --- Prepositional phrases ----------------------------------------------------------


class PrepNounPhrase(TypedDict):
    """prepnp(w,loc): prepositional noun phrase. A preposition followed by a noun phrase
    in the case it governs: prepnp(w,loc) is "w domu" (in the house), prepnp(na,acc) is
    "na stół" (onto the table), prepnp(o,acc) in "boję się o brata" (worried for him)."""

    kind: Literal["prepnp"]
    prep: Preposition
    case: CaseSpec


class PrepAdjectivePhrase(TypedDict):
    """prepadjp(za,acc): prepositional adjective phrase. A preposition followed by an
    adjective rather than a noun: "uważam go za mądrego" (za + accusative adjective),
    "mówić po polsku" (po + the special postp form, see CaseSpec), "jako pierwszy"."""

    kind: Literal["prepadjp"]
    prep: Preposition
    case: CaseSpec


class PrepNumeralPhrase(TypedDict):
    """prepnump(na,acc): prepositional numeral phrase. A preposition followed by a
    numeral phrase: "podzielić na dwie części" (into two parts), "po dwa jabłka" (two
    apples each)."""

    kind: Literal["prepnump"]
    prep: Preposition
    case: CaseSpec


class PrepGerundPhrase(TypedDict):
    """prepgerp(do,gen): preposition plus a verbal noun (do pisania)."""

    kind: Literal["prepgerp"]
    prep: Preposition
    case: CaseSpec


class PrepPassiveParticiplePhrase(TypedDict):
    """prepppasp(na,loc): preposition plus a passive participle."""

    kind: Literal["prepppasp"]
    prep: Preposition
    case: CaseSpec


class ComplexPrepPhrase(TypedDict):
    """comprepnp(na temat): a multi-word preposition plus its noun phrase."""

    kind: Literal["comprepnp"]
    prep: ComplexPreposition


# --- Clauses and verbal phrases -----------------------------------------------------


class Clause(TypedDict):
    """cp(że), cp(int[co;kto]): a clause, optionally limited to some question words."""

    kind: Literal["cp"]
    complementizer: Complementizer
    words: list[WhWord]


class NominalClause(TypedDict):
    """ncp(gen,że): a clause behind a pronoun in a case (tego, że ...)."""

    kind: Literal["ncp"]
    case: CaseSpec
    complementizer: Complementizer
    words: list[WhWord]


class PrepNominalClause(TypedDict):
    """prepncp(o,acc,że): preposition, pronoun and clause (o to, że ...)."""

    kind: Literal["prepncp"]
    prep: Preposition
    case: CaseSpec
    complementizer: Complementizer
    words: list[WhWord]


class Infinitive(TypedDict):
    """infp(perf): an infinitive phrase of the given aspect."""

    kind: Literal["infp"]
    aspect: Aspect


# --- Adverbials and the rest ----------------------------------------------------------


class Adverbial(TypedDict):
    """xp(locat), xp(adl[prepnp(do,gen)]): an adverbial of a category. Without listed
    realisations, any of the category's (from the expansions file)."""

    kind: Literal["xp"]
    category: AdverbialCategory
    realisations: list[Phrase]


class Adverb(TypedDict):
    """advp(mod): an adverb of a category."""

    kind: Literal["advp"]
    category: AdverbialCategory


class Comparison(TypedDict):
    """compar(jak): a comparison (jak ogień)."""

    kind: Literal["compar"]
    comparator: Comparator


class AtomPhrase(TypedDict):
    """A phrase without arguments; kind names it (possp, refl, E ...)."""

    kind: Atom


class Fixed(TypedDict):
    """fixed(prepnp(w,acc),'w kotka i myszkę'): exact words, with the phrase type they
    behave as."""

    kind: Literal["fixed"]
    phrase: Phrase
    text: FixedText


# --- Lexicalised (idiom) phrases ------------------------------------------------------


class One(TypedDict):
    kind: Literal["one"]
    lemma: Lemma


class Xor(TypedDict):
    """XOR('praca','robota'): exactly one of these words."""

    kind: Literal["xor"]
    lemmas: list[Lemma]


class Or(TypedDict):
    """OR('myśl','umysł'): one or more of these words."""

    kind: Literal["or"]
    lemmas: list[Lemma]


type LemmaChoice = One | Xor | Or


class Modification(TypedDict):
    """Whether, and with what, a fixed word may be modified; see Modifiability. positions
    is empty for natr."""

    kind: Modifiability
    positions: list[Position]


class NominalForm(TypedDict):
    """lex(np(gen),sg,'cień',...): a noun's number."""

    shape: Literal["nominal"]
    number: NumberSpec


class AdjectivalForm(TypedDict):
    """lex(adjp(agr),agr,agr,pos,...): an adjective's number, gender and degree."""

    shape: Literal["adjectival"]
    number: NumberSpec
    genders: list[GenderSpec]
    """Usually one; Walenty lists alternatives with dots: m1.m2.m3.f.n."""
    degree: DegreeSpec


class ParticipialForm(TypedDict):
    """lex(ppasp(agr),agr,agr,aff,...): a participle's number, gender and polarity; an
    active participle also says whether it takes się."""

    shape: Literal["participial"]
    number: NumberSpec
    genders: list[GenderSpec]
    """As AdjectivalForm.genders."""
    negation: Negation
    reflexive: bool


class VerbalForm(TypedDict):
    """lex(infp(perf),_,'spojrzeć',,...) and clauses: polarity and się."""

    shape: Literal["verbal"]
    negation: Negation
    reflexive: bool


class GerundForm(TypedDict):
    """lex(prepgerp(do,gen),sg,aff,'pisać',,...): a verbal noun's number, polarity, się."""

    shape: Literal["gerund"]
    number: NumberSpec
    negation: Negation
    reflexive: bool


class NumeralForm(TypedDict):
    """lex(nump(str),XOR('dwa','kilka'),'sroka',...): which numeral."""

    shape: Literal["numeral"]
    numeral: LemmaChoice


class AdverbialForm(TypedDict):
    """lex(advp(misc),pos,...): an adverb's degree."""

    shape: Literal["adverbial"]
    degree: DegreeSpec


class ParticleForm(TypedDict):
    """lex(qub,'niech',...): a particle has no inflection."""

    shape: Literal["particle"]


type LexForm = (
    NominalForm
    | AdjectivalForm
    | ParticipialForm
    | VerbalForm
    | GerundForm
    | NumeralForm
    | AdverbialForm
    | ParticleForm
)


class Lex(TypedDict):
    """lex(prepnp(na,acc),pl,'oko',natr): a fixed word in a fixed form, as part of an
    idiom: dać radę, mieć na oku. form's shape follows the phrase type."""

    kind: Literal["lex"]
    phrase: Phrase
    form: LexForm
    lemmas: LemmaChoice
    modification: Modification


class LexComparison(TypedDict):
    """lex(compar(jak),lex(np(gen),...)+...): a fixed comparison: jak ogień."""

    kind: Literal["lexcompar"]
    phrase: Phrase
    parts: list[Lex]


type Phrase = (
    NounPhrase
    | AdjectivePhrase
    | NumeralPhrase
    | PassiveParticiplePhrase
    | ActiveParticiplePhrase
    | PrepNounPhrase
    | PrepAdjectivePhrase
    | PrepNumeralPhrase
    | PrepGerundPhrase
    | PrepPassiveParticiplePhrase
    | ComplexPrepPhrase
    | Clause
    | NominalClause
    | PrepNominalClause
    | Infinitive
    | Adverbial
    | Adverb
    | Comparison
    | AtomPhrase
    | Fixed
    | Lex
    | LexComparison
)


def inflects_like(phrase: Phrase) -> Phrase:
    """The phrase a lex's inflection slots follow: for xp(mod[prepnp(pod,inst)]), the
    prepnp."""
    if phrase["kind"] == "xp" and phrase["realisations"]:
        return inflects_like(phrase["realisations"][0])
    return phrase


# --- Schemata -----------------------------------------------------------------------


class Position(TypedDict):
    """{np(gen);cp(że)}: one complement slot and the phrases that can fill it."""

    labels: list[Label]
    phrases: list[Phrase]


class Schema(TypedDict):
    """One line of Walenty: one way a word can be used."""

    pos: PartOfSpeech
    lemma: Lemma
    reflexive: bool
    """The lemma includes się: bać się."""
    certainty: Certainty
    negation: Negation
    """Verbs only; "any" elsewhere."""
    predicative: bool
    """Adjectives and adverbs used as a predicate (jest pewny, że ...)."""
    aspect: Aspect
    """Verbs only; "any" elsewhere."""
    positions: list[Position]


class Realisation(TypedDict):
    """One way to realise an expandable phrase type, from the expansions file: positions
    (usually one) and how sure."""

    positions: list[Position]
    certainty: Certainty


class WordRealisation(TypedDict):
    """One word an expandable type can be: advp(abl) can be skąd, stamtąd, ..."""

    word: Lemma
    certainty: Certainty


class Expansions(TypedDict):
    """phrase_types_expand_*.txt: what the open phrase types stand for."""

    adverbials: dict[AdverbialCategory, list[Realisation]]
    """xp(abl) -> advp(abl), comprepnp(od strony), cp(int[skąd]), ..."""
    adverbs: dict[AdverbialCategory, list[WordRealisation]]
    """advp(abl) -> skąd, stamtąd, zewsząd, ..."""
    complex_prepositions: dict[ComplexPreposition, list[Realisation]]
    """comprepnp(na temat) -> lex(prepnp(na,acc),_,'temat',atr({np(gen);...}+...)):
    the multi-word preposition's own structure, so its case."""
    possessive: list[Realisation]
    """possp -> a genitive noun, or mój, twój, czyj, ..."""
    distributive: list[Realisation]
    """distrp -> prepnp(po,loc), prepnump(po,acc)"""
    question_words: list[WordRealisation]
    """int -> co, czy, kto, ..."""
    relative_words: list[WordRealisation]
    """rel -> co, który, gdzie, ..."""
    variants: dict[Lemma, list[Lemma]]
    """Alternative spellings: jak -> niczym, przeciw -> przeciwko."""
