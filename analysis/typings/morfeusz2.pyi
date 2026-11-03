type Interpretation = tuple[str, str, str, list[str], list[str]]
"""(orth, lemma, NKJP tag, name labels, qualifiers). orth is the slice of the input this
edge covers; name labels mark proper names (imię, nazwa_geograficzna, ...); qualifiers
mark register (przest.: obsolete, pot.: colloquial, ...)."""

type Edge = tuple[int, int, Interpretation]
"""(start node, end node, interpretation): one edge of the analysis graph."""

class Morfeusz:
    def __init__(self) -> None: ...
    def analyse(self, text: str) -> list[Edge]: ...
