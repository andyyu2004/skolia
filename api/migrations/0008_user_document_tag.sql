-- The tags skolia has (tag), and a user's tags on their entry for a text (user_document_tag):
-- only tags in tag, at most one of each kind on an entry. A new tag is a row in tag; its
-- position orders it among its kind's. An entry's tags go with it.
CREATE TABLE tag (
  kind TEXT NOT NULL CHECK (kind GLOB '[a-z]*' AND kind NOT GLOB '*[^a-z0-9-]*' AND length(kind) <= 32),
  value TEXT NOT NULL CHECK (value GLOB '[A-Za-z0-9]*' AND value NOT GLOB '*[^A-Za-z0-9.+-]*' AND length(value) <= 32),
  description TEXT,
  position INTEGER NOT NULL,
  PRIMARY KEY (kind, value),
  UNIQUE (kind, position)
) STRICT, WITHOUT ROWID;

-- level: how hard a text is to read for a learner of its language. CEFR's levels, with A0
-- before them and C3 after.
INSERT INTO tag (kind, value, description, position) VALUES
  ('level', 'A0', 'Starter', 0),
  ('level', 'A1', 'Beginner', 1),
  ('level', 'A2', 'Elementary', 2),
  ('level', 'B1', 'Intermediate', 3),
  ('level', 'B2', 'Upper intermediate', 4),
  ('level', 'C1', 'Advanced', 5),
  ('level', 'C2', 'Proficient', 6),
  ('level', 'C3', 'Beyond proficient', 7);

CREATE TABLE user_document_tag (
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, document_id, kind),
  FOREIGN KEY (user_id, document_id) REFERENCES user_document (user_id, document_id) ON DELETE CASCADE,
  FOREIGN KEY (kind, value) REFERENCES tag (kind, value)
) STRICT, WITHOUT ROWID;

-- The entries with a tag, for a list narrowed to some values of a kind
CREATE INDEX user_document_tag_value_idx ON user_document_tag (kind, value, user_id, document_id);
