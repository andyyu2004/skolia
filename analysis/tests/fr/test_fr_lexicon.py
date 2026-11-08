from skolia_analysis.lang.fr import lexicon as lexicon_fr
from skolia_analysis.lexicon.kaikki import KaikkiEntry, KaikkiForm
from skolia_analysis.schema import Feats, Mood, Number, Person, Tense

# prendre's table as Kaikki gives it, cut down to one form of each kind
PRENDRE: list[KaikkiForm] = [
    {"form": "no-table-tags", "tags": ["table-tags"]},
    {"form": "fr-conj-auto", "tags": ["inflection-template"]},
    {"form": "prendre", "tags": ["infinitive"]},
    {"form": "avoir + past participle", "tags": ["infinitive", "multiword-construction"]},
    {"form": "prenant", "tags": ["gerund", "participle", "present"]},
    {"form": "pris", "tags": ["participle", "past"]},
    {"form": "prends", "tags": ["first-person", "indicative", "present", "singular"]},
    {"form": "prends", "tags": ["indicative", "present", "second-person", "singular"]},
    {"form": "prenais", "tags": ["first-person", "imperfect", "indicative", "singular"]},
    {"form": "prit", "tags": ["historic", "indicative", "past", "singular", "third-person"]},
    {"form": "prendrons", "tags": ["first-person", "future", "indicative", "plural"]},
    {"form": "prendraient", "tags": ["conditional", "plural", "third-person"]},
    {"form": "prenne", "tags": ["first-person", "present", "singular", "subjunctive"]},
    {"form": "prissions", "tags": ["first-person", "imperfect", "plural", "subjunctive"]},
    {"form": "prenez", "tags": ["imperative", "plural", "second-person"]},
]


def forms_of(forms: list[KaikkiForm], word: str, text: str) -> list[Feats]:
    return [f["feats"] for f in lexicon_fr.paradigm_forms(word, "VERB", forms) if f["form"] == text]


def fin(mood: Mood, tense: Tense, person: Person, number: Number) -> Feats:
    """A finite form's features."""
    return {"Mood": mood, "Number": number, "Person": person, "Tense": tense, "VerbForm": "Fin"}


def test_finite_forms_get_gsd_mood_and_tense() -> None:
    assert forms_of(PRENDRE, "prendre", "prends") == [
        fin("Ind", "Pres", "1", "Sing"),
        fin("Ind", "Pres", "2", "Sing"),
    ]
    assert forms_of(PRENDRE, "prendre", "prenais") == [fin("Ind", "Imp", "1", "Sing")]
    assert forms_of(PRENDRE, "prendre", "prit") == [fin("Ind", "Past", "3", "Sing")]
    assert forms_of(PRENDRE, "prendre", "prendrons") == [fin("Ind", "Fut", "1", "Plur")]
    assert forms_of(PRENDRE, "prendre", "prendraient") == [fin("Cnd", "Pres", "3", "Plur")]
    assert forms_of(PRENDRE, "prendre", "prenne") == [fin("Sub", "Pres", "1", "Sing")]
    assert forms_of(PRENDRE, "prendre", "prissions") == [fin("Sub", "Imp", "1", "Plur")]
    assert forms_of(PRENDRE, "prendre", "prenez") == [fin("Imp", "Pres", "2", "Plur")]


def test_infinitive_and_participles() -> None:
    assert forms_of(PRENDRE, "prendre", "prendre") == [{"VerbForm": "Inf"}]
    assert forms_of(PRENDRE, "prendre", "prenant") == [
        {"VerbForm": "Part"},
        {"Tense": "Pres", "VerbForm": "Part"},
    ]
    # pris ends in s, so it is also the masculine plural
    assert forms_of(PRENDRE, "prendre", "pris") == [
        {"Gender": "Masc", "Number": "Sing", "VerbForm": "Part"},
        {"Gender": "Masc", "Number": "Plur", "VerbForm": "Part"},
    ]
    assert forms_of(PRENDRE, "prendre", "prises") == [
        {"Gender": "Fem", "Number": "Plur", "VerbForm": "Part"}
    ]
    assert not any("+" in f["form"] for f in lexicon_fr.paradigm_forms("prendre", "VERB", PRENDRE))


