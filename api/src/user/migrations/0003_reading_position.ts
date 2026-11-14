import { iso } from "@skolia/util/checks";

export const up = `CREATE TABLE reading_position (
  document_id TEXT NOT NULL PRIMARY KEY,
  sentence INTEGER NOT NULL CHECK (sentence >= 0),
  token INTEGER NOT NULL CHECK (token >= 0),
  at TEXT NOT NULL ${iso("at")}
) STRICT, WITHOUT ROWID`;

export const down = "DROP TABLE reading_position";
