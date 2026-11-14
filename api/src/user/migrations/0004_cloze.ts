// Cloze cards: a sentence from a text with one word blanked out, made from the reader.
// A lemma can have many (one per sentence), and one can be made before its word has a
// status, so card is rebuilt without UNIQUE (lemma_id, kind) and the foreign key to word. Recognition
// and production cards stay one per word, by a partial unique index. A cloze row belongs to a
// card of kind cloze, by a foreign key on (card_id, kind), and deleting a card deletes its
// cloze row and its reviews. sentence_start, blank_start and blank_end are offsets in the
// text, which never changes (its id is its hash), so a word's place in it is the same
// however the analysis splits sentences.
import { iso, isoOrNull } from "@skolia/util/checks";

/** card and review as version 3 has them (cloze false: no cloze kind, card's foreign key to
 * word and UNIQUE (lemma_id, kind), reviews kept when their card goes) or as this version
 * does. review references card, so it's set aside and dropped while card is rebuilt:
 * dropping card with reviews in place fails the foreign key at the commit, even with the
 * check deferred and the same ids in the new card, as SQLite counts the violations as they
 * happen. */
const rebuild = (cloze: boolean) => `CREATE TABLE review_kept AS SELECT * FROM review;
DROP TABLE review;
CREATE TABLE card_next (
  id TEXT NOT NULL PRIMARY KEY,
  lemma_id TEXT NOT NULL${cloze ? "" : " REFERENCES word (lemma_id)"},
  lang TEXT GENERATED ALWAYS AS (substr(lemma_id, 1, instr(lemma_id, ':') - 1)) STORED NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recognition', 'production'${cloze ? ", 'cloze'" : ""})),
  created TEXT NOT NULL ${iso("created")},
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  fsrs TEXT NOT NULL CHECK (json_valid(fsrs)),
  due_at TEXT GENERATED ALWAYS AS (fsrs ->> '$.dueAt') STORED NOT NULL ${iso("due_at")},
  schedule_status TEXT GENERATED ALWAYS AS (fsrs ->> '$.scheduleStatus') STORED NOT NULL
    CHECK (schedule_status IN ('new', 'learning', 'review')),
  scheduled_days REAL GENERATED ALWAYS AS (fsrs ->> '$.scheduledDays') STORED NOT NULL,
  first_reviewed TEXT ${isoOrNull("first_reviewed")},
  UNIQUE (${cloze ? "id, kind" : "lemma_id, kind"})
) STRICT, WITHOUT ROWID;
INSERT INTO card_next (id, lemma_id, kind, created, active, fsrs, first_reviewed)
  SELECT id, lemma_id, kind, created, active, fsrs, first_reviewed FROM card;
DROP TABLE card;
ALTER TABLE card_next RENAME TO card;
CREATE INDEX card_due ON card (lang, due_at) WHERE active = 1 AND schedule_status != 'new';
CREATE INDEX card_new ON card (lang, created, lemma_id, kind DESC) WHERE active = 1 AND schedule_status = 'new';
CREATE INDEX card_first_reviewed ON card (lang, first_reviewed) WHERE first_reviewed IS NOT NULL;
CREATE TABLE review (
  id TEXT NOT NULL PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES card (id)${cloze ? " ON DELETE CASCADE" : ""},
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  review_time TEXT NOT NULL ${iso("review_time")}
) STRICT, WITHOUT ROWID;
CREATE INDEX review_card ON review (card_id, review_time);
INSERT INTO review SELECT * FROM review_kept;
DROP TABLE review_kept;`;

export const up = `${rebuild(true)}
CREATE UNIQUE INDEX card_word ON card (lemma_id, kind) WHERE kind != 'cloze';
CREATE TABLE cloze (
  card_id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'cloze' CHECK (kind = 'cloze'),
  document_id TEXT NOT NULL,
  sentence TEXT NOT NULL CHECK (sentence != ''),
  sentence_start INTEGER NOT NULL CHECK (sentence_start >= 0),
  blank_start INTEGER NOT NULL CHECK (blank_start >= sentence_start),
  blank_end INTEGER NOT NULL CHECK (blank_end > blank_start),
  feats TEXT NOT NULL CHECK (json_valid(feats) AND json_type(feats) = 'object'),
  why TEXT,
  UNIQUE (document_id, blank_start),
  FOREIGN KEY (card_id, kind) REFERENCES card (id, kind) ON DELETE CASCADE
) STRICT, WITHOUT ROWID`;

export const down = `DROP TABLE cloze;
DELETE FROM card WHERE kind = 'cloze';
${rebuild(false)}`;
