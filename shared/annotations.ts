// An annotation's id: what an entry's user attaches to a range of its text (Annotation in
// api.ts) is identified by what it says.
import type { AnnotationContent, AnnotationId, ShareableLicence } from "./api.ts";

/** What an annotation says, which its id is a hash of. */
export type IdentifiedBy = AnnotationContent & {
  readonly start: number;
  readonly end: number;
  readonly licence: ShareableLicence;
  readonly author: string | null;
  readonly source: string | null;
};

/** sha256 hex of what the annotation says as canonical JSON, so the same annotation added
 * twice has one id and a changed one has another. */
export async function annotationId({ start, end, kind, data, licence, author, source }: IdentifiedBy): Promise<AnnotationId> {
  const json = canonicalJson({ start, end, kind, data, licence, author, source });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("") as AnnotationId;
}

/** Why the range [start, end) of the text, in UTF-16 code units, can't be annotated because
 * it cuts through a word, or null when it doesn't. Words are Intl.Segmenter's word-like
 * segments in the text's language; a range may start or end on whitespace or punctuation. */
export function cutsWord(text: string, start: number, end: number, lang: string): string | null {
  if (insideWord(text, start, lang)) return `the annotation starts inside a word, at ${start}`;
  if (insideWord(text, end, lang)) return `the annotation ends inside a word, at ${end}`;
  return null;
}

/** Code units either side of an offset that insideWord segments, at first. */
const WINDOW = 64;

const segmenters = new Map<string, Intl.Segmenter>();

/** Whether the offset is strictly inside a word-like segment of the text. Segments a window
 * around the offset rather than the whole text, widened while the segment at the offset, or
 * the one ending there, reaches a place where the window cut the text, so it might go on. */
export function insideWord(text: string, offset: number, lang: string): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const segmenter = segmenters.get(lang) ?? new Intl.Segmenter(lang, { granularity: "word" });
  segmenters.set(lang, segmenter);
  for (let radius = WINDOW; ; radius *= 2) {
    const from = Math.max(0, offset - radius);
    const to = Math.min(text.length, offset + radius);
    const segments = segmenter.segment(text.slice(from, to));
    const at = segments.containing(offset - from);
    const cut = (s: Intl.SegmentData | undefined) =>
      s !== undefined && ((from > 0 && s.index === 0) || (to < text.length && s.index + s.segment.length === to - from));
    if (!cut(at) && !cut(segments.containing(offset - from - 1))) return at?.isWordLike === true && at.index < offset - from;
  }
}

/** JSON with each object's keys sorted and no whitespace; undefined fields are left out. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${fields
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
