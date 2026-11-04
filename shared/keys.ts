// Blob keys the API writes and ingest reads. Must match
// analysis/src/skolia_analysis/ingest/schema.py (doc_prefix, text_key, status_key).
// Ingest writes the analysis and bundle under the same prefix; the API finds their
// keys in the status.

export function docPrefix(doc: string): string {
  return `doc/${doc}/`;
}

export function textKey(doc: string): string {
  return `${docPrefix(doc)}text.txt`;
}

export function statusKey(doc: string): string {
  return `${docPrefix(doc)}status.json`;
}

/** Document id: sha256 hex of the UTF-8 text, as ingest's doc_id. */
export async function docId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
