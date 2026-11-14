import { iso, isoOrNull } from "@skolia/util/checks";
import { up as knownLemma } from "./0001_known_lemma.ts";

export const up = `DROP TABLE known_lemma;
CREATE TABLE word (
  lemma_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'known', 'ignored')),
  updated TEXT NOT NULL ${iso("updated")}
) STRICT, WITHOUT ROWID;
CREATE TABLE card (
  id TEXT NOT NULL PRIMARY KEY,
  lemma_id TEXT NOT NULL REFERENCES word (lemma_id),
  lang TEXT GENERATED ALWAYS AS (substr(lemma_id, 1, instr(lemma_id, ':') - 1)) STORED NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recognition', 'production')),
  created TEXT NOT NULL ${iso("created")},
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  fsrs TEXT NOT NULL CHECK (json_valid(fsrs)),
  due_at TEXT GENERATED ALWAYS AS (fsrs ->> '$.dueAt') STORED NOT NULL ${iso("due_at")},
  schedule_status TEXT GENERATED ALWAYS AS (fsrs ->> '$.scheduleStatus') STORED NOT NULL
    CHECK (schedule_status IN ('new', 'learning', 'review')),
  scheduled_days REAL GENERATED ALWAYS AS (fsrs ->> '$.scheduledDays') STORED NOT NULL,
  first_reviewed TEXT ${isoOrNull("first_reviewed")},
  UNIQUE (lemma_id, kind)
) STRICT, WITHOUT ROWID;
CREATE INDEX card_due ON card (lang, due_at) WHERE active = 1 AND schedule_status != 'new';
CREATE INDEX card_new ON card (lang, created, lemma_id, kind DESC) WHERE active = 1 AND schedule_status = 'new';
CREATE INDEX card_first_reviewed ON card (lang, first_reviewed) WHERE first_reviewed IS NOT NULL;
CREATE TABLE review (
  id TEXT NOT NULL PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES card (id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  review_time TEXT NOT NULL ${iso("review_time")}
) STRICT, WITHOUT ROWID;
CREATE INDEX review_card ON review (card_id, review_time);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  new_per_day INTEGER NOT NULL CHECK (new_per_day BETWEEN 0 AND 1000)
) STRICT;
INSERT INTO settings (id, new_per_day) VALUES (1, 20)`;

export const down = `DROP TABLE settings;
DROP TABLE review;
DROP TABLE card;
DROP TABLE word;
${knownLemma}`;
