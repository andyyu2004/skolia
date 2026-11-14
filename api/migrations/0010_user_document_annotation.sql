-- Something an entry's user attached to a range of its text, seen wherever the entry is: a
-- recording of a paragraph, say. start and end are UTF-16 offsets into the text, as
-- JavaScript counts them; a document's text never changes, so they never go stale. kind
-- names what data holds: the API checks data against that kind's schema
-- (shared/annotations.ts), and the reader skips a kind it doesn't know. An annotation has
-- its own credit, since a recording's narrator and licence aren't the text's. id is a hash
-- of what the annotation says, so the same one added twice is one row and a changed one is new.
CREATE TABLE user_document_annotation (
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  id TEXT NOT NULL,
  start INTEGER NOT NULL CHECK (start >= 0),
  "end" INTEGER NOT NULL CHECK ("end" > start),
  kind TEXT NOT NULL CHECK (kind GLOB '[a-z]*' AND kind NOT GLOB '*[^a-z0-9-]*' AND length(kind) <= 32),
  data TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
  licence TEXT NOT NULL CHECK (licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd')),
  author TEXT,
  source TEXT CHECK (source GLOB 'http://?*' OR source GLOB 'https://?*'),
  added_at TEXT NOT NULL CHECK (added_at IS strftime('%Y-%m-%dT%H:%M:%fZ', added_at)),
  PRIMARY KEY (user_id, document_id, id),
  FOREIGN KEY (user_id, document_id) REFERENCES user_document (user_id, document_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

-- An entry's annotations in order, a page at a time
CREATE INDEX user_document_annotation_start_idx ON user_document_annotation (user_id, document_id, start, id);
