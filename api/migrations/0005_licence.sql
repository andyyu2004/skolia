-- A text's licence, author and source, as its uploader claims them. licensor: the user who
-- claimed the licence, the importer or whoever made the text public. Texts from before have
-- no licence, so they're private until someone gives one.
ALTER TABLE document RENAME TO old_document;

CREATE TABLE document (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  lang TEXT NOT NULL,
  imported TEXT NOT NULL CHECK (imported IS strftime('%Y-%m-%dT%H:%M:%fZ', imported)),
  words INTEGER NOT NULL,
  importer TEXT NOT NULL REFERENCES "user" ("id"),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  licence TEXT NOT NULL CHECK (licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd', 'all-rights-reserved', 'unknown')),
  author TEXT,
  source TEXT CHECK (source GLOB 'http://?*' OR source GLOB 'https://?*'),
  licensor TEXT NOT NULL REFERENCES "user" ("id"),
  CHECK (visibility = 'private' OR licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd'))
) STRICT;

INSERT INTO document (id, title, lang, imported, words, importer, visibility, licence, author, source, licensor)
SELECT id, title, lang, imported, words, importer, 'private', 'unknown', NULL, NULL, importer
FROM old_document;

DROP TABLE old_document;
