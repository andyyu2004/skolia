CREATE TABLE document (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  lang TEXT NOT NULL,
  imported TEXT NOT NULL,
  words INTEGER NOT NULL
);
