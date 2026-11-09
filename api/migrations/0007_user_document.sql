-- A text is stored once however many users import it (document_content), and each user who
-- imports it has their own entry (user_document) with their title, licence and visibility.
-- added_by: the user who first imported it, whose import the daily cap counts.
CREATE TABLE document_content (
  id TEXT NOT NULL PRIMARY KEY,
  lang TEXT NOT NULL,
  words INTEGER NOT NULL,
  added TEXT NOT NULL CHECK (added IS strftime('%Y-%m-%dT%H:%M:%fZ', added)),
  added_by TEXT NOT NULL REFERENCES "user" ("id")
) STRICT, WITHOUT ROWID;

CREATE INDEX document_content_added_idx ON document_content (added);

-- private: seen only by its user. A text is seen by anyone once one entry for it is public.
CREATE TABLE user_document (
  user_id TEXT NOT NULL REFERENCES "user" ("id"),
  document_id TEXT NOT NULL REFERENCES document_content (id),
  title TEXT NOT NULL,
  imported TEXT NOT NULL CHECK (imported IS strftime('%Y-%m-%dT%H:%M:%fZ', imported)),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  licence TEXT NOT NULL CHECK (licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd', 'all-rights-reserved', 'unknown')),
  author TEXT,
  source TEXT CHECK (source GLOB 'http://?*' OR source GLOB 'https://?*'),
  PRIMARY KEY (user_id, document_id),
  CHECK (visibility = 'private' OR licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd'))
) STRICT, WITHOUT ROWID;

CREATE INDEX user_document_user_imported_idx ON user_document (user_id, imported DESC);
CREATE INDEX user_document_public_imported_idx ON user_document (imported DESC) WHERE visibility = 'public';
CREATE INDEX user_document_document_idx ON user_document (document_id);

INSERT INTO document_content (id, lang, words, added, added_by)
SELECT id, lang, words, imported, importer FROM document;

INSERT INTO user_document (user_id, document_id, title, imported, visibility, licence, author, source)
SELECT importer, id, title, imported, visibility, licence, author, source FROM document;

DROP TABLE document;
