-- The lexicon without paradigms, from analysis's {lang}.sqlite, which
-- infra/load-lexicon.py loads. A new version's rows go in beside the old ones, loaded
-- then points at it, and the old rows are deleted, so a lookup never sees half a load.
CREATE TABLE entry (
  lemma_id TEXT NOT NULL,
  version TEXT NOT NULL,
  lang TEXT NOT NULL,
  lemma TEXT NOT NULL,
  upos TEXT NOT NULL,
  senses TEXT NOT NULL,
  relations TEXT NOT NULL,
  PRIMARY KEY (lemma_id, version)
) STRICT, WITHOUT ROWID;

-- The version each language serves: its SQLite's meta version
CREATE TABLE loaded (
  lang TEXT NOT NULL PRIMARY KEY,
  version TEXT NOT NULL
) STRICT, WITHOUT ROWID;
