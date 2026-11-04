from pathlib import Path

import pytest

from skolia_analysis.lexicon import build, bundle, store
from skolia_analysis.lexicon import pl as lexicon_pl
from skolia_analysis.lexicon.kaikki import KaikkiEntry
from skolia_analysis.lexicon.schema import Form, Paradigm, Sense
from skolia_analysis.schema import Blob, Feats, Token, Upos
from skolia_analysis.walenty.parse import parse_schema

DOG: Sense = {"gloss": "dog", "tags": [], "when": [{"Gender": "Masc", "Animacy": "Nhum"}]}
COP: Sense = {"gloss": "cop", "tags": [], "when": [{"Gender": "Masc", "Animacy": "Hum"}]}


@pytest.fixture(scope="module")
def converter() -> lexicon_pl.Converter:
    return lexicon_pl.Converter()


def test_gender_codes_become_features() -> None:
    entry: KaikkiEntry = {"head_templates": [{"name": "pl-noun", "args": {"1": "m-anml,m-pr"}}]}
    assert lexicon_pl._gender(entry) == [  # pyright: ignore[reportPrivateUsage]
        {"Gender": "Masc", "Animacy": "Nhum"},
        {"Gender": "Masc", "Animacy": "Hum"},
    ]


def test_inflected_form_pointer_is_skipped_derivation_kept(
    converter: lexicon_pl.Converter,
) -> None:
    inflected: KaikkiEntry = {
        "word": "kun",
        "pos": "noun",
        "senses": [
            {
                "glosses": ["genitive plural of kuna"],
                "tags": ["form-of", "genitive", "plural"],
                "form_of": [{"word": "kuna"}],
            }
        ],
    }
    assert converter(inflected) is None
    diminutive: KaikkiEntry = {
        "word": "rubelek",
        "pos": "noun",
        "senses": [
            {
                "glosses": ["diminutive of rubel"],
                "tags": ["diminutive", "form-of"],
                "form_of": [{"word": "rubel"}],
            }
        ],
    }
    converted = converter(diminutive)
    assert converted is not None
    assert converted.relations == [{"type": "derived-from", "lemma": "rubel", "note": "diminutive"}]


def test_reflexive_headword_files_under_the_bare_verb(converter: lexicon_pl.Converter) -> None:
    entry: KaikkiEntry = {"word": "bać się", "pos": "verb", "senses": [{"glosses": ["to fear"]}]}
    converted = converter(entry)
    assert converted is not None
    assert (converted.lemma, converted.upos) == ("bać", ("VERB",))
    assert converted.senses[0]["tags"] == ["się"]


def test_upos_follows_the_analyser(converter: lexicon_pl.Converter) -> None:
    entry: KaikkiEntry = {"word": "który", "pos": "pron", "senses": [{"glosses": ["which"]}]}
    converted = converter(entry)
    assert converted is not None
    assert converted.upos == ("DET",)


def test_aspect_partner() -> None:
    entry: KaikkiEntry = {
        "pos": "verb",
        "forms": [
            {"form": "zrobić", "tags": ["perfective"]},
            {"form": "robię", "tags": ["first-person"]},
        ],
    }
    partners = list(lexicon_pl._aspect_partners(entry, "robić"))  # pyright: ignore[reportPrivateUsage]
    assert partners == [{"type": "aspect-partner", "lemma": "zrobić", "note": "perfective"}]


def test_merge_keeps_selectors_only_when_they_differ() -> None:
    entries = [
        lexicon_pl.Converted("pies", ("NOUN",), [DOG.copy()]),
        lexicon_pl.Converted("pies", ("NOUN",), [COP.copy()]),
        lexicon_pl.Converted(
            "pani", ("NOUN",), [{"gloss": "lady", "tags": [], "when": [{"Gender": "Fem"}]}]
        ),
    ]
    merged = build.merge(entries)
    assert [s.get("when") for s in merged["pies", "NOUN"].senses] == [
        DOG.get("when"),
        COP.get("when"),
    ]
    assert "when" not in merged["pani", "NOUN"].senses[0]


