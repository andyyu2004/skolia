-- Something an entry's user attached to a range of its text, seen wherever the entry is: a
-- recording of a paragraph, say, or a note on it. start and end are UTF-16 offsets into the
-- text, as JavaScript counts them; a document's text never changes, so they never go stale.
-- kind says what data holds, and the CHECK below holds each kind's data to its fields
-- (shared/schemas.ts AnnotationContent): audio, {url}, a recording at an https URL; text,
-- {text}, anything written about the range, at most 2000 characters. A new kind is a
-- migration that rebuilds the table with its fields added here. An annotation has its own
-- credit, since a recording's narrator and licence aren't the text's. id is a hash of what
-- the annotation says, so the same one added twice is one row and a changed one is new.
CREATE TABLE user_document_annotation (
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  id TEXT NOT NULL,
  start INTEGER NOT NULL CHECK (start >= 0),
  "end" INTEGER NOT NULL CHECK ("end" > start),
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'text')),
  data TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
  licence TEXT NOT NULL CHECK (licence IN ('public-domain', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd')),
  author TEXT,
  source TEXT CHECK (source GLOB 'http://?*' OR source GLOB 'https://?*'),
  added_at TEXT NOT NULL CHECK (added_at IS strftime('%Y-%m-%dT%H:%M:%fZ', added_at)),
  PRIMARY KEY (user_id, document_id, id),
  -- Each kind's fields and no others: json_remove of them leaves {}. IS, not =, and ELSE 0,
  -- since a CHECK that comes out NULL (a missing field) passes
  CHECK (CASE kind
    WHEN 'audio' THEN json_type(data, '$.url') IS 'text' AND json_extract(data, '$.url') GLOB 'https://?*'
      AND json_remove(data, '$.url') = '{}'
    WHEN 'text' THEN json_type(data, '$.text') IS 'text' AND length(json_extract(data, '$.text')) BETWEEN 1 AND 2000
      AND json_remove(data, '$.text') = '{}'
    ELSE 0
  END),
  FOREIGN KEY (user_id, document_id) REFERENCES user_document (user_id, document_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

-- An entry's annotations in order, a page at a time
CREATE INDEX user_document_annotation_start_idx ON user_document_annotation (user_id, document_id, start, id);
