// Blob keys the API writes and ingest reads. Must match
// analysis/src/skolia_analysis/ingest/schema.py (doc_prefix, text_key, status_key,
// versions_key, analysis_key, bundle_key).
// Ingest writes the analysis and bundle under the same prefix; the API finds their
// keys in the status.
import type { Lang } from "./api.ts";

export function docPrefix(doc: string): string {
  return `doc/${doc}/`;
}

export function textKey(doc: string): string {
  return `${docPrefix(doc)}text.txt`;
}

export function statusKey(doc: string): string {
  return `${docPrefix(doc)}status.json`;
}

/** An analysis or bundle by name (Versions.analysis, Versions.bundle). */
export function partKey(doc: string, part: "analysis" | "bundle", name: string): string {
  return `${docPrefix(doc)}${part}/${name}.json.br`;
}

/** What ingest currently produces for a language (Versions), written when it starts. */
export function versionsKey(lang: Lang): string {
  return `versions/${lang}.json`;
}

/** Document id: sha256 hex of the UTF-8 text, as ingest's doc_id. */
export async function docId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
