-- One language's lexicon, from analysis's {lang}.cards.sqlite (skolia-build-cards), which
-- infra/load-lexicon.py loads into that language's database (LEXICON_{LANG}). A new
-- version's rows go in beside the old ones, loaded then points at it, and the old rows
-- are deleted, so a lookup never sees half a load.
--   pronunciations: [{"ipa": "/ˈpjɛs/"}]
--   paradigms: [{"homonym": "Sm2", "forms": [["pies", [49]], ["psa", [50, 51]], ...]}]
-- Each form is written once with the feature sets it has: psa is sets 50 and 51 of its
-- version, genitive and accusative singular.
CREATE TABLE entry (
  lemma_id TEXT NOT NULL,
  version TEXT NOT NULL,
  lemma TEXT NOT NULL,
  upos TEXT NOT NULL,
  senses TEXT NOT NULL,
  relations TEXT NOT NULL,
  pronunciations TEXT NOT NULL,
  paradigms TEXT NOT NULL,
  PRIMARY KEY (lemma_id, version)
) STRICT, WITHOUT ROWID;

-- The feature sets paradigms point into, one row per UD feature: set 50 is
-- (50, Case, Gen), (50, Gender, Masc), (50, Number, Sing), ... A set's id only means
-- something within its version. Features differ by language (Polish has Variant and
-- Number[psor], English neither), so they're rows, not columns.
CREATE TABLE featureset (
  version TEXT NOT NULL,
  id INTEGER NOT NULL,
  feature TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (version, id, feature)
) STRICT, WITHOUT ROWID;

-- The version served: its SQLite's meta version. One row once a version is loaded.
CREATE TABLE loaded (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL
) STRICT;
