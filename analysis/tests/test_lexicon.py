from pathlib import Path

from skolia_analysis.lang.pl.walenty.parse import parse_schema
from skolia_analysis.lexicon import build, bundle, pronunciation, store
from skolia_analysis.lexicon.schema import Form, Paradigm, Pronunciation, Sense
from skolia_analysis.lexicon.source import Converted
from skolia_analysis.schema import Blob, Feats, Token, Upos

DOG: Sense = {"gloss": "dog", "tags": [], "when": [{"Gender": "Masc", "Animacy": "Nhum"}]}
COP: Sense = {"gloss": "cop", "tags": [], "when": [{"Gender": "Masc", "Animacy": "Hum"}]}


def test_merge_keeps_selectors_only_when_they_differ() -> None:
    entries = [
        Converted("pies", ("NOUN",), [DOG.copy()]),
        Converted("pies", ("NOUN",), [COP.copy()]),
        Converted("pani", ("NOUN",), [{"gloss": "lady", "tags": [], "when": [{"Gender": "Fem"}]}]),
    ]
    merged = build.merge(entries)
    assert [s.get("when") for s in merged["pies", "NOUN"].senses] == [
        DOG.get("when"),
        COP.get("when"),
    ]
    assert "when" not in merged["pani", "NOUN"].senses[0]


def test_parse_lemma_id_with_separator_in_lemma() -> None:
    assert bundle.parse_lemma_id("pl:a:b:NOUN") == ("pl", "a:b", "NOUN")


def test_resolve_falls_back(tmp_path: Path) -> None:
    path = tmp_path / "pl.sqlite"
    rows = [
        store.Row("pl:by:PART", "by", "PART", [{"gloss": "would", "tags": []}], [], []),
        store.Row(
            "pl:krakowski:ADJ", "krakowski", "ADJ", [{"gloss": "of Kraków", "tags": []}], [], []
        ),
        # the same spelling as a name: the adjective lowercased wins over it
        store.Row(
            "pl:Krakowski:PROPN", "Krakowski", "PROPN", [{"gloss": "a surname", "tags": []}], [], []
        ),
    ]
    store.write(path, rows, {})
    lexicon = store.Lexicon(path)
    assert bundle.resolve(lexicon, "pl:by:PART")[1] == "exact"
    assert bundle.resolve(lexicon, "pl:by:AUX")[1] == "other-pos"
    found, match = bundle.resolve(lexicon, "pl:Krakowski:ADJ")
    assert (found and found.lemma_id, match) == ("pl:krakowski:ADJ", "lowercase")
    assert bundle.resolve(lexicon, "pl:xyzzy:NOUN") == (None, "none")


def test_resolve_prefers_the_closest_part_of_speech(tmp_path: Path) -> None:
    path = tmp_path / "en.sqlite"
    senses: list[Sense] = [{"gloss": f"sense {i}", "tags": []} for i in range(3)]
    rows = [
        store.Row("en:must:NOUN", "must", "NOUN", senses, [], []),
        store.Row("en:must:VERB", "must", "VERB", senses[:1], [], []),
    ]
    store.write(path, rows, {})
    found, match = bundle.resolve(store.Lexicon(path), "en:must:AUX")
    assert (found and found.lemma_id, match) == ("en:must:VERB", "other-pos")


def test_bundle_shares_feature_sets_and_groups_forms(tmp_path: Path) -> None:
    path = tmp_path / "pl.sqlite"
    store.write(
        path, [store.Row("pl:pies:NOUN", "pies", "NOUN", [DOG], [], [])], {"version": "test/1"}
    )
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


def test_bundle_pronounces_tokens_and_lemmas(tmp_path: Path) -> None:
    path = tmp_path / "en.sqlite"
    said = [
        store.PronunciationRow("lead", "NOUN", [{"ipa": "/lɛd/"}]),
        store.PronunciationRow("lead", "VERB", [{"ipa": "/liːd/"}]),
        store.PronunciationRow("led", "VERB", [{"ipa": "/lɛd/"}]),
        store.PronunciationRow("be", "VERB", [{"ipa": "/biː/"}]),
    ]
    store.write(path, [], {"version": "test/1"}, lambda: said)
    lexicon = store.Lexicon(path)
    assert bundle.pronounce(lexicon, "Lead", "NOUN") == [{"ipa": "/lɛd/"}]
    assert bundle.pronounce(lexicon, "lead", "VERB") == [{"ipa": "/liːd/"}]
    assert bundle.pronounce(lexicon, "be", "AUX") == [{"ipa": "/biː/"}]
    assert bundle.pronounce(lexicon, "xyzzy", "NOUN") == []

    token: Token = {
        "start": 0,
        "end": 3,
        "text": "led",
        "lemma": "lead",
        "lemma_id": "en:lead:VERB",
        "upos": "VERB",
        "xpos": None,
        "feats": {},
        "head": None,
        "deprel": "root",
    }
    blob: Blob = {
        "schema": 2,
        "analyzer": "test",
        "lang": "en",
        "hash": "",
        "sentences": [{"start": 0, "end": 3, "tokens": [token], "expressions": []}],
    }
    assert bundle.make(blob, lexicon)["pronunciations"] == {
        "led:VERB": [{"ipa": "/lɛd/"}],
        "lead:VERB": [{"ipa": "/liːd/"}],
    }


def test_pronunciations_merge_accents() -> None:
    uk: Pronunciation = {"ipa": "/ɹiːd/", "accents": ["UK"]}
    us: Pronunciation = {"ipa": "/ɹiːd/", "accents": ["US"]}
    assert pronunciation.merge([uk], [us, {"ipa": "/ɹɛd/"}]) == [
        {"ipa": "/ɹiːd/", "accents": ["UK", "US"]},
        {"ipa": "/ɹɛd/"},
    ]
    assert pronunciation.merge([uk], [{"ipa": "/ɹiːd/"}]) == [{"ipa": "/ɹiːd/"}]
