export const up = `CREATE TABLE reading_position (
  document_id TEXT NOT NULL PRIMARY KEY,
  "offset" INTEGER NOT NULL CHECK ("offset" >= 0),
  at TEXT NOT NULL CHECK (at IS strftime('%Y-%m-%dT%H:%M:%fZ', at))
) STRICT, WITHOUT ROWID`;

export const down = "DROP TABLE reading_position";
