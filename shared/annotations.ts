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
