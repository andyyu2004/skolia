-- How many annotations an entry has, kept by triggers in the statement that adds or removes
-- one, so the cap on adding one (MAX_ANNOTATIONS in shared/api.ts) reads one row rather
-- than counting the entry's annotations. The CHECK holds the cap if a query misses it.
ALTER TABLE user_document ADD COLUMN annotations_count INTEGER NOT NULL DEFAULT 0 CHECK (annotations_count BETWEEN 0 AND 2000);

UPDATE user_document SET annotations_count = (
  SELECT count(*) FROM user_document_annotation AS a
  WHERE a.user_id = user_document.user_id AND a.document_id = user_document.document_id
);

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
