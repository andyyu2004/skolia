import { LEMMA_STATUSES, parseLemmaId, type KnownLemma } from "@skolia/shared/api";

export const LEMMAS = "SELECT lemma_id, status, updated FROM known_lemma";
export const SET_LEMMA = `INSERT INTO known_lemma (lemma_id, status, updated) VALUES (?, ?, ?)
  ON CONFLICT (lemma_id) DO UPDATE SET status = excluded.status, updated = excluded.updated`;

export function toKnownLemma(row: Record<string, unknown>): KnownLemma {
  const { lemma_id, status, updated } = row;
  const lemmaId = typeof lemma_id === "string" ? parseLemmaId(lemma_id) : null;
  const knownStatus = LEMMA_STATUSES.find((s) => s === status);
  if (lemmaId === null || knownStatus === undefined || typeof updated !== "string") {
    throw new Error(`malformed known_lemma row: ${JSON.stringify(row)}`);
  }
  return { lemmaId, status: knownStatus, updated };
}
