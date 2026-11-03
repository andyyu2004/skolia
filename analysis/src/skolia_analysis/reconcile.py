"""Reconcile the parser's reading with the dictionary's.

The parser picks one reading from context but can pick one the language doesn't allow
(rękawiczkach as masculine: the dictionary knows it is feminine). The dictionary lists
every allowed reading but can't pick. A policy replaces the parser's reading with the
closest dictionary reading when the parser's isn't among them. Which policy helps is
measured with scripts/eval_ud.py; the policies differ in how far they may move.
"""

from collections.abc import Callable, Sequence

from .schema import Feats, Reading

type Policy = Callable[[Reading, Sequence[Reading]], Reading | None]
"""(parser reading, dictionary readings) -> replacement, or None to keep the parser's."""

# Features that depend on the sentence, never in a dictionary: ExtPos marks the head of a
# multi-word unit (w związku z). Ignored when comparing, kept from the parser when replacing.
CONTEXTUAL_FEATS = frozenset({"ExtPos"})

# Words the dictionary describes differently or not at all: an abbreviation (proc. for
# procent) is tagged with its expansion's part of speech, a foreign word isn't inflected,
# and the head of a multi-word unit (ExtPos) is annotated as the unit (gdzie in "gdzie
# indziej" gets no PronType). The parser's reading is kept as it is.
UNSNAPPABLE = ("Abbr", "Foreign", "ExtPos")

type FeatSet = frozenset[tuple[str, object]]


def core(feats: Feats) -> FeatSet:
    return frozenset((k, v) for k, v in feats.items() if k not in CONTEXTUAL_FEATS)


def same_lemma_text(a: Reading, b: Reading) -> bool:
    """Lemmas compared ignoring case: PDB writes Nowy (in Nowy Jork), Morfeusz nowy."""
    return a["lemma"].lower() == b["lemma"].lower()


def same(a: Reading, b: Reading) -> bool:
    return same_lemma_text(a, b) and a["upos"] == b["upos"] and core(a["feats"]) == core(b["feats"])


def allowed(parser: Reading, readings: Sequence[Reading]) -> bool:
    return any(same(parser, r) for r in readings)


def feature_distance(a: Reading, b: Reading) -> int:
    return len(core(a["feats"]) ^ core(b["feats"]))


def with_context(parser: Reading, replacement: Reading) -> Reading:
    feats: Feats = {}
    feats.update(replacement["feats"])
    if "ExtPos" in parser["feats"]:
        feats["ExtPos"] = parser["feats"]["ExtPos"]
    lemma = parser["lemma"] if same_lemma_text(parser, replacement) else replacement["lemma"]
    return {**replacement, "lemma": lemma, "feats": feats}


def _closest(
    parser: Reading, readings: Sequence[Reading], eligible: Callable[[Reading], bool]
) -> Reading | None:
    if allowed(parser, readings) or any(k in parser["feats"] for k in UNSNAPPABLE):
        return None
    pool = [r for r in readings if eligible(r)]
    if not pool:
        return None

    def distance(r: Reading) -> tuple[bool, bool, int]:
        return (
            not same_lemma_text(r, parser),
            r["upos"] != parser["upos"],
            feature_distance(parser, r),
        )

    return with_context(parser, min(pool, key=distance))


def same_lemma_and_upos(parser: Reading, readings: Sequence[Reading]) -> Reading | None:
    """Fix features only: the parser's lemma and part of speech stay."""
    return _closest(
        parser,
        readings,
        lambda r: same_lemma_text(r, parser) and r["upos"] == parser["upos"],
    )


def same_lemma(parser: Reading, readings: Sequence[Reading]) -> Reading | None:
    """Fix features and part of speech; the lemma stays."""
    return _closest(parser, readings, lambda r: same_lemma_text(r, parser))


def same_upos(parser: Reading, readings: Sequence[Reading]) -> Reading | None:
    """Fix features and lemma; the part of speech stays. A lemma the dictionary doesn't
    have for this form (an invented one like rozpryskować) gets replaced."""
    return _closest(parser, readings, lambda r: r["upos"] == parser["upos"])


def nearest(parser: Reading, readings: Sequence[Reading]) -> Reading | None:
    """Anything may change, including a lemma the dictionary doesn't know."""
    return _closest(parser, readings, lambda _r: True)


POLICIES: dict[str, Policy] = {
    "lemma+upos": same_lemma_and_upos,
    "lemma": same_lemma,
    "upos": same_upos,
    "nearest": nearest,
}
