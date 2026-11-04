// skolia-api client. Response shapes are the API's (shared/api.ts) and the Python
// schemas' (shared/schema.gen.ts); the API is ours, so responses are trusted to match.
import type { ApiError, DocumentList, DocumentSummary, ImportRequest } from "@skolia/shared/api";
import type { Blob, Bundle } from "@skolia/shared/schema";

export interface Reading {
  summary: DocumentSummary;
  text: string;
  analysis: Blob;
  bundle: Bundle;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  return (await request<DocumentList>("/api/documents")).documents;
}

export function getDocument(id: string): Promise<DocumentSummary> {
  return request<DocumentSummary>(`/api/documents/${id}`);
}

export function importDocument(body: ImportRequest): Promise<DocumentSummary> {
  return request<DocumentSummary>("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function loadReading(summary: DocumentSummary): Promise<Reading> {
  const base = `/api/documents/${summary.id}`;
  const [text, analysis, bundle] = await Promise.all([
    fetch(`${base}/text`).then((r) => r.text()),
    request<Blob>(`${base}/analysis`),
    request<Bundle>(`${base}/bundle`),
  ]);
  return { summary, text, analysis, bundle };
}
