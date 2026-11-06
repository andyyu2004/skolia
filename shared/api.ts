// Requests and responses of skolia-api. The analysis and bundle shapes come from the
// Python schemas (schema.gen.ts); these are the API's own.
import type { State, Upos } from "./schema.gen.ts";

export const LANGS = ["pl"] as const;
export type Lang = (typeof LANGS)[number];

/** Longest text accepted by one import, in characters (ingest checks it too). */
export { MAX_TEXT_LENGTH } from "./schema.gen.ts";

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

export function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l === value);
}

const UPOS: Record<Upos, true> = {
  ADJ: true,
  ADP: true,
  ADV: true,
  AUX: true,
  CCONJ: true,
  DET: true,
  INTJ: true,
  NOUN: true,
  NUM: true,
  PART: true,
  PRON: true,
  PROPN: true,
  PUNCT: true,
  SCONJ: true,
  SYM: true,
  VERB: true,
  X: true,
};

function isUpos(value: string): value is Upos {
  return Object.hasOwn(UPOS, value);
}

/** Lexicon entry id, as analysis's blob.lemma_id writes it. */
export type LemmaId = `${Lang}:${string}:${Upos}`;

const MAX_LEMMA_LENGTH = 100;

export function parseLemmaId(value: string): LemmaId | null {
  const first = value.indexOf(":");
  const last = value.lastIndexOf(":");
  if (last <= first) return null;
  const lang = value.slice(0, first);
  const lemma = value.slice(first + 1, last);
  const upos = value.slice(last + 1);
  if (!isLang(lang) || !isUpos(upos) || lemma.trim() === "" || lemma.length > MAX_LEMMA_LENGTH) return null;
  return `${lang}:${lemma}:${upos}`;
}

export interface KnownLemma {
  lemmaId: LemmaId;
  status: LemmaStatus;
  updated: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ApiError {
  error: string;
}
