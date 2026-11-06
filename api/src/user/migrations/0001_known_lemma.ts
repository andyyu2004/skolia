export const up = `CREATE TABLE known_lemma (
  lemma_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL,
  updated TEXT NOT NULL CHECK (updated IS strftime('%Y-%m-%dT%H:%M:%fZ', updated))
) STRICT, WITHOUT ROWID`;

export const down = "DROP TABLE known_lemma";
