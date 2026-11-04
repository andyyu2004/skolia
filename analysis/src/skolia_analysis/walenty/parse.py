"""Parse Walenty's plain-text release into the typed model (model.py).

Strict: a construct or value the model doesn't know raises WalentyError with the text
around it, so nothing is silently dropped. Grammar of a schema's positions:

    positions  := position (" + " position)*
    position   := [label ("," label)*] "{" phrase (";" phrase)* "}"
    phrase     := name ["(" arguments ")"]          np(gen), prepnp(w,loc), possp, ...
    lex        := "lex(" phrase "," inflection... "," lemmas "," modification ")"
    lemmas     := 'word' | XOR('a','b',...) | OR('a';'b';...)
    modification := natr | (atr | atr1 | ratr | ratr1) ["(" positions ")"]
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Literal, NoReturn

from . import vocabulary as v
from .model import (
    Adverbial,
    Expansions,
    FixedText,
    LemmaChoice,
    Lex,
    LexComparison,
    LexForm,
    Modification,
    Phrase,
    Position,
    Realisation,
    Schema,
    WordRealisation,
    inflects_like,
)
from .vocabulary import (
    AdverbialCategory,
    CaseSpec,
    Certainty,
    Complementizer,
    ComplexPreposition,
    Lemma,
    PartOfSpeech,
    Preposition,
    WhWord,
)


class WalentyError(ValueError):
    pass


type TokenKind = Literal["name", "quote", "symbol", "end"]

TOKEN = re.compile(r"\s*(?:'([^']*)'|([(){}\[\],;+])|([^\s(){}\[\],;+']+))")
FIELD_SEP = ": "
FIELDS = 6
COMMENT = "%"
REFLEXIVE_SUFFIX = " się"
REFLEXIVE = "się"
EXPANSION_ARROW = "-->"
ALTERNATIVE_SEP = "."
BYTE_ORDER_MARK = "\N{ZERO WIDTH NO-BREAK SPACE}"


@dataclass(frozen=True, slots=True)
class Token:
    kind: TokenKind
    text: str
    offset: int


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    offset = 0
    while offset < len(text):
        if text[offset:].strip() == "":
            break
        match = TOKEN.match(text, offset)
        if match is None or match.end() == offset:
            raise WalentyError(f"can't tokenize at {text[offset : offset + 30]!r}")
        quote, symbol, name = match.groups()
        start = (
            match.start(1) if quote is not None else match.start(2) if symbol else match.start(3)
        )
        if quote is not None:
            tokens.append(Token("quote", quote, start))
        elif symbol is not None:
            tokens.append(Token("symbol", symbol, start))
        else:
            tokens.append(Token("name", name or "", start))
        offset = match.end()
    tokens.append(Token("end", "", len(text)))
    return tokens


class Parser:
    def __init__(self, text: str, complex_prepositions: frozenset[str] | None = None) -> None:
        self.text = text
        self.tokens = tokenize(text)
        self.index = 0
        self.complex_prepositions = complex_prepositions

    # --- tokens ------------------------------------------------------------------------

    def peek(self, ahead: int = 0) -> Token:
        return self.tokens[min(self.index + ahead, len(self.tokens) - 1)]

    def advance(self) -> Token:
        token = self.peek()
        self.index += 1
        return token

    def at(self, symbol: str) -> bool:
        token = self.peek()
        return token.kind == "symbol" and token.text == symbol

    def expect(self, symbol: str) -> None:
        if not self.at(symbol):
            self.fail(f"expected {symbol!r}")
        self.advance()

    def name(self) -> str:
        token = self.advance()
        if token.kind != "name":
            self.index -= 1
            self.fail("expected a name")
        return token.text

    def words_until(self, *stops: str) -> str:
        """Names up to one of the stop symbols, joined by spaces: co do, na temat."""
        words: list[str] = []
        while not any(self.at(stop) for stop in stops):
            words.append(self.name())
        if not words:
            self.fail("expected a word")
        return " ".join(words)

    def fail(self, message: str) -> NoReturn:
        token = self.peek()
        context = self.text[max(0, token.offset - 25) : token.offset + 25]
        raise WalentyError(f"{message} at {token.text!r} in ...{context}...")

    def done(self) -> None:
        if self.peek().kind != "end":
            self.fail("unexpected text after the end")

    # --- typed values --------------------------------------------------------------------

    def case(self) -> CaseSpec:
        value = self.name()
        if not v.is_case_spec(value):
            self.index -= 1
            self.fail(f"unknown case {value!r}")
        return value

    def preposition(self) -> Preposition:
        value = self.words_until(",")
        if not v.is_preposition(value):
            self.fail(f"unknown preposition {value!r}")
        return value

    def complex_preposition(self) -> ComplexPreposition:
        value = self.words_until(")")
        known = self.complex_prepositions
        if known is not None and value not in known:
            self.fail(f"unknown complex preposition {value!r}")
        return ComplexPreposition(value)

    def complementizer(self) -> tuple[Complementizer, list[WhWord]]:
        value = self.name()
        if not v.is_complementizer(value):
            self.index -= 1
            self.fail(f"unknown complementizer {value!r}")
        words: list[WhWord] = []
        if self.at("["):
            self.advance()
            while True:
                word = self.words_until(";", "]")
                if not v.is_wh_word(word):
                    self.fail(f"unknown question word {word!r}")
                words.append(word)
                if self.at("]"):
                    break
                self.expect(";")
            self.expect("]")
        return value, words

    def category(self) -> AdverbialCategory:
        value = self.name()
        if not v.is_adverbial_category(value):
            self.index -= 1
            self.fail(f"unknown adverbial category {value!r}")
        return value

    def any_value(self) -> str:
        """A value where Walenty's _ means any."""
        value = self.name()
        return "any" if value == v.ANY else value

    def number(self) -> v.NumberSpec:
        value = self.any_value()
        if not v.is_number(value):
            self.fail(f"unknown number {value!r}")
        return value

    def genders(self) -> list[v.GenderSpec]:
        """One gender, or alternatives joined by dots: m1.m2.m3.f.n."""
        genders: list[v.GenderSpec] = []
        for value in self.any_value().split(ALTERNATIVE_SEP):
            if not v.is_gender(value):
                self.fail(f"unknown gender {value!r}")
            genders.append(value)
        return genders

    def degree(self) -> v.DegreeSpec:
        value = self.any_value()
        if not v.is_degree(value):
            self.fail(f"unknown degree {value!r}")
        return value

    def negation(self) -> v.Negation:
        value = self.any_value()
        if not v.is_negation(value):
            self.fail(f"unknown negation {value!r}")
        return value

    def aspect(self) -> v.Aspect:
        value = self.any_value()
        if not v.is_aspect(value):
            self.fail(f"unknown aspect {value!r}")
        return value

    def reflexive(self) -> bool:
        """The się slot of a verbal lex: empty or się."""
        if self.at(","):
            return False
        if self.name() != REFLEXIVE:
            self.index -= 1
            self.fail("expected się or nothing")
        return True

    # --- structure -------------------------------------------------------------------

    def positions(self, *stops: str) -> list[Position]:
        positions = [self.position()]
        while self.at("+"):
            self.advance()
            positions.append(self.position())
        if stops and not any(self.at(stop) for stop in stops):
            self.fail(f"expected one of {stops}")
        return positions

    def position(self) -> Position:
        labels: list[v.Label] = []
        if self.peek().kind == "name":
            while True:
                label = self.name()
                if not v.is_label(label):
                    self.index -= 1
                    self.fail(f"unknown label {label!r}")
                labels.append(label)
                if not self.at(","):
                    break
                self.advance()
        self.expect("{")
        phrases = [self.phrase()]
        while self.at(";"):
            self.advance()
            phrases.append(self.phrase())
        self.expect("}")
        return {"labels": labels, "phrases": phrases}

    def phrase(self) -> Phrase:
        name = self.name()
        if v.is_atom(name):
            return {"kind": name}
        self.expect("(")
        phrase = self._phrase_body(name)
        self.expect(")")
        return phrase

    def _phrase_body(self, name: str) -> Phrase:
        match name:
            case "np":
                return {"kind": "np", "case": self.case()}
            case "adjp":
                return {"kind": "adjp", "case": self.case()}
            case "nump":
                return {"kind": "nump", "case": self.case()}
            case "ppasp":
                return {"kind": "ppasp", "case": self.case()}
            case "pactp":
                return {"kind": "pactp", "case": self.case()}
            case "prepnp" | "prepadjp" | "prepnump" | "prepgerp" | "prepppasp":
                prep = self.preposition()
                self.expect(",")
                case = self.case()
                return self._prepositional(name, prep, case)
            case "comprepnp":
                return {"kind": "comprepnp", "prep": self.complex_preposition()}
            case "cp":
                complementizer, words = self.complementizer()
                return {"kind": "cp", "complementizer": complementizer, "words": words}
            case "ncp":
                case = self.case()
                self.expect(",")
                complementizer, words = self.complementizer()
                return {
                    "kind": "ncp",
                    "case": case,
                    "complementizer": complementizer,
                    "words": words,
                }
            case "prepncp":
                prep = self.preposition()
                self.expect(",")
                case = self.case()
                self.expect(",")
                complementizer, words = self.complementizer()
                return {
                    "kind": "prepncp",
                    "prep": prep,
                    "case": case,
                    "complementizer": complementizer,
                    "words": words,
                }
            case "infp":
                return {"kind": "infp", "aspect": self.aspect()}
            case "xp":
                return self._adverbial()
            case "advp":
                return {"kind": "advp", "category": self.category()}
            case "compar":
                comparator = self.name()
                if not v.is_comparator(comparator):
                    self.index -= 1
                    self.fail(f"unknown comparator {comparator!r}")
                return {"kind": "compar", "comparator": comparator}
            case "fixed":
                phrase = self.phrase()
                self.expect(",")
                token = self.advance()
                if token.kind != "quote":
                    self.index -= 1
                    self.fail("expected the fixed words in quotes")
                return {"kind": "fixed", "phrase": phrase, "text": FixedText(token.text)}
            case "lex":
                return self._lex()
            case _:
                self.index -= 2
                self.fail(f"unknown phrase type {name!r}")

    def _prepositional(self, name: str, prep: Preposition, case: CaseSpec) -> Phrase:
        match name:
            case "prepnp":
                return {"kind": "prepnp", "prep": prep, "case": case}
            case "prepadjp":
                return {"kind": "prepadjp", "prep": prep, "case": case}
            case "prepnump":
                return {"kind": "prepnump", "prep": prep, "case": case}
            case "prepgerp":
                return {"kind": "prepgerp", "prep": prep, "case": case}
            case _:
                return {"kind": "prepppasp", "prep": prep, "case": case}

    def _adverbial(self) -> Adverbial:
        category = self.category()
        realisations: list[Phrase] = []
        if self.at("["):
            self.advance()
            realisations.append(self.phrase())
            while self.at(";"):
                self.advance()
                realisations.append(self.phrase())
            self.expect("]")
        return {"kind": "xp", "category": category, "realisations": realisations}

    # --- lex ---------------------------------------------------------------------------

    def _lex(self) -> Lex | LexComparison:
        phrase = self.phrase()
        self.expect(",")
        core = inflects_like(phrase)
        if core["kind"] == "compar":
            parts = [self._lex_part()]
            while self.at("+"):
                self.advance()
                parts.append(self._lex_part())
            return {"kind": "lexcompar", "phrase": phrase, "parts": parts}
        form, lemmas = self._form_and_lemmas(core)
        self.expect(",")
        modification = self.modification()
        return {
            "kind": "lex",
            "phrase": phrase,
            "form": form,
            "lemmas": lemmas,
            "modification": modification,
        }

    def _lex_part(self) -> Lex:
        part = self.phrase()
        if part["kind"] != "lex":
            self.fail("expected lex(...) in a fixed comparison")
        return part

    def _form_and_lemmas(self, core: Phrase) -> tuple[LexForm, LemmaChoice]:
        """The inflection slots and the lemmas, whose order depends on the phrase type."""
        match core["kind"]:
            case "np" | "prepnp":
                number = self.number()
                self.expect(",")
                return {"shape": "nominal", "number": number}, self.lemma_choice()
            case "adjp" | "prepadjp":
                number = self.number()
                self.expect(",")
                genders = self.genders()
                self.expect(",")
                degree = self.degree()
                self.expect(",")
                form: LexForm = {
                    "shape": "adjectival",
                    "number": number,
                    "genders": genders,
                    "degree": degree,
                }
                return form, self.lemma_choice()
            case "ppasp" | "prepppasp" | "pactp":
                number = self.number()
                self.expect(",")
                genders = self.genders()
                self.expect(",")
                negation = self.negation()
                self.expect(",")
                lemmas = self.lemma_choice()
                reflexive = False
                if core["kind"] == "pactp":
                    self.expect(",")
                    reflexive = self.reflexive()
                form = {
                    "shape": "participial",
                    "number": number,
                    "genders": genders,
                    "negation": negation,
                    "reflexive": reflexive,
                }
                return form, lemmas
            case "infp" | "cp" | "ncp":
                negation = self.negation()
                self.expect(",")
                lemmas = self.lemma_choice()
                self.expect(",")
                reflexive = self.reflexive()
                return {"shape": "verbal", "negation": negation, "reflexive": reflexive}, lemmas
            case "prepgerp":
                number = self.number()
                self.expect(",")
                negation = self.negation()
                self.expect(",")
                lemmas = self.lemma_choice()
                self.expect(",")
                reflexive = self.reflexive()
                form = {
                    "shape": "gerund",
                    "number": number,
                    "negation": negation,
                    "reflexive": reflexive,
                }
                return form, lemmas
            case "nump" | "prepnump":
                numeral = self.lemma_choice()
                self.expect(",")
                return {"shape": "numeral", "numeral": numeral}, self.lemma_choice()
            case "advp":
                degree = self.degree()
                self.expect(",")
                return {"shape": "adverbial", "degree": degree}, self.lemma_choice()
            case "qub":
                return {"shape": "particle"}, self.lemma_choice()
            case _:
                self.fail(f"lex of {core['kind']} isn't modelled")

    def lemma_choice(self) -> LemmaChoice:
        token = self.peek()
        if token.kind == "quote":
            self.advance()
            return {"kind": "one", "lemma": Lemma(token.text)}
        operator = self.name()
        if operator not in ("XOR", "OR"):
            self.index -= 1
            self.fail("expected a quoted lemma, XOR(...) or OR(...)")
        self.expect("(")
        lemmas: list[Lemma] = []
        while True:
            quoted = self.advance()
            if quoted.kind != "quote":
                self.index -= 1
                self.fail("expected a quoted lemma")
            lemmas.append(Lemma(quoted.text))
            if self.at(")"):
                break
            # Both separators occur: XOR('praca','robota'), OR('myśl';'umysł')
            if not (self.at(",") or self.at(";")):
                self.fail("expected , or ; between lemmas")
            self.advance()
        self.expect(")")
        return (
            {"kind": "xor", "lemmas": lemmas}
            if operator == "XOR"
            else {"kind": "or", "lemmas": lemmas}
        )

    def modification(self) -> Modification:
        kind = self.name()
        if not v.is_modifiability(kind):
            self.index -= 1
            self.fail(f"unknown modification {kind!r}")
        positions: list[Position] = []
        if self.at("("):
            self.advance()
            positions = self.positions(")", ",")
            # atr({...},{...}): a second group of positions
            while self.at(","):
                self.advance()
                positions += self.positions(")", ",")
            self.expect(")")
        return {"kind": kind, "positions": positions}


