-- A text is stored once however many users import it (document), and each user who imports
-- it has their own entry (user_document) with their title, licence and visibility. A text
-- is never deleted, only its entries.
ALTER TABLE document RENAME TO document_0006;

CREATE TABLE document (
  id TEXT NOT NULL PRIMARY KEY,
  lang TEXT NOT NULL,
  words INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- private: seen only by its user. A text is seen by anyone once one entry for it is public.
CREATE TABLE user_document (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES document (id),
  title TEXT NOT NULL,
  imported_at TEXT NOT NULL CHECK (imported_at IS strftime('%Y-%m-%dT%H:%M:%fZ', imported_at)),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  licence TEXT NOT NULL CHECK (licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd', 'all-rights-reserved', 'unknown')),
  author TEXT,
  source TEXT CHECK (source GLOB 'http://?*' OR source GLOB 'https://?*'),
  PRIMARY KEY (user_id, document_id),
  CHECK (visibility = 'private' OR licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd'))
) STRICT, WITHOUT ROWID;

CREATE INDEX user_document_user_imported_idx ON user_document (user_id, imported_at DESC);
CREATE INDEX user_document_public_imported_idx ON user_document (imported_at DESC) WHERE visibility = 'public';
CREATE INDEX user_document_document_idx ON user_document (document_id);

INSERT INTO document (id, lang, words)
SELECT id, lang, words FROM document_0006;

INSERT INTO user_document (user_id, document_id, title, imported_at, visibility, licence, author, source)
SELECT importer, id, title, imported, visibility, licence, author, source FROM document_0006;

DROP TABLE document_0006;
