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

/** A document's. private: left out of other users' libraries, though anyone with its id
 * can open it. A public import of the same text, with a shareable licence, makes it public. */
export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The licence a text is under, as its uploader claims it. unknown: the texts from before
 * licences were recorded. */
export const LICENCES = [
  "public-domain",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
  "all-rights-reserved",
  "unknown",
] as const;
export type Licence = (typeof LICENCES)[number];

/** The licences a public text can be under. NC (non-commercial) is fine, as skolia is.
 * ND (no derivatives) is fine while texts are shown whole and unchanged, the analysis
 * beside them: CC 4.0 lets you share the work "in whole or in part" and make the
 * "technical modifications" a medium needs (2(a)(4)). Translating, simplifying or
 * editing a text, or glossing it inline, would make an adaptation, which ND forbids
 * sharing. */
export const SHAREABLE_LICENCES = [
  "public-domain",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
] as const satisfies readonly Licence[];

export function isShareable(licence: Licence): boolean {
  return SHAREABLE_LICENCES.some((l) => l === licence);
}

export const MAX_AUTHOR_LENGTH = 200;
export const MAX_SOURCE_LENGTH = 2000;

export interface DocumentSummary {
  /** sha256 hex of the language and text (docId in keys.ts): the same text imported
   * twice in one language is one document. */
  id: string;
  title: string;
  lang: Lang;
  /** ISO 8601 time of import. */
  imported: string;
  words: number;
  visibility: Visibility;
  licence: Licence;
  /** Who wrote the text, as the uploader gives it. */
  author: string | null;
  /** An http(s) URL of where the text is from. */
  source: string | null;
  /** The display name of the user who first imported it. */
  importerName: string;
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
