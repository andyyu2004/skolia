"""Shape of the analysis blob JSON. Labels follow Universal Dependencies (UD).

The label sets are the ones used in the UD Polish PDB treebank, which is what the Stanza
Polish models are trained on, so they are exactly what the parser can output. Extend them
when adding a language. ud.py checks parser output against these types at runtime.
"""

from typing import Literal, NotRequired, TypedDict

type Upos = Literal[
    "ADJ",  # adjective
    "ADP",  # adposition (preposition)
    "ADV",  # adverb
    "AUX",  # auxiliary verb
    "CCONJ",  # coordinating conjunction
    "DET",  # determiner: ten, który, mój
    "INTJ",  # interjection
    "NOUN",  # noun
    "NUM",  # numeral
    "PART",  # particle
    "PRON",  # pronoun
    "PROPN",  # proper noun
    "PUNCT",  # punctuation
    "SCONJ",  # subordinating conjunction
    "SYM",  # symbol
    "VERB",  # verb
    "X",  # other
]

type Deprel = Literal[
    "acl",  # adnominal clause: a clause modifying a noun
    "acl:cmp",  # adnominal clause, comparative
    "acl:relcl",  # adnominal clause, relative clause: dom, który kupiłem
    "advcl",  # adverbial clause modifier: gdy przyszedł, ...
    "advcl:cmp",  # adverbial clause modifier, comparative
    "advcl:relcl",  # adverbial clause modifier, relative clause: ..., co mnie zdziwiło
    "advmod",  # adverbial modifier: szybko biegać
    "advmod:arg",  # adverbial modifier, argument: one the verb requires, czuć się dobrze
    "advmod:cmp",  # adverbial modifier, comparative: with a comparative clause
    "advmod:emph",  # adverbial modifier, emphasizing: nawet, właśnie
    "advmod:neg",  # adverbial modifier, negation: nie
    "amod",  # adjectival modifier: stary pies
    "amod:cmp",  # adjectival modifier, comparative: with a comparative clause
    "amod:flat",  # adjectival modifier, flat: inside a name, Morze Bałtyckie
    "appos",  # appositional modifier: Warszawa, stolica Polski
    "aux",  # auxiliary: będę robić
    "aux:clitic",  # auxiliary, clitic: the person ending -em in zrobiłem, -eś in byłeś
    "aux:cnd",  # auxiliary, conditional: by in zrobiłby
    "aux:imp",  # auxiliary, imperative: niech
    "aux:pass",  # auxiliary, passive: został zbudowany
    "case",  # case marking: a preposition, do domu
    "cc",  # coordinating conjunction: i, ale
    "cc:preconj",  # coordinating conjunction, preconjunct: albo ... albo, zarówno ... jak i
    "ccomp",  # clausal complement: wiem, że przyjdzie
    "ccomp:cleft",  # clausal complement, cleft: required by the pronoun to
    "ccomp:obj",  # clausal complement, object: a clausal object of a verb
    "conj",  # conjunct: second and later items of a coordination, ryż i pszenica
    "cop",  # copula: jest in jest lekarzem
    "csubj",  # clausal subject: kto pyta, nie błądzi
    "csubj:pass",  # clausal subject, passive: of a passive verb
    "dep",  # unspecified dependency: when nothing else fits
    "det",  # determiner: ten dom
    "det:numgov",  # determiner, numeral governing?: governs the noun's case, wiele osób
    "det:nummod",  # determiner, numeric modifier: a quantifier that agrees with the noun's case
    "det:poss",  # determiner, possessive: mój dom
    "discourse",  # discourse element: outside the sentence's structure
    "discourse:intj",  # discourse element, interjection: och
    "expl:pv",  # expletive, pronominal verb: się that belongs to the verb, bać się
    "fixed",  # fixed multiword expression: w związku z
    "flat",  # flat multiword expression: a name, Jan Kowalski
    "flat:foreign",  # flat multiword expression, foreign: a foreign phrase
    "iobj",  # indirect object: dać bratu książkę
    "list",  # list: items without conjunctions
    "mark",  # marker: a subordinating conjunction introducing a clause, że, gdy
    "nmod",  # nominal modifier: a noun modifying another noun
    "nmod:arg",  # nominal modifier, argument: a noun a noun requires
    "nmod:cmp",  # nominal modifier, comparative
    "nmod:flat",  # nominal modifier, flat: a noun inside a name
    "nmod:poss",  # nominal modifier, possessive: jego dom
    "nmod:pred",  # nominal modifier, predicative: after bycie, bycie lekarzem
    "nsubj",  # nominal subject
    "nsubj:pass",  # nominal subject, passive: dom został zbudowany
    "nummod",  # numeric modifier: a numeral that agrees with the noun, dwa psy
    "nummod:flat",  # numeric modifier, flat: a numeral inside a name
    "nummod:gov",  # numeric modifier, governing: governs the noun's case, pięć psów
    "obj",  # object: mam czas
    "obl",  # oblique nominal: a noun phrase that isn't a core argument, do domu
    "obl:agent",  # oblique nominal, agent: of a passive verb, przez brata
    "obl:arg",  # oblique nominal, argument: one the verb requires, myśleć o tobie
    "obl:cmp",  # oblique nominal, comparative: wyższy od brata
    "obl:orphan",  # oblique nominal, orphan: its noun is left out
    "orphan",  # orphan: dependent of a left-out head, ja piję kawę, a on herbatę
    "parataxis",  # parataxis: a clause loosely placed next to another
    "parataxis:insert",  # parataxis, insertion?: a parenthetical, moim zdaniem
    "parataxis:obj",  # parataxis, object: direct speech
    "punct",  # punctuation
    "reparandum",  # reparandum: a word the speaker corrected later (spoken language)
    "root",  # root: head of the sentence
    "vocative",  # vocative: the person addressed, Kasiu!
    "xcomp",  # open clausal complement: a clause without its own subject, chcę spać
    "xcomp:cleft",  # open clausal complement, cleft: required by the pronoun to
    "xcomp:pred",  # open clausal complement, predicative: wydaje się miły
    "xcomp:subj",  # open clausal complement, subject: an infinitive or adverbial phrase as subject
]

