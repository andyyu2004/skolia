// skolia-api client, typed by the API's routes (AppType). The analysis and bundle are
// blobs the API passes through, typed by the Python schemas (shared/schema.gen.ts); the
// API is ours, so they're trusted to match.
import { hc } from "hono/client";
import type { AppType } from "@skolia/api/app";
import type { ApiError, DocumentSummary, ImportRequest, Lang, ReadingNames, User } from "@skolia/shared/api";
import { BUNDLE_SCHEMA, SCHEMA, type Blob, type Bundle } from "@skolia/shared/schema";
import { isLang } from "../lang/index.ts";

const api = hc<AppType>("/").api;

export interface Reading {
  lang: Lang;
  text: string;
  analysis: Blob;
  bundle: Bundle;
}

async function failure(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error ?? `${response.status} ${response.statusText}`);
}

export async function currentUser(): Promise<User | null> {
  const response = await api.me.$get();
  if (response.status === 401) return null;
  if (!response.ok) throw await failure(response);
  return response.json();
}

async function auth(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  return response;
}

export async function signIn(): Promise<void> {
  const response = await auth("sign-in/social", { provider: "google", callbackURL: location.href });
  const { url } = (await response.json()) as { url: string };
  location.assign(url);
}

export async function signOut(): Promise<void> {
  await auth("sign-out", {});
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const response = await api.documents.$get();
  if (!response.ok) throw await failure(response);
  return (await response.json()).documents;
}

export async function getDocument(id: string): Promise<DocumentSummary> {
  const response = await api.documents[":id"].$get({ param: { id } });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function importDocument(body: ImportRequest): Promise<DocumentSummary> {
  const response = await api.documents.$post({ json: body });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The reading by name, or "unsupported" when its shape or language is one this reader
 * doesn't know (an old analysis served while a new one is made, or a newer API). */
export async function loadReading(id: string, names: ReadingNames): Promise<Reading | "unsupported"> {
  const doc = api.documents[":id"];
  const [text, analysis, bundle] = await Promise.all([
    doc.text.$get({ param: { id } }),
    doc.analysis[":name"].$get({ param: { id, name: names.analysis } }),
    doc.bundle[":name"].$get({ param: { id, name: names.bundle } }),
  ]);
  for (const response of [text, analysis, bundle]) if (!response.ok) throw await failure(response);
  const [a, b] = [(await analysis.json()) as Blob, (await bundle.json()) as Bundle];
  const lang = a.lang;
  if (a.schema !== SCHEMA || b.schema !== BUNDLE_SCHEMA || !isLang(lang)) return "unsupported";
  return { lang, text: await text.text(), analysis: a, bundle: b };
}