def test_past_participle_agreement() -> None:
    def participles(masculine: str) -> list[str]:
        return [f["form"] for f in lexicon_fr._past_participles(masculine)]  # pyright: ignore[reportPrivateUsage]

    assert participles("mangé") == ["mangé", "mangée", "mangés", "mangées"]
    assert participles("dû") == ["dû", "due", "dus", "dues"]
    assert participles("dissous") == ["dissous", "dissoute", "dissous", "dissoutes"]
    assert participles("été") == ["été"]


def test_noun_number() -> None:
    forms: list[KaikkiForm] = [
        {"form": "maisons", "tags": ["plural"]},
        {"form": "maisonne", "tags": ["alternative"]},
    ]
    assert [
        (f["form"], f["feats"]) for f in lexicon_fr.paradigm_forms("maison", "NOUN", forms)
    ] == [
        ("maison", {"Number": "Sing"}),
        ("maisons", {"Number": "Plur"}),
    ]


def test_adjective_gender_and_number() -> None:
    beau: list[KaikkiForm] = [
        {"form": "bel", "tags": ["before-vowel", "masculine", "singular"]},
        {"form": "belle", "tags": ["feminine"]},
        {"form": "beaux", "tags": ["masculine", "plural"]},
        {"form": "belles", "tags": ["feminine", "plural"]},
    ]
    table = {
        (f["form"], f["feats"].get("Gender"), f["feats"].get("Number"))
        for f in lexicon_fr.paradigm_forms("beau", "ADJ", beau)
    }
    assert table == {
        ("beau", "Masc", "Sing"),
        ("bel", "Masc", "Sing"),
        ("belle", "Fem", "Sing"),
        ("beaux", "Masc", "Plur"),
        ("belles", "Fem", "Plur"),
    }
    # One form for both genders when Wiktionary gives no feminine
    rapide = {
        (f["form"], f["feats"].get("Gender"), f["feats"].get("Number"))
        for f in lexicon_fr.paradigm_forms(
            "rapide", "ADJ", [{"form": "rapides", "tags": ["plural"]}]
        )
    }
    assert rapide == {
        ("rapide", "Masc", "Sing"),
        ("rapide", "Fem", "Sing"),
        ("rapides", "Masc", "Plur"),
        ("rapides", "Fem", "Plur"),
    }


def test_pronominal_verb_is_filed_under_the_verb() -> None:
    entry: KaikkiEntry = {
        "word": "s'asseoir",
        "pos": "verb",
        "senses": [{"glosses": ["to sit down"]}],
        "forms": [
            {"form": "m'assieds", "tags": ["first-person", "indicative", "present", "singular"]}
        ],
    }
    converted = lexicon_fr.Source().convert(entry)
    assert converted is not None
    assert converted.lemma == "asseoir"
    assert converted.senses[0]["tags"] == ["pronominal"]
    assert converted.paradigms == []


def test_a_noun_sense_with_one_gender_is_selected_by_it() -> None:
    livre: KaikkiEntry = {
        "word": "livre",
        "pos": "noun",
        "senses": [
            {"glosses": ["book"], "tags": ["masculine"]},
            {"glosses": ["pound"], "tags": ["feminine"]},
        ],
        "forms": [{"form": "livres", "tags": ["plural"]}],
    }
    converted = lexicon_fr.Source().convert(livre)
    assert converted is not None
    assert [s.get("when") for s in converted.senses] == [[{"Gender": "Masc"}], [{"Gender": "Fem"}]]


def test_quebec_pronunciation_is_left_out() -> None:
    chien: KaikkiEntry = {
        "word": "chien",
        "pos": "noun",
        "sounds": [
            {"ipa": "/ʃjɛ̃/", "tags": ["Belgium", "France"]},
            {"ipa": "/ʃjẽ/", "tags": ["Quebec"]},
        ],
    }
    pronounced = lexicon_fr.Source().pronounce(chien)
    assert pronounced is not None
    assert pronounced.pronunciations == [{"ipa": "/ʃjɛ̃/"}]