type Yes = Literal["Yes"]
type Case = Literal[
    "Nom",  # nominative: kto? co?
    "Gen",  # genitive: kogo? czego?
    "Dat",  # dative: komu? czemu?
    "Acc",  # accusative: kogo? co?
    "Ins",  # instrumental: kim? czym?
    "Loc",  # locative: o kim? o czym?
    "Voc",  # vocative: Kasiu!
]
type Number = Literal[
    "Sing",  # singular
    "Plur",  # plural
    "Ptan",  # plurale tantum: a noun that only has plural forms (drzwi, nożyczki)
]
type Gender = Literal[
    "Masc",  # masculine
    "Fem",  # feminine
    "Neut",  # neuter
]
type Animacy = Literal[
    "Hum",  # human: student
    "Nhum",  # non-human: an animal, pies
    "Inan",  # inanimate: stół
]
"""Masculine only."""
type Person = Literal[
    "0",  # zero person: the impersonal -no/-to form, zrobiono
    "1",  # first person: robię
    "2",  # second person: robisz
    "3",  # third person: robi
]
type Aspect = Literal[
    "Imp",  # imperfective: robić
    "Perf",  # perfective: zrobić
]
type Tense = Literal[
    "Past",  # past
    "Pres",  # present
    "Fut",  # future
]
type Mood = Literal[
    "Ind",  # indicative: robisz
    "Imp",  # imperative: rób
]
type VerbForm = Literal[
    "Fin",  # finite: robię
    "Inf",  # infinitive: robić
    "Part",  # participle: robiony, robiący
    "Conv",  # converb: the adverbial participle, robiąc
    "Vnoun",  # verbal noun: robienie
]
type Voice = Literal[
    "Act",  # active
    "Pass",  # passive
]
type Degree = Literal[
    "Pos",  # positive: dobry
    "Cmp",  # comparative: lepszy
    "Sup",  # superlative: najlepszy
]
type Polarity = Literal[
    "Pos",  # positive
    "Neg",  # negative
]
type PronType = Literal[
    "Prs",  # personal: ja, ty
    "Dem",  # demonstrative: ten, tamten
    "Rel",  # relative: który
    "Int",  # interrogative: kto, co
    "Ind",  # indefinite: ktoś, coś
    "Tot",  # total: wszystko, każdy
    "Neg",  # negative: nic, nikt
]
type Variant = Literal[
    "Short",  # short form: w, go, mi
    "Long",  # long form: we, jego, mnie
]
type PrepCase = Literal[
    "Pre",  # prepositional: the pronoun form used after a preposition, niego
    "Npr",  # non-prepositional: the form used without one, jego
]
type NumType = Literal[
    "Card",  # cardinal: pięć
    "Ord",  # ordinal: piąty
    "Sets",  # sets: the collective numeral, dwoje
]
type NumForm = Literal[
    "Word",  # word: pięć
    "Digit",  # digit: 5
    "Roman",  # Roman: V
]
type AdpType = Literal[
    "Prep",  # preposition: before its noun, do domu
    "Post",  # postposition: after its noun, dwa lata temu
]
type ConjType = Literal[
    "Comp",  # comparing: niż, jak
    "Pred",  # predicative: jako
    "Oper",  # operator: a mathematical one, plus
]
type PartType = Literal[
    "Int",  # interrogative: czy
    "Mod",  # modal?
]
type VerbType = Literal[
    "Quasi",  # quasi-verb?: no person or aspect, trzeba, można
    "Mod",  # modal?: winien, powinien
]
type PunctType = Literal[
    "Peri",  # period: .
    "Comm",  # comma: ,
    "Dash",  # dash, en or em
    "Quot",  # quotation mark: „
    "Brck",  # bracket: (
    "Qest",  # question mark: ?
    "Colo",  # colon: :
    "Excl",  # exclamation mark: !
    "Semi",  # semicolon: ;
    "Slsh",  # slash: /
    "Elip",  # ellipsis: …
]
type PunctSide = Literal[
    "Ini",  # initial: ( „
    "Fin",  # final: ) ”
]
type Polite = Literal[
    "Depr",  # depreciative: a derogatory form of a masculine human noun
]
type ExtPos = Upos
"""UPOS of a multi-word unit this word heads, e.g. ADP for "w związku z"."""

