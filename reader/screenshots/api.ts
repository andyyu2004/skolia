// The reader as built (dist/) and the API's own Hono app (createApp), both served to the
// page by page.route. The app runs on in-memory ports typed by its Deps, so the
// screenshots need no Worker, database or ingest, and a change to a port or a route's
// response fails tsc -p screenshots. The text is the start of Prus's Lalka (public
// domain), its analysis and bundle as ingest stored them.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import type { Page, Route } from "@playwright/test";
import { createApp } from "@skolia/api/app";
import type { DocumentId as DocumentIdType, Lang, LemmaId as LemmaIdType, LexiconEntry, ScheduledCard, Settings, User, UserId as UserIdType } from "@skolia/shared/api";
import { partKey, statusKey, textKey } from "@skolia/shared/keys";
import type { Bundle, Status } from "@skolia/shared/schema";
import { CardId, DocumentId, LemmaId, Timestamp, UserId } from "@skolia/shared/schemas";

type Deps = Parameters<typeof createApp>[0];
type StoredDocument = Awaited<ReturnType<Deps["documents"]["list"]>>[number];
type StoredBlob = NonNullable<Awaited<ReturnType<Deps["blobs"]["get"]>>>;

const DIST = join(import.meta.dirname, "..", "dist");
const FIXTURES = join(import.meta.dirname, "fixtures");

const NOW = new Date("2026-11-09T10:00:00Z");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const bundle = JSON.parse(fixture("lalka.bundle.json").toString("utf8")) as Bundle;

export const LALKA = DocumentId.parse("121e58375c32bad22cee4888347e0b0003e5594199043db745303749a87c988c");

export const user: User = {
  id: UserId.parse("user-1"),
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  type: "standard",
};

const SKOLIA = UserId.parse("skolia");
const ANALYSIS = partKey(LALKA, "analysis", "s2-ac973bfbdb066");
const BUNDLE = partKey(LALKA, "bundle", "b1-v2-ac973bfbdb066-l5da30b8a5747");

const lalka: StoredDocument = {
  id: LALKA,
  title: "Lalka",
  lang: "pl",
  imported: Timestamp.parse("2026-11-07T09:58:00.000Z"),
  words: 72,
  user: user.id,
  importerName: user.name,
  visibility: "public",
  licence: "public-domain",
  author: "Bolesław Prus",
  source: "https://wolnelektury.pl/katalog/lektura/lalka-tom-pierwszy.html",
  tags: { level: "C1" },
};

function stored(n: number, fields: Partial<StoredDocument>): StoredDocument {
  return { ...lalka, id: DocumentId.parse(String(n).repeat(64)), user: SKOLIA, importerName: "skolia", ...fields };
}

const PETIT_PRINCE = stored(1, { title: "Le Petit Prince, chapitre I", lang: "fr", licence: "cc-by-sa", author: "Antoine de Saint-Exupéry", words: 412, tags: { level: "B1" } });
const NOTATKI = stored(2, { title: "Notatki", visibility: "private", licence: "cc-by", author: null, user: user.id, importerName: user.name, words: 38, tags: {} });
const PETER_RABBIT = stored(3, { title: "The Tale of Peter Rabbit", lang: "en", author: "Beatrix Potter", words: 951, tags: { level: "A2" } });

/** Explore's list: one of each badge and licence the listing shows. */
const documents: readonly StoredDocument[] = [lalka, PETIT_PRINCE, NOTATKI, PETER_RABBIT];

const statuses: readonly (readonly [DocumentIdType, Status])[] = [
  [LALKA, { state: "ready", updated: "2026-11-07T10:00:00.000Z", analysis: ANALYSIS, bundle: BUNDLE }],
  [PETIT_PRINCE.id, { state: "ready", updated: "2026-11-07T10:00:00.000Z" }],
  [NOTATKI.id, { state: "queued", updated: "2026-11-09T09:55:00.000Z" }],
  [PETER_RABBIT.id, { state: "failed", updated: "2026-11-08T10:00:00.000Z", error: "The analyser stopped" }],
];

const JSON_TYPE = "application/json";

/** The blobs as ingest stores them: analyses and bundles Brotli-compressed. */
const blobs: ReadonlyMap<string, StoredBlob> = new Map([
  [textKey(LALKA), { body: new Uint8Array(fixture("lalka.txt")), contentType: "text/plain; charset=utf-8" }],
  [ANALYSIS, { body: new Uint8Array(brotliCompressSync(fixture("lalka.analysis.json"))), contentType: JSON_TYPE }],
  [BUNDLE, { body: new Uint8Array(brotliCompressSync(fixture("lalka.bundle.json"))), contentType: JSON_TYPE }],
  ...statuses.map(([id, status]) => [statusKey(id), { body: new TextEncoder().encode(JSON.stringify(status)), contentType: JSON_TYPE }] as const),
]);

