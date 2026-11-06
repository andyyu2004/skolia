"""pl.assemble on hand-built parser output: from ParsedSentence to the analysis blob, with
Morfeusz candidates and Walenty valency, but no parser model."""

from collections.abc import Sequence

from skolia_analysis.blob import CandidateLookup
from skolia_analysis.lang.pl import plugin as pl
from skolia_analysis.lang.pl.valency import Valency
from skolia_analysis.lang.pl.walenty.parse import empty_expansions, parse_schema
from skolia_analysis.parsed import ParsedSentence, ParsedToken, ParsedWord, align
from skolia_analysis.schema import Blob, Deprel, ExpressionDef, Feats, Token, Upos

# As in test_pl_cases.py (tests/pl/ is not a package, so it can't be imported)
VALENCY = Valency(
    {
        "version": "walenty-test",
        "schemata": [
            parse_schema("szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)}", "verb")
        ],
        "expansions": empty_expansions(),
    }
)
MODEL = "test-model"
CANDIDATES: CandidateLookup = pl.candidate_lookup()

MASC_NHUM_SING: Feats = {"Number": "Sing", "Gender": "Masc", "Animacy": "Nhum"}
SZUKAM: Feats = {
    "Aspect": "Imp",
    "Mood": "Ind",
    "Number": "Sing",
    "Person": "1",
    "Tense": "Pres",
    "VerbForm": "Fin",
    "Voice": "Act",
}
PERIOD: Feats = {"PunctType": "Peri"}


def word(
    text: str,
    lemma: str | None,
    upos: Upos,
    xpos: str | None,
    feats: Feats,
    head: int | None,
    deprel: Deprel,
) -> ParsedWord:
    return ParsedWord(text, lemma, upos, xpos, feats, head, deprel)


def sentence(text: str, start: int, tokens: Sequence[tuple[ParsedWord, ...]]) -> ParsedSentence:
    """Tokens from their words; a token's surface is its words joined (zrobił + em)."""
    surfaces = ["".join(w.text for w in words) for words in tokens]
    spans = align(text, surfaces, start)
    return ParsedSentence(
        tuple(
            ParsedToken(surface, s, e, words)
            for surface, (s, e), words in zip(surfaces, spans, tokens, strict=True)
        )
    )


def assemble(
    text: str, parsed: list[ParsedSentence], expressions: Sequence[ExpressionDef] = ()
) -> Blob:
    return pl.assemble(
        text, parsed, MODEL, candidates=CANDIDATES, expressions=expressions, valency=VALENCY
    )


def szukam_starego_psa(text: str, start: int = 0) -> ParsedSentence:
    """As COMBO parses it: psa (and starego) accusative, though szukać takes the genitive."""
    accusative: Feats = {"Case": "Acc", **MASC_NHUM_SING}
    return sentence(
        text,
        start,
        [
            (word("Szukam", "szukać", "VERB", "fin:sg:pri:imperf", SZUKAM, None, "root"),),
            (
                word(
                    "starego",
                    "stary",
                    "ADJ",
                    "adj:sg:acc:m2:pos",
                    {**accusative, "Degree": "Pos"},
                    2,
                    "amod",
                ),
            ),
            (word("psa", "pies", "NOUN", "subst:sg:acc:m2", accusative, 0, "obj"),),
            (word(".", ".", "PUNCT", "interp", PERIOD, 0, "punct"),),
        ],
    )


def zrobilem_to(text: str, start: int = 0) -> ParsedSentence:
    zrobil: Feats = {
        "Aspect": "Perf",
        "Gender": "Masc",
        "Animacy": "Hum",
        "Mood": "Ind",
        "Number": "Sing",
        "Tense": "Past",
        "VerbForm": "Fin",
        "Voice": "Act",
    }
    em: Feats = {"Aspect": "Imp", "Number": "Sing", "Person": "1", "Variant": "Long"}
    to: Feats = {"Case": "Acc", "Gender": "Neut", "Number": "Sing", "PronType": "Dem"}
    return sentence(
        text,
        start,
        [
            (
                word("Zrobił", "zrobić", "VERB", "praet:sg:m1:perf", zrobil, None, "root"),
                word("em", "być", "AUX", "aglt:sg:pri:imperf:wok", em, 0, "aux:clitic"),
            ),
            (word("to", "to", "PRON", "subst:sg:acc:n", to, 0, "obj"),),
            (word(".", ".", "PUNCT", "interp", PERIOD, 0, "punct"),),
        ],
    )


def test_offsets_slice_the_text_and_sentences_stay_in_order() -> None:
    text = "Szukam starego psa. Zrobiłem to."
    blob = assemble(text, [szukam_starego_psa(text), zrobilem_to(text, 20)])
    first, second = blob["sentences"]
    assert (first["start"], first["end"]) == (0, 19)
    assert (second["start"], second["end"]) == (20, 32)
    assert [t["text"] for t in first["tokens"]] == ["Szukam", "starego", "psa", "."]
    assert [t["text"] for t in second["tokens"]] == ["Zrobił", "em", "to", "."]
    for sent in blob["sentences"]:
        for token in sent["tokens"]:
            whole = token.get("mwt", token["text"])
            assert text[token["start"] : token["end"]] == whole
    assert blob["lang"] == "pl"
    assert blob["hash"].startswith("sha256:")


