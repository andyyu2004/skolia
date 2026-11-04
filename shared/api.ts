// Requests and responses of skolia-api. The analysis and bundle shapes come from the
// Python schemas (schema.gen.ts); these are the API's own.
import type { State } from "./schema.gen.ts";

export const LANGS = ["pl"] as const;
export type Lang = (typeof LANGS)[number];

/** Longest text accepted by one import, in characters. */
export const MAX_TEXT_LENGTH = 200_000;

export interface ImportRequest {
  title: string;
  text: string;
  lang: Lang;
}

export interface DocumentSummary {
  /** sha256 hex of the UTF-8 text: the same text imported twice is one document. */
  id: string;
  title: string;
  lang: Lang;
  /** ISO 8601 time of import. */
  imported: string;
  words: number;
  state: State;
  error?: string;
}

export interface DocumentList {
  documents: DocumentSummary[];
}

export interface ApiError {
  error: string;
}
