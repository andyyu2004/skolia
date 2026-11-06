// skolia-api client. Response shapes are the API's (shared/api.ts) and the Python
// schemas' (shared/schema.gen.ts); the API is ours, so responses are trusted to match.
import type { ApiError, DocumentList, DocumentSummary, ImportRequest, ReadingNames, User } from "@skolia/shared/api";
import { BUNDLE_SCHEMA, SCHEMA, type Blob, type Bundle } from "@skolia/shared/schema";

export interface Reading {
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

export async function currentUser(): Promise<User | null> {
  const response = await fetch("/api/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as User;
}

export async function signIn(): Promise<void> {
  const { url } = await request<{ url: string }>("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: location.href }),
  });
  location.assign(url);
}

export async function signOut(): Promise<void> {
  await request<unknown>("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
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

/** The reading by name, or "unsupported" when its shape is one this reader doesn't
 * know (an old analysis, served while a new one is made). */
export async function loadReading(id: string, names: ReadingNames): Promise<Reading | "unsupported"> {
  const base = `/api/documents/${id}`;
  const [text, analysis, bundle] = await Promise.all([
    fetchText(`${base}/text`),
    request<Blob>(`${base}/analysis/${names.analysis}`),
    request<Bundle>(`${base}/bundle/${names.bundle}`),
  ]);
  if (analysis.schema !== SCHEMA || bundle.schema !== BUNDLE_SCHEMA) return "unsupported";
  return { text, analysis, bundle };
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}