Feats = TypedDict(
    "Feats",
    {
        "Abbr": Yes,
        "AdpType": AdpType,
        "Animacy": Animacy,
        "Aspect": Aspect,
        "Case": Case,
        "ConjType": ConjType,
        "Degree": Degree,
        "ExtPos": ExtPos,
        "Foreign": Yes,
        "Gender": Gender,
        "Hyph": Yes,
        "Mood": Mood,
        "NumForm": NumForm,
        "NumType": NumType,
        "Number": Number,
        "Number[psor]": Literal["Sing", "Plur"],
        "PartType": PartType,
        "Person": Person,
        "Polarity": Polarity,
        "Polite": Polite,
        "Poss": Yes,
        "PrepCase": PrepCase,
        "PronType": PronType,
        "PunctSide": PunctSide,
        "PunctType": PunctType,
        "Reflex": Yes,
        "Tense": Tense,
        "Variant": Variant,
        "VerbForm": VerbForm,
        "VerbType": VerbType,
        "Voice": Voice,
    },
    total=False,
)
"""UD morphological features. Every key is optional; a word only has the ones that apply.

Functional TypedDict syntax because "Number[psor]" (possessor's number: mój vs nasz) is not
a Python identifier.
"""


class Reading(TypedDict):
    """One reading of a word form: a dictionary candidate, or what the parser said."""

    lemma: str
    upos: Upos
    xpos: str
    """Language-specific tag for exactly this reading, e.g. "subst:sg:gen:m2"."""
    feats: Feats


