-- Each entry's lemma pronunciations and paradigms, from analysis's {lang}.cards.sqlite
-- (skolia-build-cards), for review cards.
--   pronunciations: [{"ipa": "/ˈpjɛs/"}]
--   paradigms: [{"homonym": "Sm2", "forms": [["pies", [49]], ["psa", [50, 51]], ...]}]
-- Each form is written once with the feature sets it has: psa is sets 50 and 51 of its
-- language and version, genitive and accusative singular.
ALTER TABLE entry ADD COLUMN pronunciations TEXT NOT NULL DEFAULT '[]';
ALTER TABLE entry ADD COLUMN paradigms TEXT NOT NULL DEFAULT '[]';

-- The feature sets paradigms point into, one row per UD feature: set 50 is
-- (50, Case, Gen), (50, Gender, Masc), (50, Number, Sing), ... A set's id only means
-- something within its language and version. Features differ by language (Polish has
-- Variant and Number[psor], English neither), so they're rows, not columns.
CREATE TABLE featureset (
  lang TEXT NOT NULL,
  version TEXT NOT NULL,
  id INTEGER NOT NULL,
  feature TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (lang, version, id, feature)
) STRICT, WITHOUT ROWID;
