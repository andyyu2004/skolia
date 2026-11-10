// skolia-api client, typed by the API's routes (AppType). The analysis and bundle are
// blobs the API passes through, typed by the Python schemas (shared/schema.gen.ts); the
// API is ours, so they're trusted to match.
import { hc } from "hono/client";
import type { AppType } from "@skolia/api/app";
import {
  isLang,
  lemmaParam,
  type ApiError,
  type CardCounts,
  type Due,
  type DocumentSummary,
  type AvailableTag,
  type DocumentUpdate,
  type ImportRequest,
  type Lang,
  type LemmaId,
  type Rating,
  type ReadingPosition,
  type ReadingNames,
  type Reviewed,
  type Settings,
  type User,
  type Word,
  type WordStatus,
} from "@skolia/shared/api";
import { BUNDLE_SCHEMA, SCHEMA, type Blob, type Bundle } from "@skolia/shared/schema";

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
  const response = await api.documents.$get({ query: {} });
  if (!response.ok) throw await failure(response);
  return (await response.json()).documents;
}

let available: Promise<AvailableTag[]> | null = null;

/** The tags that can be given, asked for once. */
export function listTags(): Promise<AvailableTag[]> {
  available ??= (async () => {
    const response = await api.tags.$get();
    if (!response.ok) throw await failure(response);
    return (await response.json()).tags;
  })().catch((error: unknown) => {
    available = null;
    throw error;
  });
  return available;
}

export async function getDocument(id: string): Promise<DocumentSummary> {
  const response = await api.documents[":id"].$get({ param: { id } });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The text as uploaded, to show before its analysis is ready. */
export async function getText(id: string): Promise<string> {
  const response = await api.documents[":id"].text.$get({ param: { id } });
  if (!response.ok) throw await failure(response);
  return response.text();
}

export async function importDocument(body: ImportRequest): Promise<DocumentSummary> {
  const response = await api.documents.$post({ json: body });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function updateDocument(id: string, update: DocumentUpdate): Promise<DocumentSummary> {
  const response = await api.documents[":id"].$patch({ param: { id }, json: update });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await api.documents[":id"].$delete({ param: { id } });
  if (!response.ok) throw await failure(response);
}

/** The reading by name, or "unsupported" when its schema is newer than this reader
 * knows (an API deployed ahead of the reader) or its language isn't one it has. Older
 * schemas are read: documents keep theirs until ingest redoes them. */
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
  if (a.schema > SCHEMA || b.schema > BUNDLE_SCHEMA || !isLang(lang) || b.lang !== lang) return "unsupported";
  return { lang, text: await text.text(), analysis: a, bundle: b };
}

/** The user's words, or null when signed out. */
export async function listWords(): Promise<Word[] | null> {
  const response = await api.me.words.$get();
  if (response.status === 401) return null;
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function setWord(lemmaId: LemmaId, status: WordStatus): Promise<void> {
  const response = await api.me.words[":lemmaId"].$put({ param: { lemmaId: lemmaParam(lemmaId) }, json: { status } });
  if (!response.ok) throw await failure(response);
}

/** The start of the local day, which today's new cards count from. */
function dayStartOf(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** Each language's cards due and new today. */
export async function cardCounts(now = new Date()): Promise<CardCounts[] | null> {
  const response = await api.me.cards.counts.$get({ query: { dayStart: dayStartOf(now) } });
  if (response.status === 401) return null;
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** A language's cards to review. */
export async function dueCards(lang: Lang, now = new Date()): Promise<Due | null> {
  const response = await api.me.cards.due.$get({ query: { lang, dayStart: dayStartOf(now) } });
  if (response.status === 401) return null;
  if (!response.ok) throw await failure(response);
  // Hono's JSON type makes the entries' optional fields `| undefined`, which
  // exactOptionalPropertyTypes tells apart; it's the same JSON
  return (await response.json()) as Due;
}

export async function review(cardId: string, rating: Rating): Promise<Reviewed> {
  const json = { id: crypto.randomUUID(), cardId, rating, at: new Date().toISOString() };
  const response = await api.me.reviews.$post({ json });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function getSettings(): Promise<Settings> {
  const response = await api.me.settings.$get();
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function saveSettings(settings: Settings): Promise<void> {
  const response = await api.me.settings.$put({ json: settings });
  if (!response.ok) throw await failure(response);
}

/** Where the user was in the text, null if nowhere yet, or undefined when signed out. */
export async function getPosition(id: string): Promise<ReadingPosition | null | undefined> {
  const response = await api.me.positions[":id"].$get({ param: { id } });
  if (response.status === 401) return undefined;
  if (!response.ok) throw await failure(response);
  return (await response.json()).position;
}

/** keepalive: the request outlives the page, for a save as it's hidden or closed. */
export async function putPosition(id: string, position: ReadingPosition, keepalive = false): Promise<void> {
  const response = await api.me.positions[":id"].$put({ param: { id }, json: position }, { init: { keepalive } });
  if (!response.ok) throw await failure(response);
}
