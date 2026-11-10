// Cloze cards: a sentence from a text with one word blanked out, made from the reader.
// A lemma can have many (one per sentence), and one can be made before its word has a
// status, so card is rebuilt without UNIQUE (lemma_id, kind) and the foreign key to word. Recognition
// and production cards stay one per word, by a partial unique index.
const iso = (column: string) => `CHECK (${column} IS strftime('%Y-%m-%dT%H:%M:%fZ', ${column}))`;

/** card as it is with these kinds; word: the version 2 table's foreign key and UNIQUE.
 * review references card, so its rows are set aside while card is rebuilt: dropping card
 * with them in place fails the foreign key at the commit, even with the check deferred
 * and the same ids in the new card, as SQLite counts the violations as they happen. */
const card = (kinds: string, word: boolean) => `CREATE TABLE review_kept AS SELECT * FROM review;
DELETE FROM review;
CREATE TABLE card_next (
  id TEXT NOT NULL PRIMARY KEY,
  lemma_id TEXT NOT NULL${word ? " REFERENCES word (lemma_id)" : ""},
  lang TEXT GENERATED ALWAYS AS (substr(lemma_id, 1, instr(lemma_id, ':') - 1)) STORED NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (${kinds})),
  created TEXT NOT NULL ${iso("created")},
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  fsrs TEXT NOT NULL CHECK (json_valid(fsrs)),
  due_at TEXT GENERATED ALWAYS AS (fsrs ->> '$.dueAt') STORED NOT NULL ${iso("due_at")},
  schedule_status TEXT GENERATED ALWAYS AS (fsrs ->> '$.scheduleStatus') STORED NOT NULL
    CHECK (schedule_status IN ('new', 'learning', 'review')),
  scheduled_days REAL GENERATED ALWAYS AS (fsrs ->> '$.scheduledDays') STORED NOT NULL,
  first_reviewed TEXT CHECK (first_reviewed IS NULL OR first_reviewed IS strftime('%Y-%m-%dT%H:%M:%fZ', first_reviewed))${word ? ",\n  UNIQUE (lemma_id, kind)" : ""}
) STRICT, WITHOUT ROWID;
INSERT INTO card_next (id, lemma_id, kind, created, active, fsrs, first_reviewed)
  SELECT id, lemma_id, kind, created, active, fsrs, first_reviewed FROM card;
DROP TABLE card;
ALTER TABLE card_next RENAME TO card;
CREATE INDEX card_due ON card (lang, due_at) WHERE active = 1 AND schedule_status != 'new';
CREATE INDEX card_new ON card (lang, created, lemma_id, kind DESC) WHERE active = 1 AND schedule_status = 'new';
CREATE INDEX card_first_reviewed ON card (lang, first_reviewed) WHERE first_reviewed IS NOT NULL;
INSERT INTO review SELECT * FROM review_kept;
DROP TABLE review_kept;`;

export const up = `${card("'recognition', 'production', 'cloze'", false)}
CREATE UNIQUE INDEX card_word ON card (lemma_id, kind) WHERE kind != 'cloze';
CREATE TABLE cloze (
  card_id TEXT NOT NULL PRIMARY KEY REFERENCES card (id),
  document_id TEXT NOT NULL,
  sentence TEXT NOT NULL CHECK (sentence != ''),
  sentence_start INTEGER NOT NULL CHECK (sentence_start >= 0),
  blank_start INTEGER NOT NULL CHECK (blank_start >= 0),
  blank_end INTEGER NOT NULL CHECK (blank_end > blank_start),
  feats TEXT NOT NULL CHECK (json_valid(feats) AND json_type(feats) = 'object'),
  why TEXT,
  UNIQUE (document_id, sentence_start, blank_start)
) STRICT, WITHOUT ROWID`;

export const down = `DELETE FROM review WHERE card_id IN (SELECT card_id FROM cloze);
DROP TABLE cloze;
DELETE FROM card WHERE kind = 'cloze';
${card("'recognition', 'production'", true)}`;
