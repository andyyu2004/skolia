"""Check labels coming from the parser against the Literal types in schema.py.

Type checkers can't see inside strings Stanza hands us at runtime, so this is the one
place where untyped parser output becomes typed. Anything not in schema.py raises.
"""

from typing import TypeGuard, cast, get_args, get_type_hints

from .schema import Deprel, Feats, Upos


class UnknownLabel(ValueError):
    pass


def _literal_values(alias: object) -> frozenset[str]:
    """All strings in a Literal, unwrapping `type X = ...` aliases."""
    while hasattr(alias, "__value__"):
        alias = cast(object, alias.__value__)  # pyright: ignore[reportAttributeAccessIssue]
    return frozenset(cast(tuple[str, ...], get_args(alias)))


UPOS_VALUES = _literal_values(Upos)
DEPREL_VALUES = _literal_values(Deprel)
FEAT_VALUES: dict[str, frozenset[str]] = {
    key: _literal_values(hint) for key, hint in get_type_hints(Feats).items()
}

# UD feature string: "Case=Gen|Number=Sing"
FEAT_SEP = "|"
FEAT_KV_SEP = "="


def is_upos(label: str) -> TypeGuard[Upos]:
    return label in UPOS_VALUES


def is_deprel(label: str) -> TypeGuard[Deprel]:
    return label in DEPREL_VALUES


def parse_upos(label: str | None) -> Upos:
    if label is None:
        return "X"
    if not is_upos(label):
        raise UnknownLabel(f"unknown UPOS {label!r}")
    return label


def parse_deprel(label: str | None) -> Deprel | None:
    if label is None:
        return None
    if not is_deprel(label):
        raise UnknownLabel(f"unknown deprel {label!r}")
    return label


def parse_feats(raw: str | None) -> Feats:
    if not raw:
        return {}
    parsed: dict[str, str] = {}
    for pair in raw.split(FEAT_SEP):
        key, value = pair.split(FEAT_KV_SEP, 1)
        if value not in FEAT_VALUES.get(key, ()):
            raise UnknownLabel(f"unknown UD feature {key}={value}")
        parsed[key] = value
    return cast(Feats, parsed)