# --- files ----------------------------------------------------------------------------


def parse_positions(
    text: str, complex_prepositions: frozenset[str] | None = None
) -> list[Position]:
    if not text.strip():
        return []
    parser = Parser(text, complex_prepositions)
    positions = parser.positions()
    parser.done()
    return positions


def parse_schema(
    line: str, pos: PartOfSpeech, complex_prepositions: frozenset[str] | None = None
) -> Schema:
    fields = line.rstrip("\n").split(FIELD_SEP, FIELDS - 1)
    if len(fields) != FIELDS:
        raise WalentyError(f"expected {FIELDS} fields: {line!r}")
    lemma, certainty, negation, predicative, aspect, positions = fields
    if certainty not in v.CERTAINTY:
        raise WalentyError(f"unknown certainty {certainty!r}")
    negation_value = "any" if negation in ("", v.ANY) else negation
    aspect_value = "any" if aspect in ("", v.ANY) else aspect
    if not v.is_negation(negation_value):
        raise WalentyError(f"unknown negation {negation!r}")
    if not v.is_aspect(aspect_value):
        raise WalentyError(f"unknown aspect {aspect!r}")
    if predicative not in ("", "pred"):
        raise WalentyError(f"unknown predicativity {predicative!r}")
    reflexive = lemma.endswith(REFLEXIVE_SUFFIX)
    return {
        "pos": pos,
        "lemma": Lemma(lemma.removesuffix(REFLEXIVE_SUFFIX)),
        "reflexive": reflexive,
        "certainty": v.CERTAINTY[certainty],
        "negation": negation_value,
        "predicative": predicative == "pred",
        "aspect": aspect_value,
        "positions": parse_positions(positions, complex_prepositions),
    }


