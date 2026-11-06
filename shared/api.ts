// Requests and responses of skolia-api. The analysis and bundle shapes come from the
// Python schemas (schema.gen.ts); these are the API's own.
import type { z } from "zod";
import type { State, Upos } from "./schema.gen.ts";
import type * as schemas from "./schemas.ts";

export const LANGS = ["en", "pl"] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l === value);
}

/** Longest text accepted by one import, in characters (ingest checks it too). */
export { MAX_TEXT_LENGTH } from "./schema.gen.ts";

export type ImportRequest = z.input<typeof schemas.ImportRequest>;

export interface DocumentSummary {
  /** sha256 hex of the language and text (docId in keys.ts): the same text imported
   * twice in one language is one document. */
  id: string;
  title: string;
  lang: Lang;
  /** ISO 8601 time of import. */
  imported: string;
  words: number;
  state: State;
  /** The analysis and bundle to show, by name (GET .../analysis/{name}): the current
   * ones, or while newer ones are queued or analysing (or failed), the previous ones.
   * Absent until a first analysis is ready. */
  reading?: ReadingNames | undefined;
  error?: string | undefined;
}

export interface ReadingNames {
  analysis: string;
  bundle: string;
}

export interface DocumentList {
  documents: DocumentSummary[];
}

export const LEMMA_STATUSES = ["new", "learning", "known", "ignored"] as const;
export type LemmaStatus = (typeof LEMMA_STATUSES)[number];

export const UPOS = [
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "SCONJ",
  "SYM",
  "VERB",
  "X",
] as const satisfies readonly Upos[];

const UPOS_IS_COMPLETE: Exclude<Upos, (typeof UPOS)[number]> extends never ? true : never = true;
void UPOS_IS_COMPLETE;

export const MAX_LEMMA_LENGTH = 100;

/** Lexicon entry id, as analysis's blob.lemma_id writes it. */
export type LemmaId = z.output<typeof schemas.LemmaId>;

export type KnownLemma = z.output<typeof schemas.KnownLemma>;

export interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface Version {
  version: string;
}

export interface ApiError {
  error: string;
}
