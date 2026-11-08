"""Dictionary lemmas for French personal pronouns and possessive determiners.

UD French GSD, which Stanza's French models learn from, gives every personal pronoun its
person's stressed form (il, elle, le -> lui; je, me -> moi; se -> soi) and every
possessive determiner the lemma son, with the owner in Person[psor] and Number[psor]. A
dictionary lists them under their own headwords: il is "he", lui "him", ma is under mon
"my", son is "his, her". The features stay as the parser gave them; only the lemma, and
so the meaning shown, changes.
"""

from collections.abc import Iterable, Mapping
from dataclasses import replace

from ...parsed import ParsedSentence, ParsedToken, ParsedWord
from ...schema import Number, Person

# (Person[psor], Number[psor]) -> the determiner's headword: ma, mes are under mon
POSSESSIVES: Mapping[tuple[Person, Number], str] = {
    ("1", "Sing"): "mon",
    ("2", "Sing"): "ton",
    ("3", "Sing"): "son",
    ("1", "Plur"): "notre",
    ("2", "Plur"): "votre",
    ("3", "Plur"): "leur",
}

# Elided pronouns (j'arrive, il m'aime) and those the dictionary lists under another
# form: les and eux are the plurals of le and lui
PRONOUNS: Mapping[str, str] = {
    "j'": "je",
    "m'": "me",
    "t'": "te",
    "s'": "se",
    "les": "le",
    "eux": "lui",
}

# Inverted subjects are written joined to the verb: vient-il, a-t-elle
INVERSION_PREFIXES = ("-t-", "-")


def relemmatize(sentences: Iterable[ParsedSentence]) -> list[ParsedSentence]:
    return [
        ParsedSentence(tuple(_token(token) for token in sentence.tokens)) for sentence in sentences
    ]


def _token(token: ParsedToken) -> ParsedToken:
    return replace(token, words=tuple(_word(word) for word in token.words))


def _word(word: ParsedWord) -> ParsedWord:
    lemma = dictionary_lemma(word)
    return word if lemma is None or lemma == word.lemma else replace(word, lemma=lemma)


def dictionary_lemma(word: ParsedWord) -> str | None:
    """The headword a dictionary lists the word under, for the words GSD lemmatizes
    otherwise; None for the rest."""
    feats = word.feats
    if word.upos == "DET" and feats.get("Poss") == "Yes":
        person, number = feats.get("Person[psor]"), feats.get("Number[psor]")
        if person is None or number is None:
            return None
        return POSSESSIVES.get((person, number))
    if word.upos == "PRON" and feats.get("PronType") == "Prs":
        form = word.text.lower().replace("’", "'")  # noqa: RUF001 (typographic apostrophe)
        form = next((form.removeprefix(p) for p in INVERSION_PREFIXES if form.startswith(p)), form)
        if form == "l'":
            return "la" if feats.get("Gender") == "Fem" else "le"
        return PRONOUNS.get(form, form)
    return None
