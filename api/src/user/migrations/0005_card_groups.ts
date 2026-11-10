// Cards in two groups, each with its own daily allowance: words (recognition and
// production), counted in lemmas, and forms (cloze cards), counted in cards. card_lemma:
// a word's status sets active on all its cards, cloze cards too, which card_word leaves out.
export const up = `ALTER TABLE settings RENAME COLUMN new_per_day TO new_lemmas_per_day;
ALTER TABLE settings ADD COLUMN new_forms_per_day INTEGER NOT NULL DEFAULT 20 CHECK (new_forms_per_day BETWEEN 0 AND 1000);
ALTER TABLE settings ADD COLUMN forms_with_words INTEGER NOT NULL DEFAULT 1 CHECK (forms_with_words IN (0, 1));
CREATE INDEX card_lemma ON card (lemma_id)`;

export const down = `DROP INDEX card_lemma;
ALTER TABLE settings DROP COLUMN forms_with_words;
ALTER TABLE settings DROP COLUMN new_forms_per_day;
ALTER TABLE settings RENAME COLUMN new_lemmas_per_day TO new_per_day`;
