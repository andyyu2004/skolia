-- Something an entry's user attached to a range of its text, seen wherever the entry is: a
-- recording of a paragraph, say, or a note on it. start and end are UTF-16 offsets into the
-- text, as JavaScript counts them; a document's text never changes, so they never go stale.
-- kind says what data, a JSON object, holds: shared/schemas.ts AnnotationContent checks each
-- kind's fields in the API. They aren't CHECKs here, since SQLite can't change a CHECK
-- without rebuilding the table, and a new kind shouldn't need that. An annotation has its own
-- credit, since a recording's narrator and licence aren't the text's. id is a hash of what
-- the annotation says, so the same one added twice is one row and a changed one is new.
CREATE TABLE user_document_annotation (
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  id TEXT NOT NULL,
  start INTEGER NOT NULL CHECK (start >= 0),
  "end" INTEGER NOT NULL CHECK ("end" > start),
  kind TEXT NOT NULL,
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

-- How many annotations an entry has, kept by triggers in the statement that adds or removes
-- one, so the cap on adding one (MAX_ANNOTATIONS in shared/api.ts) reads one row rather
-- than counting the entry's annotations. The cap itself is the insert's, not a CHECK, so it
-- can be raised without rebuilding user_document.
ALTER TABLE user_document ADD COLUMN annotations_count INTEGER NOT NULL DEFAULT 0 CHECK (annotations_count >= 0);

CREATE TRIGGER user_document_annotation_added AFTER INSERT ON user_document_annotation
BEGIN
  UPDATE user_document SET annotations_count = annotations_count + 1
  WHERE user_id = NEW.user_id AND document_id = NEW.document_id;
END;

CREATE TRIGGER user_document_annotation_removed AFTER DELETE ON user_document_annotation
BEGIN
  UPDATE user_document SET annotations_count = annotations_count - 1
  WHERE user_id = OLD.user_id AND document_id = OLD.document_id;
END;
