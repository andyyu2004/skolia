// skolia-api client, typed by the API's routes (AppType). The analysis and bundle are
// blobs the API passes through, typed by the Python schemas (shared/schema.gen.ts); the
// API is ours, so they're trusted to match.
import { hc } from "hono/client";
import type { AppType } from "@skolia/api/app";
import {
  ANNOTATION_PAGE,
  type Annotation,
  CLOZE_PAGE,
  TAG_PAGE,
  WORD_PAGE,
  isLang,
  lemmaParam,
  type AnnotationKey,
  type ApiError,
  type CardCounts,
  type CardGroup,
  type ClozeKey,
  type ClozeMade,
  type ClozeStart,
  type DocumentId,
  type DocumentKey,
  type TagKey,
  type WordKey,
  type Paginated,
  type Due,
  type DocumentSummary,
  type AvailableTag,
  type DocumentUpdate,
  type ImportRequest,
  type Lang,
  type LemmaId,
  type NewClozeInput,
  type Rating,
  type ListedReading,
  type ReadingEntry,
  type ReadingKey,
  type ReadingPosition,
  type ReadingNames,
  type ReadingStatus,
  type Reviewed,
  type Settings,
  type User,
  type Word,
  type WordStatus,
} from "@skolia/shared/api";
import { allPages, type Cursor } from "@skolia/shared/page";
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

/** A 401 on a page of a list of the user's, for listOwn. */
class SignedOut extends Error {}

/** Every page of a list of the signed-in user's, or null when signed out. */
async function listOwn<T, K>(fetchPage: (after: Cursor<K> | undefined) => Promise<Paginated<T, K>>): Promise<readonly T[] | null> {
  try {
    return await allPages(fetchPage);
  } catch (error) {
    if (error instanceof SignedOut) return null;
    throw error;
  }
}

/** Which documents Explore lists. tags: kind:value, any of one kind, all of the kinds. */
export type DocumentQuery = {
  readonly lang: Lang | undefined;
  readonly title: string;
  readonly mine: boolean;
  readonly tags: readonly string[];
};

