import pytest

from skolia_analysis.lang.pl import lexicon as lexicon_pl
from skolia_analysis.lexicon.kaikki import KaikkiEntry


@pytest.fixture(scope="module")
def source() -> lexicon_pl.Source:
    return lexicon_pl.Source()


@pytest.fixture(scope="module")
def paradigms() -> lexicon_pl.Paradigms:
    return lexicon_pl.Paradigms()


def test_gender_codes_become_features() -> None:
    entry: KaikkiEntry = {"head_templates": [{"name": "pl-noun", "args": {"1": "m-anml,m-pr"}}]}
    assert lexicon_pl._gender(entry) == [  # pyright: ignore[reportPrivateUsage]
        {"Gender": "Masc", "Animacy": "Nhum"},
        {"Gender": "Masc", "Animacy": "Hum"},
    ]


def test_inflected_form_pointer_is_skipped_derivation_kept(
    source: lexicon_pl.Source,
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
    assert source.convert(inflected) is None
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
    converted = source.convert(diminutive)
    assert converted is not None
    assert converted.relations == [{"type": "derived-from", "lemma": "rubel", "note": "diminutive"}]


def test_reflexive_headword_files_under_the_bare_verb(source: lexicon_pl.Source) -> None:
    entry: KaikkiEntry = {"word": "bać się", "pos": "verb", "senses": [{"glosses": ["to fear"]}]}
    converted = source.convert(entry)
    assert converted is not None
    assert (converted.lemma, converted.upos) == ("bać", ("VERB",))
    assert converted.senses[0]["tags"] == ["się"]


def test_upos_follows_the_analyser(source: lexicon_pl.Source) -> None:
    entry: KaikkiEntry = {"word": "który", "pos": "pron", "senses": [{"glosses": ["which"]}]}
    converted = source.convert(entry)
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


def test_paradigm_is_split_by_homonym(paradigms: lexicon_pl.Paradigms) -> None:
    found = paradigms("pies", "NOUN")
    assert len(found) > 1
    genitives = [f["form"] for p in found for f in p["forms"] if f["feats"].get("Case") == "Gen"]
    assert "psa" in genitives


def test_verb_paradigm_includes_participles(paradigms: lexicon_pl.Paradigms) -> None:
    forms = [f for p in paradigms("położyć", "VERB") for f in p["forms"]]
    assert any(f["form"] == "położony" and f["xpos"].startswith("ppas") for f in forms)
