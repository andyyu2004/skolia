// Looking a token up in its document's bundle.
import type { Bundle, Entry, Feats, Pronunciation, Sense, Token, Upos } from "@skolia/shared/schema";

/** The sentence decides these, not the form, so paradigms leave them out (see the
 * BundleParadigm docstring in analysis/src/skolia_analysis/lexicon/schema.py). */
const CONTEXTUAL: ReadonlySet<string> = new Set(["PronType", "ExtPos"]);

export function entryFor(bundle: Bundle, token: Token): Entry | undefined {
  if (token.lemma_id === null) return undefined;
  const id = bundle.lookup[token.lemma_id] ?? token.lemma_id;
  return bundle.entries[id];
}

/** How a token's text or an entry's lemma is said, keyed as pronunciation_key in
 * analysis/src/skolia_analysis/lexicon/schema.py. */
export function pronunciationsOf(bundle: Bundle, word: string, upos: Upos): Pronunciation[] {
  return bundle.pronunciations[`${word}:${upos}`] ?? [];
}

/** Every feature the token has (bar contextual ones) has the same value in feats. */
export function featsMatch(feats: Feats, token: Feats): boolean {
  return Object.entries(token).every(
    ([key, value]) => CONTEXTUAL.has(key) || (feats as Record<string, string>)[key] === value,
  );
}

function selects(sense: Sense, token: Feats): boolean {
  return sense.when === undefined || sense.when.some((w) => featsMatch(token, w));
}

export interface RankedSense {
  sense: Sense;
  /** False when the sense needs other features (pies the cop vs the dog). */
  fits: boolean;
}

/** Senses the token's features select first, otherwise in Wiktionary's order. */
export function rankSenses(entry: Entry, token: Feats): RankedSense[] {
  const ranked = entry.senses.map((sense) => ({ sense, fits: selects(sense, token) }));
  return [...ranked.filter((r) => r.fits), ...ranked.filter((r) => !r.fits)];
}