/** A page of the documents the query keeps, from the start or after a page's next. */
export async function listDocuments(
  { lang, title, mine, tags }: DocumentQuery,
  after?: Cursor<DocumentKey>,
): Promise<Paginated<DocumentSummary, DocumentKey>> {
  const response = await api.documents.$get({
    query: { after, lang, q: title.trim() || undefined, mine: mine ? "true" : undefined, tag: [...tags] },
  });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The tags that can be given. */
export function listTags(): Promise<readonly AvailableTag[]> {
  return allPages(async (after?: Cursor<TagKey>) => {
    const response = await api.tags.$get({ query: { after, limit: String(TAG_PAGE.max) } });
    if (!response.ok) throw await failure(response);
    return response.json();
  });
}

export async function getDocument(id: DocumentId): Promise<DocumentSummary> {
  const response = await api.documents[":id"].$get({ param: { id } });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The text as uploaded, to show before its analysis is ready. */
export async function getText(id: DocumentId): Promise<string> {
  const response = await api.documents[":id"].text.$get({ param: { id } });
  if (!response.ok) throw await failure(response);
  return response.text();
}

export async function importDocument(body: ImportRequest): Promise<DocumentSummary> {
  const response = await api.documents.$post({ json: body });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function updateDocument(id: DocumentId, update: DocumentUpdate): Promise<DocumentSummary> {
  const response = await api.documents[":id"].$patch({ param: { id }, json: update });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function deleteDocument(id: DocumentId): Promise<void> {
  const response = await api.documents[":id"].$delete({ param: { id } });
  if (!response.ok) throw await failure(response);
}

/** Every annotation of the entry the viewer sees for the text. */
export function listAnnotations(id: DocumentId): Promise<readonly Annotation[]> {
  return allPages(async (after?: Cursor<AnnotationKey>) => {
    const response = await api.documents[":id"].annotations.$get({
      param: { id },
      query: { after, limit: String(ANNOTATION_PAGE.max) },
    });
    if (!response.ok) throw await failure(response);
    return response.json();
  });
}

/** The reading by name, or "unsupported" when its schema is newer than this reader
 * knows (an API deployed ahead of the reader) or its language isn't one it has. Older
 * schemas are read: documents keep theirs until ingest redoes them. */
export async function loadReading(id: DocumentId, names: ReadingNames): Promise<Reading | "unsupported"> {
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
export function listWords(): Promise<readonly Word[] | null> {
  return listOwn(async (after?: Cursor<WordKey>) => {
    const response = await api.me.words.$get({ query: { after, limit: String(WORD_PAGE.max) } });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw await failure(response);
    return response.json();
  });
}

export async function setWord(lemmaId: LemmaId, status: WordStatus): Promise<void> {
  const response = await api.me.words[":lemmaId"].$put({ param: { lemmaId: lemmaParam(lemmaId) }, json: { status } });
  if (!response.ok) throw await failure(response);
}

/** Takes the word's status away, and its cards out of reviews, keeping their history. */
export async function clearWordStatus(lemmaId: LemmaId): Promise<void> {
  const response = await api.me.words[":lemmaId"].$delete({ param: { lemmaId: lemmaParam(lemmaId) } });
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

/** A language's cards to review: one group's, or with no group both. */
export async function dueCards(lang: Lang, group: CardGroup | null, now = new Date()): Promise<Due | null> {
  const dayStart = dayStartOf(now);
  const response = await api.me.cards.due.$get({ query: group ? { lang, dayStart, group } : { lang, dayStart } });
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

/** A cloze card for the word in the sentence, or the one it already has. */
export async function makeCloze(json: NewClozeInput): Promise<ClozeMade> {
  const response = await api.me.clozes.$post({ json });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The user's cloze cards from a text, or null when signed out. */
export function listClozes(documentId: DocumentId): Promise<readonly ClozeStart[] | null> {
  return listOwn(async (after?: Cursor<ClozeKey>) => {
    const response = await api.me.clozes.$get({ query: { documentId, after, limit: String(CLOZE_PAGE.max) } });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw await failure(response);
    return response.json();
  });
}

export async function deleteCloze(cardId: string): Promise<void> {
  const response = await api.me.clozes[":cardId"].$delete({ param: { cardId } });
  if (!response.ok) throw await failure(response);
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
export async function getPosition(id: DocumentId): Promise<ReadingPosition | null | undefined> {
  const response = await api.me.positions[":id"].$get({ param: { id } });
  if (response.status === 401) return undefined;
  if (!response.ok) throw await failure(response);
  return (await response.json()).position;
}

/** The text's entry on the reading list, null if it isn't on it, or undefined when signed out. */
export async function getReadingEntry(id: DocumentId): Promise<ReadingEntry | null | undefined> {
  const response = await api.me["reading-list"][":id"].$get({ param: { id } });
  if (response.status === 401) return undefined;
  if (!response.ok) throw await failure(response);
  return (await response.json()).entry;
}

export async function setReadingStatus(id: DocumentId, status: ReadingStatus): Promise<ReadingEntry> {
  const response = await api.me["reading-list"][":id"].$put({ param: { id }, json: { status } });
  if (!response.ok) throw await failure(response);
  return (await response.json()).entry;
}

export async function removeFromReadingList(id: DocumentId): Promise<void> {
  const response = await api.me["reading-list"][":id"].$delete({ param: { id } });
  if (!response.ok) throw await failure(response);
}

/** A page of the texts on the reading list with the status, in the language if one is given. */
export async function listReading(
  status: ReadingStatus,
  lang: Lang | undefined,
  after?: Cursor<ReadingKey>,
): Promise<Paginated<ListedReading, ReadingKey>> {
  const response = await api.me["reading-list"].$get({ query: { status, after, ...(lang ? { lang } : {}) } });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** keepalive: the request outlives the page, for a save as it's hidden or closed. */
export async function putPosition(id: DocumentId, position: ReadingPosition, keepalive = false): Promise<void> {
  const response = await api.me.positions[":id"].$put({ param: { id }, json: position }, { init: { keepalive } });
  if (!response.ok) throw await failure(response);
}
