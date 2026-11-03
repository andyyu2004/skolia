class Word:
    id: int
    text: str
    lemma: str | None
    upos: str | None
    xpos: str | None
    feats: str | None
    head: int | None
    deprel: str | None

class Token:
    text: str
    start_char: int
    end_char: int
    words: list[Word]

class Sentence:
    text: str
    tokens: list[Token]
    words: list[Word]

class Document:
    text: str
    sentences: list[Sentence]