def schema_lines(lines: Iterable[str]) -> Iterator[str]:
    """Lines that aren't blank or comments. The files start with a byte order mark."""
    for line in lines:
        text = line.removeprefix(BYTE_ORDER_MARK)
        if text.strip() and not text.startswith(COMMENT):
            yield text


def empty_expansions() -> Expansions:
    return {
        "adverbials": {},
        "adverbs": {},
        "complex_prepositions": {},
        "possessive": [],
        "distributive": [],
        "question_words": [],
        "relative_words": [],
        "variants": {},
    }


def parse_expansions(lines: Iterable[str]) -> Expansions:
    """phrase_types_expand_*.txt: "head-->" lines, then indented "realisation\\t[certainty]"."""
    blocks: dict[str, list[tuple[str, Certainty]]] = {}
    head: str | None = None
    for line in schema_lines(lines):
        if not line.startswith((" ", "\t")):
            head = line.strip().removesuffix(EXPANSION_ARROW)
            blocks[head] = []
            continue
        if head is None:
            raise WalentyError(f"realisation before any head: {line!r}")
        body, _, certainty = line.strip().rpartition("\t")
        if not body:  # variants (jak --> niczym) have no certainty
            body, certainty = certainty, "pewna"
        label = certainty.strip("[]")
        if label not in v.CERTAINTY:
            raise WalentyError(f"unknown certainty {certainty!r} under {head}")
        blocks[head].append((body, v.CERTAINTY[label]))
    complex_names = frozenset(
        h.removeprefix("comprepnp(").removesuffix(")") for h in blocks if h.startswith("comprepnp(")
    )
    expansions = empty_expansions()

    def realisations(items: list[tuple[str, Certainty]]) -> list[Realisation]:
        return [
            {"positions": _realisation_positions(body, complex_names), "certainty": cert}
            for body, cert in items
        ]

    def words(items: list[tuple[str, Certainty]]) -> list[WordRealisation]:
        return [{"word": Lemma(body), "certainty": cert} for body, cert in items]

    for head, items in blocks.items():
        argument = head[head.find("(") + 1 : -1] if "(" in head else ""
        if head.startswith("xp(") and v.is_adverbial_category(argument):
            expansions["adverbials"][argument] = realisations(items)
        elif head.startswith("advp(") and v.is_adverbial_category(argument):
            expansions["adverbs"][argument] = words(items)
        elif head.startswith("comprepnp("):
            expansions["complex_prepositions"][ComplexPreposition(argument)] = realisations(items)
        elif head == "possp":
            expansions["possessive"] = realisations(items)
        elif head == "distrp":
            expansions["distributive"] = realisations(items)
        elif head == "int":
            expansions["question_words"] = words(items)
        elif head == "rel":
            expansions["relative_words"] = words(items)
        elif "(" not in head:
            expansions["variants"][Lemma(head)] = [Lemma(body) for body, _ in items]
        else:
            raise WalentyError(f"unknown expansion head {head!r}")
    return expansions


def _realisation_positions(body: str, complex_prepositions: frozenset[str]) -> list[Position]:
    """A realisation is either positions ({...} + {...}) or a single bare phrase."""
    text = body if body.lstrip().startswith(("{", "subj", "obj")) else "{" + body + "}"
    return parse_positions(text, complex_prepositions)
