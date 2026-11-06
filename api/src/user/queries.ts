import { KnownLemma } from "@skolia/shared/schemas";

export const LEMMAS = `SELECT lemma_id AS "lemmaId", status, updated FROM known_lemma`;
export const SET_LEMMA = `INSERT INTO known_lemma (lemma_id, status, updated) VALUES (?, ?, ?)
  ON CONFLICT (lemma_id) DO UPDATE SET status = excluded.status, updated = excluded.updated`;

export const toKnownLemma = (row: unknown) => KnownLemma.parse(row);
