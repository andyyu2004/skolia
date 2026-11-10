-- A user's tags on their entry for a text (TAGS in shared/api.ts): a fixed set of kinds,
-- each with the values it allows, and at most one value of each kind on an entry. They go
-- with the entry.
CREATE TABLE user_document_tag (
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, document_id, kind),
  FOREIGN KEY (user_id, document_id) REFERENCES user_document (user_id, document_id) ON DELETE CASCADE,
  CHECK (kind = 'level' AND value IN ('A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C3'))
) STRICT, WITHOUT ROWID;

-- The entries with a tag, for a list narrowed to some values of a kind
CREATE INDEX user_document_tag_value_idx ON user_document_tag (kind, value, user_id, document_id);
