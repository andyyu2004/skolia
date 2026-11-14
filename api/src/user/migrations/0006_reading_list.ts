// The texts on the user's reading list, each with its status. lang is the text's, which
// never changes (its id is its hash), copied here so the list of one language is read from
// an index. Each status's list is in the order its rows last changed, latest first, with
// or without a language.
import { iso } from "@skolia/util/checks";

export const up = `CREATE TABLE reading_list (
  document_id TEXT NOT NULL PRIMARY KEY,
  lang TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('to-read', 'in-progress', 'done')),
  added_at TEXT NOT NULL ${iso("added_at")},
  updated_at TEXT NOT NULL ${iso("updated_at")}
) STRICT, WITHOUT ROWID;
CREATE INDEX reading_list_status ON reading_list (status, updated_at, document_id);
CREATE INDEX reading_list_lang ON reading_list (lang, status, updated_at, document_id)`;

export const down = "DROP TABLE reading_list";
