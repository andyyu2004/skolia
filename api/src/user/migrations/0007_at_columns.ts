// Timestamp columns are named <verb>_at. SQLite renames the column in its CHECK and indexes too.
export const up = `ALTER TABLE word RENAME COLUMN updated TO updated_at;
ALTER TABLE card RENAME COLUMN created TO created_at;
ALTER TABLE card RENAME COLUMN first_reviewed TO first_reviewed_at;
ALTER TABLE review RENAME COLUMN review_time TO reviewed_at`;

export const down = `ALTER TABLE review RENAME COLUMN reviewed_at TO review_time;
ALTER TABLE card RENAME COLUMN first_reviewed_at TO first_reviewed;
ALTER TABLE card RENAME COLUMN created_at TO created;
ALTER TABLE word RENAME COLUMN updated_at TO updated`;
