// Blob keys the API writes and ingest reads. Must match
// analysis/src/skolia_analysis/ingest/schema.py (text_key, status_key).

export function textKey(doc: string): string {
  return `text/${doc}.txt`;
}

export function statusKey(doc: string): string {
  return `status/${doc}.json`;
}

/** Document id: sha256 hex of the UTF-8 text, as ingest's doc_id. */
export async function docId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