def test_fused_word_parts_get_their_own_candidates() -> None:
    text = "Zrobiłem to."
    expressions: list[ExpressionDef] = [{"id": "pl:zrobić to", "lemmas": ["zrobić", "to"]}]
    (sent,) = assemble(text, [zrobilem_to(text)], expressions)["sentences"]
    zrobil, em = sent["tokens"][:2]
    assert (zrobil["start"], zrobil["end"]) == (em["start"], em["end"]) == (0, 8)
    assert zrobil.get("mwt") == em.get("mwt") == "Zrobiłem"
    assert [r["xpos"] for r in zrobil.get("candidates", [])] == [
        "praet:sg:m1:perf",
        "praet:sg:m2:perf",
        "praet:sg:m3:perf",
    ]
    assert {r["lemma"] for r in zrobil.get("candidates", [])} == {"zrobić"}
    # Morfeusz has one reading for em, so no candidate list, and nothing to snap
    assert "candidates" not in em
    assert "parser" not in em
    assert (em["lemma"], em["lemma_id"], em["upos"]) == ("być", "pl:być:AUX", "AUX")
    # The person ending is a gap, so the expression spans it
    assert sent["expressions"] == [{"from": 0, "to": 2, "id": "pl:zrobić to"}]


def test_a_reading_morfeusz_rules_out_is_snapped_and_the_parsers_kept() -> None:
    # w rękawiczkach, with the parser's invented masculine lemma rękawiczek
    text = "w rękawiczkach"
    masculine: Feats = {"Case": "Loc", "Gender": "Masc", "Animacy": "Inan", "Number": "Plur"}
    parsed = sentence(
        text,
        0,
        [
            (word("w", "w", "ADP", "prep:loc:nwok", {"AdpType": "Prep"}, 1, "case"),),
            (
                word(
                    "rękawiczkach", "rękawiczek", "NOUN", "subst:pl:loc:m3", masculine, None, "root"
                ),
            ),
        ],
    )
    (sent,) = assemble(text, [parsed])["sentences"]
    noun = sent["tokens"][1]
    assert noun["lemma"] == "rękawiczka"
    assert noun["lemma_id"] == "pl:rękawiczka:NOUN"
    assert noun["xpos"] == "subst:pl:loc:f"
    assert noun["feats"] == {"Number": "Plur", "Case": "Loc", "Gender": "Fem"}
    assert noun.get("parser") == {
        "lemma": "rękawiczek",
        "upos": "NOUN",
        "xpos": "subst:pl:loc:m3",
        "feats": masculine,
    }
    assert "candidates" not in noun
    assert noun.get("case_reason") == {"rule": "preposition", "trigger": 0, "governor": "w"}


def test_cases_are_corrected_before_they_are_explained() -> None:
    text = "Szukam starego psa."
    (sent,) = assemble(text, [szukam_starego_psa(text)])["sentences"]
    tokens: list[Token] = sent["tokens"]
    _, starego, psa, _ = tokens
    assert psa["feats"].get("Case") == "Gen"
    assert psa["xpos"] == "subst:sg:gen:m2"
    assert psa.get("case_correction") == {"original": "Acc", "governor": "szukać"}
    assert psa.get("parser", {}).get("feats", {}).get("Case") == "Acc"
    assert psa.get("case_reason") == {"rule": "verb", "trigger": 0, "governor": "szukać"}
    assert starego["feats"].get("Case") == "Gen"
    assert starego["xpos"] == "adj:sg:gen:m2:pos"
    assert starego.get("case_correction") == {"original": "Acc", "governor": "szukać"}
    assert starego.get("case_reason") == {"rule": "agreement", "trigger": 2}


def test_analyzer_matches_analyzer_name() -> None:
    text = "Szukam starego psa."
    blob = assemble(text, [szukam_starego_psa(text)])
    assert blob["analyzer"] == pl.analyzer_name(MODEL, valency=VALENCY)


def test_no_lemma_means_no_lemma_id() -> None:
    # Morfeusz doesn't know xyzzy (ign), so there is nothing to snap to
    text = "xyzzy"
    parsed = sentence(text, 0, [(word("xyzzy", None, "X", None, {}, None, "root"),)])
    (sent,) = assemble(text, [parsed])["sentences"]
    (token,) = sent["tokens"]
    assert token["lemma"] is None
    assert token["lemma_id"] is None


def test_an_empty_sentence_is_skipped() -> None:
    text = "Szukam starego psa."
    blob = assemble(text, [ParsedSentence(()), szukam_starego_psa(text)])
    assert [len(s["tokens"]) for s in blob["sentences"]] == [4]


def test_participle_belongs_to_the_verb_entry() -> None:
    assert (
        pl.entry_upos(
            {"lemma": "położyć", "upos": "ADJ", "xpos": "ppas:sg:nom:m3:perf:aff", "feats": {}}
        )
        == "VERB"
    )
    assert (
        pl.entry_upos({"lemma": "stary", "upos": "ADJ", "xpos": "adj:sg:nom:m3:pos", "feats": {}})
        == "ADJ"
    )
