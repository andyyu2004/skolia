// A text's annotations as the reader shows them: audio only, for now, each a play button
// before the word its range starts in.
import type { Annotation } from "@skolia/shared/api";
import type { Piece } from "@skolia/shared/doc";
import * as schemas from "@skolia/shared/schemas";

export type AudioAnnotation = Extract<Annotation, { readonly kind: "audio" }>;

/** The audio annotations among the API's. One of a kind this reader doesn't know, or that
 * doesn't parse, is skipped, so a reader older than the API still shows the rest. */
export function audioAnnotations(items: readonly unknown[]): readonly AudioAnnotation[] {
  return items.flatMap((item) => {
    const parsed = schemas.Annotation.safeParse(item);
    return parsed.success && parsed.data.kind === "audio" ? [parsed.data] : [];
  });
}

/** An audio annotation and its range in code points, as the analysis counts (git-bug ec23aef). */
export type PlacedAudio = {
  readonly annotation: AudioAnnotation;
  readonly start: number;
  readonly end: number;
};

/** Code points past the BMP, two UTF-16 units each: a text without them counts the same both ways. */
const ASTRAL = /[\u{10000}-\u{10FFFF}]/u;

/** A UTF-16 offset into the text, in code points; astral: whether the text has any past the BMP. */
function codePoints(text: string, astral: boolean, offset: number): number {
  return astral ? [...text.slice(0, offset)].length : offset;
}

/** Each audio annotation by the index of the piece its button goes before: the first word
 * that ends after the range starts, if it starts before the range ends. */
export function placeAudio(
  text: string,
  pieces: readonly Piece[],
  annotations: readonly AudioAnnotation[],
): ReadonlyMap<number, readonly PlacedAudio[]> {
  const words = pieces.flatMap((piece, index) => {
    const token = piece.kind === "word" ? piece.words[0]?.token : undefined;
    return token ? [{ index, start: token.start, end: token.end }] : [];
  });
  const astral = ASTRAL.test(text);
  return annotations.reduce((places, annotation) => {
    const placed = { annotation, start: codePoints(text, astral, annotation.start), end: codePoints(text, astral, annotation.end) };
    const word = words[firstEndingAfter(words, placed.start)];
    if (word && word.start < placed.end) places.set(word.index, [...(places.get(word.index) ?? []), placed]);
    return places;
  }, new Map<number, readonly PlacedAudio[]>());
}

/** The first word, in order, that ends after offset; words.length if none does. */
function firstEndingAfter(words: readonly { readonly end: number }[], offset: number): number {
  let [low, high] = [0, words.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((words[middle]?.end ?? Infinity) > offset) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Whether the piece is a word in the range. */
export function inRange(range: PlacedAudio, piece: Piece): boolean {
  const token = piece.kind === "word" ? piece.words[0]?.token : undefined;
  return token !== undefined && token.start < range.end && token.end > range.start;
}