function entry(lemmaId: LemmaIdType): LexiconEntry | null {
  const found = bundle.entries[lemmaId];
  if (!found) return null;
  return { lemmaId, lemma: found.lemma, upos: found.upos, senses: found.senses, relations: found.relations, pronunciations: [], paradigms: found.paradigms };
}

const featureSets = Object.fromEntries(bundle.feats.map((feats, id) => [String(id), feats]));

const cards: readonly ScheduledCard[] = [
  { id: CardId.parse("00000000-0000-4000-8000-000000000001"), lemmaId: LemmaId.parse("pl:sklep:NOUN"), kind: "recognition", isNew: false, dueAt: Timestamp.parse("2026-11-09T08:00:00.000Z") },
  { id: CardId.parse("00000000-0000-4000-8000-000000000002"), lemmaId: LemmaId.parse("pl:wojna:NOUN"), kind: "production", isNew: true, dueAt: Timestamp.parse("2026-11-09T08:00:00.000Z") },
];

/** The API's ports, in memory, for one test. Writes the pages make are accepted and
 * forgotten, except settings. */
function deps(signedIn: boolean): Deps {
  const visible = (viewer: UserIdType | null) => documents.filter((d) => d.visibility === "public" || d.user === viewer);
  let settings: Settings = { newPerDay: 10 };
  return {
    auth: {
      handle: async () => new Response(null, { status: 404 }),
      user: async () => (signedIn ? user : null),
    },
    users: {
      words: async () => [],
      setWord: async () => {},
      due: async (_userId, lang: Lang) => ({ cards: lang === "pl" ? [...cards] : [], newLeft: 4 }),
      counts: async () => [{ lang: "pl", due: 2, new: 5 }],
      review: async (_userId, request) => ({ kind: "reviewed", cardId: request.cardId, dueAt: Timestamp.parse("2026-11-10T10:00:00.000Z") }),
      settings: async () => settings,
      setSettings: async (_userId, next) => {
        settings = next;
      },
      position: async () => null,
      setPosition: async () => {},
    },
    lexicon: {
      entries: async (ids) => ({ entries: ids.flatMap((id) => entry(id) ?? []), featureSets: { pl: featureSets } }),
    },
    documents: {
      list: async (viewer) => visible(viewer),
      importedBy: async (userId) => documents.filter((d) => d.user === userId),
      visible: async (id, viewer) => visible(viewer).find((d) => d.id === id) ?? null,
      has: async (id) => documents.some((d) => d.id === id),
      add: async () => {},
      update: async () => {},
      remove: async () => {},
    },
    blobs: {
      get: async (key) => blobs.get(key) ?? null,
      put: async () => {},
    },
    queue: {
      send: async () => {},
      jobs: async () => ({ loading: false, running: [], waiting: [NOTATKI.id] }),
    },
    version: "screenshots",
    now: () => NOW,
  };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

/** Hands the request to the app. The browser adds Accept-Encoding after interception, so
 * it's added here; a Brotli body is decompressed here, as the browser would, since a
 * fulfilled response's body is taken as already decoded. */
async function forward(route: Route, app: ReturnType<typeof createApp>, failed: string[]): Promise<void> {
  const request = route.request();
  const body = request.postDataBuffer();
  const response = await app.request(request.url(), { method: request.method(), headers: { "accept-encoding": "gzip, deflate, br", ...(await request.allHeaders()) }, ...(body ? { body: new Uint8Array(body) } : {}) });
  const { pathname } = new URL(request.url());
  if (response.status >= 400 && response.status !== 401) failed.push(`${request.method()} ${pathname}: ${response.status}`);
  const headers = Object.fromEntries(response.headers);
  const raw = Buffer.from(await response.arrayBuffer());
  const decoded = headers["content-encoding"] === "br" ? brotliDecompressSync(raw) : raw;
  delete headers["content-encoding"];
  delete headers["content-length"];
  await route.fulfill({ status: response.status, headers, body: decoded });
}

/** Serves the reader and the API to the page; returns the API requests that failed
 * (other than 401s), for the test to check are none. */
export async function serve(page: Page, { signedIn }: { signedIn: boolean }): Promise<string[]> {
  const app = createApp(deps(signedIn));
  const failed: string[] = [];
  await page.clock.setFixedTime(NOW);
  await page.route("http://skolia.test/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith("/api/")) return forward(route, app, failed);
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    await route.fulfill({ status: 200, contentType: type, body: readFileSync(join(DIST, file)) });
  });
  return failed;
}
