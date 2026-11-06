export const up = `CREATE TABLE known_lemma (
  lemma_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  updated TEXT NOT NULL
) WITHOUT ROWID`;

export const down = "DROP TABLE known_lemma";
