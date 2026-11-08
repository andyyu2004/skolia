// Looking a token up in its document's bundle.
import type { Bundle, Entry, Feats, Pronunciation, Recording, Sense, Token, Upos } from "@skolia/shared/schema";

/** The sentence decides these, not the form, so paradigms leave them out (see the
 * BundleParadigm docstring in analysis/src/skolia_analysis/lexicon/schema.py). */
const CONTEXTUAL: ReadonlySet<string> = new Set(["PronType", "ExtPos"]);

/** The id of the token's entry, after the bundle's fallbacks (Old in "Old Town" is
 * en:old:ADJ): the id words and cards are kept under. */
export function entryIdFor(bundle: Bundle, token: Token): string | undefined {
  if (token.lemma_id === null) return undefined;
  const id = bundle.lookup[token.lemma_id] ?? token.lemma_id;
  return id in bundle.entries ? id : undefined;
}

export function entryFor(bundle: Bundle, token: Token): Entry | undefined {
  const id = entryIdFor(bundle, token);
  return id === undefined ? undefined : bundle.entries[id];
}

/** How a token's text or an entry's lemma is said, keyed as pronunciation_key in
 * analysis/src/skolia_analysis/lexicon/schema.py. */
export function pronunciationsOf(bundle: Bundle, word: string, upos: Upos): Pronunciation[] {
  return bundle.pronunciations?.[`${word}:${upos}`] ?? [];
}

/** Recordings of a token's text or an entry's lemma, keyed like pronunciationsOf. */
export function recordingsOf(bundle: Bundle, word: string, upos: Upos): Recording[] {
  return bundle.recordings?.[`${word}:${upos}`] ?? [];
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