def test_paradigm_is_split_by_homonym(converter: lexicon_pl.Converter) -> None:
    paradigms = converter.paradigms("pies", "NOUN")
    assert len(paradigms) > 1
    genitives = [
        f["form"] for p in paradigms for f in p["forms"] if f["feats"].get("Case") == "Gen"
    ]
    assert "psa" in genitives


def test_verb_paradigm_includes_participles(converter: lexicon_pl.Converter) -> None:
    forms = [f for p in converter.paradigms("położyć", "VERB") for f in p["forms"]]
    assert any(f["form"] == "położony" and f["xpos"].startswith("ppas") for f in forms)


def test_parse_lemma_id_with_separator_in_lemma() -> None:
    assert bundle.parse_lemma_id("pl:a:b:NOUN") == ("pl", "a:b", "NOUN")


def test_resolve_falls_back(tmp_path: Path) -> None:
    path = tmp_path / "pl.sqlite"
    rows = [
        store.Row("pl:by:PART", "by", "PART", [{"gloss": "would", "tags": []}], []),
        store.Row("pl:krakowski:ADJ", "krakowski", "ADJ", [{"gloss": "of Kraków", "tags": []}], []),
    ]
    store.write(path, rows, {})
    lexicon = store.Lexicon(path)
    assert bundle.resolve(lexicon, "pl:by:PART")[1] == "exact"
    assert bundle.resolve(lexicon, "pl:by:AUX")[1] == "other-pos"
    found, match = bundle.resolve(lexicon, "pl:Krakowski:ADJ")
    assert (found and found.lemma_id, match) == ("pl:krakowski:ADJ", "lowercase")
    assert bundle.resolve(lexicon, "pl:xyzzy:NOUN") == (None, "none")


def test_bundle_shares_feature_sets_and_groups_forms(tmp_path: Path) -> None:
    path = tmp_path / "pl.sqlite"
    store.write(path, [store.Row("pl:pies:NOUN", "pies", "NOUN", [DOG], [])], {})
    gen: Feats = {"Case": "Gen", "Number": "Sing"}
    acc: Feats = {"Case": "Acc", "Number": "Sing"}

    def paradigms(_lemma: str, _upos: Upos) -> list[Paradigm]:
        forms: list[Form] = [
            {"form": "psa", "xpos": "subst:sg:gen:m2", "feats": gen},
            {"form": "psa", "xpos": "subst:sg:acc:m2", "feats": acc},
            {"form": "psu", "xpos": "subst:sg:dat:m2", "feats": {"Case": "Dat"}},
        ]
        return [{"homonym": "Sm2", "forms": forms}]

    token: Token = {
        "start": 0,
        "end": 3,
        "text": "psa",
        "lemma": "pies",
        "lemma_id": "pl:pies:NOUN",
        "upos": "NOUN",
        "xpos": None,
        "feats": gen,
        "head": None,
        "deprel": "root",
    }
    blob: Blob = {
        "schema": 2,
        "analyzer": "test",
        "lang": "pl",
        "hash": "",
        "sentences": [{"start": 0, "end": 3, "tokens": [token], "expressions": []}],
    }
    result = bundle.make(blob, store.Lexicon(path), paradigms)
    forms = result["entries"]["pl:pies:NOUN"]["paradigms"][0]["forms"]
    assert [(f, [result["feats"][i] for i in ids]) for f, ids in forms] == [
        ("psa", [gen, acc]),
        ("psu", [{"Case": "Dat"}]),
    ]
    assert result["match"] == {"pl:pies:NOUN": "exact"}
    assert result["entries"]["pl:pies:NOUN"]["frames"] == []

    strach = parse_schema("pies: pewny: : : : {np(gen)}", "noun")
    with_frames = bundle.make(
        blob,
        store.Lexicon(path),
        paradigms,
        lambda lemma, upos: [strach] if (lemma, upos) == ("pies", "NOUN") else [],
    )
    assert with_frames["entries"]["pl:pies:NOUN"]["frames"] == [strach]