type CaseRule = Literal[
    "vocative",  # addressing someone: Kasiu!
    "preposition",  # the preposition decides: do psa (gen), z psem (ins)
    "agreement",  # takes the case of the noun it describes: starego psa
    "numeral",  # numbers from five, and quantity words, take the genitive: pięć psów
    "verb",  # the verb asks for this case: szukać psa (gen), pomagać bratu (dat)
    "negation",  # a negated verb's object is genitive: nie mam czasu
    "structural",  # a verb's ordinary object is accusative: mam czas
    "partitive",  # genitive for "some of", accusative for "all of": nalać wody / wodę
    "subject",  # the subject is nominative
    "predicate",  # after być, a noun is instrumental: jest lekarzem
    "possessive",  # "of": dom brata
    "noun-complement",  # a noun's complement is genitive: osiągnięcie kompromisu
    "verbal-noun",  # a verbal noun's object is genitive: czytać książkę -> czytanie książki
    "coordination",  # same case as the first item of a list: ryż, pszenica i żyto
    "instrumental",  # by means of, or when: pisać długopisem, wieczorem
]


class CaseReason(TypedDict):
    rule: CaseRule
    trigger: NotRequired[int]
    """Index in the sentence of the word that causes the case: the preposition, the verb,
    nie, the numeral, or the noun an adjective agrees with."""
    governor: NotRequired[str]
    """Lemma of the verb or preposition, for the explanation: szukać, do."""


class CaseCorrection(TypedDict):
    """The case was changed from the parser's because the governing verb requires another
    and the form is the same in both: psa after szukać is genitive, not accusative."""

    original: Case
    """The parser's case."""
    governor: str
    """Lemma of the verb that requires the case."""


class Token(TypedDict):
    start: int
    """Character offset into the source text. Parts of a fused word share the whole word's span."""
    end: int
    text: str
    lemma: str | None
    """Dictionary form: psa -> pies."""
    lemma_id: str | None
    """Stable key "{lang}:{lemma}:{upos}", e.g. "pl:pies:NOUN". None for punctuation."""
    upos: Upos
    xpos: str | None
    """Language-specific tag. For Polish an NKJP tag like "subst:sg:gen:m2"; see nkjp.py."""
    feats: Feats
    head: int | None
    """Index in the sentence's token list of the word this one depends on. None for the root."""
    deprel: Deprel | None
    """UD dependency relation to the head: obl, amod, case, nsubj, ..."""
    mwt: NotRequired[str]
    """Set when this token is part of a multi-word token (a fused word); holds the whole word."""
    candidates: NotRequired[list[Reading]]
    """All readings the dictionary knows for this form. Only present when there is more than one."""
    parser: NotRequired[Reading]
    """What the parser said, when it was replaced by the closest dictionary reading because
    the dictionary doesn't allow it (see reconcile.py), or by the case the governing verb
    requires (pl_cases.py). Worth showing: one of them is wrong."""
    case_reason: NotRequired[CaseReason]
    """Why the word has its case, for words with a Case feature, when a rule explains it."""
    case_correction: NotRequired[CaseCorrection]
    """Set when the case was corrected by the governing verb's valency (pl_cases.py)."""


class ExpressionDef(TypedDict):
    """Input: a multi-word expression to look for, as a sequence of lemmas."""

    id: str
    lemmas: list[str]


ExpressionMatch = TypedDict("ExpressionMatch", {"from": int, "to": int, "id": str})
"""Output: token indices (inclusive) where an expression matched.

Functional TypedDict syntax because "from" is a Python keyword.
"""


class Sentence(TypedDict):
    start: int
    end: int
    tokens: list[Token]
    expressions: list[ExpressionMatch]


class Blob(TypedDict):
    schema: int
    """Version of this JSON shape."""
    analyzer: str
    """Plugin + library versions that produced it; a change means the blob can be regenerated."""
    lang: str
    hash: str
    """sha256 of the source text; the blob's storage key."""
    sentences: list[Sentence]
