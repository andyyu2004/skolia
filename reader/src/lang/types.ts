// What the reader needs from a language: everything outside lang/ goes through this.
import type { Entry, Relation, Token } from "@skolia/shared/schema";
import type { Layout, MergeLabels } from "../lib/paradigm.ts";

export interface CaseExplanation {
  text: string;
  /** Index in the sentence of the word that causes the case, to mark in the text. */
  trigger: number | null;
  /** Where the text names the trigger, so the sheet can mark it the way the text does. */
  parts: { text: string; trigger: boolean }[];
}

/** A way the word combines with others: "szukać kogoś/czegoś [gen.]". */
export interface Use {
  /** The headword as the pattern starts: "bać się". */
  head: string;
  /** The rest, with bracketed labels: "kogoś/czegoś [gen.]". */
  pattern: string;
  tags: string[];
  /** Contains fixed words: an idiom. */
  idiom: boolean;
  /** The sentence's own complements fit this one. */
  here: boolean;
}

export interface Language {
  paradigm: Layout;
  /** One label for merged table rows or columns; default: joined with "/". */
  mergeLabels?: MergeLabels;
  /** Why the token at index has its case, for languages whose analysis says. */
  explainCase(tokens: Token[], index: number): CaseExplanation | null;
  /** How the word combines with others, those the sentence uses first. */
  uses(entry: Entry, tokens: Token[], index: number): Use[];
  /** A label for a token that's only part of a word (the Polish person ending -em), shown
   * instead of its part of speech, without meanings or forms; null for a word. */
  partOfWord(token: Token): string | null;
  /** Wiktionary tags the grammar line already shows (gender, aspect), left off senses. */
  grammarTags: ReadonlySet<string>;
  /** A label for relations the language names itself (Polish aspect partners); others
   * read "from (note)". */
  relationLabel?(relation: Relation): string | null;
}
