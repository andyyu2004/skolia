// Annotations: what an entry's user attaches to a range of its text. Each kind's data has
// a schema here; a new kind is an entry in ANNOTATION_KINDS and a renderer in the reader,
// with no migration, since data is stored as JSON. A reader skips a kind it doesn't know.
import * as z from "zod";
import { MAX_SOURCE_LENGTH, type AnnotationId, type ShareableLicence } from "./api.ts";

const HttpsUrl = z.url({ protocol: /^https$/u, error: "url must be an https URL" }).max(MAX_SOURCE_LENGTH);

export const ANNOTATION_KINDS = {
  /** A recording of the range read aloud, at a URL skolia doesn't host. */
  audio: z.strictObject({ url: HttpsUrl }),
} as const;

export type AnnotationKind = keyof typeof ANNOTATION_KINDS;

/** A kind this code knows and its data, parsed as that kind's. */
export type KindData = {
  readonly [K in AnnotationKind]: { readonly kind: K; readonly data: z.output<(typeof ANNOTATION_KINDS)[K]> };
}[AnnotationKind];

export function isAnnotationKind(kind: string): kind is AnnotationKind {
  return Object.hasOwn(ANNOTATION_KINDS, kind);
}

/** The annotation with its data parsed as its kind's, or null for a kind this code doesn't
 * know or data that isn't the kind's. */
export function parseAnnotation<A extends { readonly kind: string; readonly data: unknown }>(
  annotation: A,
): (Omit<A, "kind" | "data"> & KindData) | null {
  const { kind } = annotation;
  if (!isAnnotationKind(kind)) return null;
  const parsed = ANNOTATION_KINDS[kind].safeParse(annotation.data);
  return parsed.success ? { ...annotation, kind, data: parsed.data } : null;
}

/** What an annotation says, which its id is a hash of. */
export type AnnotationContent = {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly licence: ShareableLicence;
  readonly author: string | null;
  readonly source: string | null;
};

/** sha256 hex of the content as canonical JSON, so the same annotation added twice has one
 * id and a changed one has another. */
export async function annotationId({ start, end, kind, data, licence, author, source }: AnnotationContent): Promise<AnnotationId> {
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
