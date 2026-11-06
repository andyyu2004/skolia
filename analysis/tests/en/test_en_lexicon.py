from skolia_analysis.lang.en import lexicon as lexicon_en
from skolia_analysis.lexicon.kaikki import KaikkiEntry, KaikkiForm
from skolia_analysis.schema import Feats

GO: list[KaikkiForm] = [
    {"form": "goes", "tags": ["present", "singular", "third-person"]},
    {"form": "going", "tags": ["participle", "present"]},
    {"form": "went", "tags": ["past"]},
    {"form": "gone", "tags": ["participle", "past"]},
    {"form": "goeth", "tags": ["archaic", "present", "singular", "third-person"]},
    {"form": "en-verb", "tags": ["inflection-template"]},
]


def forms_of(forms: list[KaikkiForm], word: str, text: str) -> list[Feats]:
    return [f["feats"] for f in lexicon_en.paradigm_forms(word, "VERB", forms) if f["form"] == text]


def test_regular_verb_forms_serve_every_person_they_can() -> None:
    goes = forms_of(GO, "go", "goes")
    assert goes == [
        {"Mood": "Ind", "Number": "Sing", "Person": "3", "Tense": "Pres", "VerbForm": "Fin"}
    ]
    went = forms_of(GO, "go", "went")
    assert len(went) == 6 and all(f.get("Tense") == "Past" for f in went)
    go = forms_of(GO, "go", "go")
    assert {"VerbForm": "Inf"} in go and {"Mood": "Imp", "VerbForm": "Fin"} in go
    present = [(f.get("Person"), f.get("Number")) for f in go if f.get("Tense") == "Pres"]
    assert ("3", "Sing") not in present and len(present) == 5
    assert {"VerbForm": "Ger"} in forms_of(GO, "go", "going")
    assert forms_of(GO, "go", "goeth") == []


def test_forms_from_the_headword_and_the_table_are_listed_once() -> None:
    table: list[KaikkiForm] = [
        {"form": "went", "tags": ["first-person", "past", "singular"]},
        {"form": "goes", "tags": ["present", "singular", "third-person"]},
    ]
    assert len(forms_of(GO + table, "go", "went")) == 6
    assert len(forms_of(GO + table, "go", "goes")) == 1


def test_be_takes_its_persons_from_the_table() -> None:
    be: list[KaikkiForm] = [
        {"form": "am", "tags": ["first-person", "present", "singular"]},
        {"form": "are", "tags": ["present", "second-person", "singular"]},
        {"form": "art", "tags": ["present", "second-person", "singular"]},
        {"form": "is", "tags": ["present", "singular", "third-person"]},
        {"form": "are", "tags": ["plural", "present"]},
        {"form": "was", "tags": ["first-person", "past", "singular"]},
        {"form": "was", "tags": ["past", "singular", "third-person"]},
        {"form": "were", "tags": ["past", "plural"]},
        {"form": "were", "tags": ["past", "subjunctive"]},
    ]
    persons = {
        (f["form"], f["feats"].get("Person"), f["feats"].get("Number"))
        for f in lexicon_en.paradigm_forms("be", "VERB", be)
        if f["feats"].get("Tense") == "Pres"
    }
    assert ("am", "1", "Sing") in persons and ("is", "3", "Sing") in persons
    assert not any(form == "art" for form, _, _ in persons)
    # be itself is only the infinitive, imperative and subjunctive, not "I be"
    assert not any(form == "be" for form, _, _ in persons)
    were = forms_of(be, "be", "were")
    assert {
        "Mood": "Sub",
        "Number": "Sing",
        "Person": "1",
        "Tense": "Past",
        "VerbForm": "Fin",
    } in were


def test_noun_and_adjective_forms() -> None:
    dogs = lexicon_en.paradigm_forms("dog", "NOUN", [{"form": "dogs", "tags": ["plural"]}])
    assert [(f["form"], f["feats"]) for f in dogs] == [
        ("dog", {"Number": "Sing"}),
        ("dogs", {"Number": "Plur"}),
    ]
    big: list[KaikkiForm] = [
        {"form": "bigger", "tags": ["comparative"]},
        {"form": "more big", "tags": ["comparative"]},
        {"form": "biggest", "tags": ["superlative"]},
    ]
    assert [f["form"] for f in lexicon_en.paradigm_forms("big", "ADJ", big)] == [
        "big",
        "bigger",
        "biggest",
    ]


def test_possessive_suffix_is_the_particle() -> None:
    possessive: KaikkiEntry = {
        "word": "-'s",
        "pos": "suffix",
        "senses": [{"glosses": ["A possessive marker"], "tags": ["enclitic", "morpheme"]}],
    }
    converted = lexicon_en.Source().convert(possessive)
    assert converted is not None
    assert (converted.lemma, converted.upos) == ("'s", ("PART",))


def test_inflected_form_entry_is_skipped() -> None:
    went: KaikkiEntry = {
        "word": "went",
        "pos": "verb",
        "senses": [
            {
                "glosses": ["simple past of go"],
                "tags": ["form-of", "past"],
                "form_of": [{"word": "go"}],
            }
        ],
    }
    assert lexicon_en.Source().convert(went) is None
    dog: KaikkiEntry = {
        "word": "dog",
        "pos": "noun",
        "senses": [{"glosses": ["A mammal, Canis familiaris"]}],
        "forms": [{"form": "dogs", "tags": ["plural"]}],
        "etymology_number": 1,
    }
    converted = lexicon_en.Source().convert(dog)
    assert converted is not None
    assert converted.upos == ("NOUN",)
    assert converted.paradigms[0]["homonym"] == "1"
