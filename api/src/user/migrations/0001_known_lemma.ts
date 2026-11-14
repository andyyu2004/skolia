import { iso } from "@skolia/util/checks";

export const up = `CREATE TABLE known_lemma (
  lemma_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL,
  updated TEXT NOT NULL ${iso("updated")}
) STRICT, WITHOUT ROWID`;

export const down = "DROP TABLE known_lemma";
