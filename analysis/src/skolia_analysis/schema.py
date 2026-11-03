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
    "NOUN",
    "NUM",  # numeral
    "PART",  # particle
    "PRON",  # pronoun
    "PROPN",  # proper noun
    "PUNCT",
    "SCONJ",  # subordinating conjunction
    "SYM",  # symbol
    "VERB",
    "X",  # other
]

type Deprel = Literal[
    "acl",
    "acl:cmp",
    "acl:relcl",
    "advcl",
    "advcl:cmp",
    "advcl:relcl",
    "advmod",
    "advmod:arg",
    "advmod:cmp",
    "advmod:emph",
    "advmod:neg",
    "amod",
    "amod:cmp",
    "amod:flat",
    "appos",
    "aux",
    "aux:clitic",
    "aux:cnd",
    "aux:imp",
    "aux:pass",
    "case",
    "cc",
    "cc:preconj",
    "ccomp",
    "ccomp:cleft",
    "ccomp:obj",
    "conj",
    "cop",
    "csubj",
    "csubj:pass",
    "dep",
    "det",
    "det:numgov",
    "det:nummod",
    "det:poss",
    "discourse",
    "discourse:intj",
    "expl:pv",
    "fixed",
    "flat",
    "flat:foreign",
    "iobj",
    "list",
    "mark",
    "nmod",
    "nmod:arg",
    "nmod:cmp",
    "nmod:flat",
    "nmod:poss",
    "nmod:pred",
    "nsubj",
    "nsubj:pass",
    "nummod",
    "nummod:flat",
    "nummod:gov",
    "obj",
    "obl",
    "obl:agent",
    "obl:arg",
    "obl:cmp",
    "obl:orphan",
    "orphan",
    "parataxis",
    "parataxis:insert",
    "parataxis:obj",
    "punct",
    "reparandum",
    "root",
    "vocative",
    "xcomp",
    "xcomp:cleft",
    "xcomp:pred",
    "xcomp:subj",
]

type Yes = Literal["Yes"]
type Case = Literal["Nom", "Gen", "Dat", "Acc", "Ins", "Loc", "Voc"]
type Number = Literal["Sing", "Plur", "Ptan"]
"""Ptan: plurale tantum, a noun that only has plural forms (drzwi, nożyczki)."""
type Gender = Literal["Masc", "Fem", "Neut"]
type Animacy = Literal["Hum", "Nhum", "Inan"]
"""Masculine only. Hum: human (student), Nhum: other animate (pies), Inan: inanimate (stół)."""
type Person = Literal["0", "1", "2", "3"]
"""0: the impersonal -no/-to form (zrobiono)."""
type Aspect = Literal["Imp", "Perf"]
type Tense = Literal["Past", "Pres", "Fut"]
type Mood = Literal["Ind", "Imp"]
type VerbForm = Literal["Fin", "Inf", "Part", "Conv", "Vnoun"]
"""Conv: adverbial participle (robiąc). Vnoun: verbal noun (robienie)."""
type Voice = Literal["Act", "Pass"]
type Degree = Literal["Pos", "Cmp", "Sup"]
type Polarity = Literal["Pos", "Neg"]
type PronType = Literal["Prs", "Dem", "Rel", "Int", "Ind", "Tot", "Neg"]
"""Prs: personal, Dem: demonstrative, Rel: relative, Int: interrogative, Ind: indefinite,
Tot: total (wszystko, każdy), Neg: negative (nic, nikt)."""
type Variant = Literal["Short", "Long"]
"""Short/long form: w/we, go/jego, mi/mnie."""
type PrepCase = Literal["Pre", "Npr"]
"""Pronoun form used after a preposition (niego) or not (jego)."""
type NumType = Literal["Card", "Ord", "Sets"]
"""Sets: collective numeral (dwoje)."""
type NumForm = Literal["Word", "Digit", "Roman"]
type AdpType = Literal["Prep", "Post"]
type ConjType = Literal["Comp", "Pred", "Oper"]
type PartType = Literal["Int", "Mod"]
type VerbType = Literal["Quasi", "Mod"]
"""Quasi: predicative like trzeba, można. Mod: winien, powinien."""
type PunctType = Literal[
    "Peri", "Comm", "Dash", "Quot", "Brck", "Qest", "Colo", "Excl", "Semi", "Slsh", "Elip"
]
type PunctSide = Literal["Ini", "Fin"]
type Polite = Literal["Depr"]
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


class Candidate(TypedDict):
    """One possible reading of a word form, whether or not the parser picked it."""

    lemma: str
    upos: Upos
    feats: Feats


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
    candidates: NotRequired[list[Candidate]]
    """All readings the dictionary knows for this form. Only present when there is more than one."""


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
