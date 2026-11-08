import { after, before, beforeEach } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { hc } from "hono/client";
import type { DocumentId, DocumentList, DocumentSummary, Lang } from "@skolia/shared/api";
import { partKey, statusKey, versionsKey } from "@skolia/shared/keys";
import { createApp, type AppType } from "../app.ts";
import type { Auth } from "../ports.ts";
import { CloudflareQueue, D1Documents, D1Lexicon, DurableObjectUsers, R2Blobs, lexiconsOf } from "../worker/adapters.ts";
import { ORIGIN, startLocal, type Local } from "./harness.ts";

export let local: Local;

/** Signed in as the user who imports in importText. */
export let importer: Headers;

export function useLocal(): void {
  before(async () => {
    local = await startLocal();
  });
  beforeEach(async () => {
    await local.reset();
    importer = await local.signIn((await local.signUp({ name: "Ivy", email: "ivy@example.com" })).id);
  });
  after(() => local?.close());
}

export const NOW = "2026-11-04T00:00:00Z";
export const TEXT = "Idę do starego psa.";
export const ALICE = { name: "Alice", email: "alice@example.com" };

export function setup({ maxImportsPerDay = 100, auth = local.auth, at = NOW }: { maxImportsPerDay?: number; auth?: Auth; at?: string } = {}) {
  const { env } = local;
  return createApp({
    auth,
    users: new DurableObjectUsers(env.USER),
    lexicon: new D1Lexicon(lexiconsOf(env)),
    maxImportsPerDay,
    documents: new D1Documents(env.DB),
    blobs: new R2Blobs(env.BLOBS),
    queue: new CloudflareQueue(env.INGEST),
    version: "v1.2.3",
    now: () => new Date(at),
  });
}

export type App = ReturnType<typeof setup>;

export function putJson(key: string, value: unknown): Promise<void> {
  return new R2Blobs(local.env.BLOBS).put(key, JSON.stringify(value), "application/json");
}

/** The API's typed client (hono/client), sending to the test app, signed in with headers. */
export function client(app: App, headers?: Headers) {
  const fetch = (input: string | URL | Request, init?: RequestInit) => app.request(input, init);
  return hc<AppType>(ORIGIN, { headers: Object.fromEntries(headers ?? []), fetch }).api;
}

/** A JSON request the typed client won't send: invalid input, for the API's validation. */
export function raw(app: App, method: string, path: string, headers: Headers | undefined, body: unknown) {
  const allHeaders = new Headers(headers);
  allHeaders.set("content-type", "application/json");
  return app.request(`${ORIGIN}${path}`, { method, headers: allHeaders, body: JSON.stringify(body) });
}

/** Lexicon rows as infra/load-lexicon.py loads them, and the version that serves. */
export interface TestEntry {
  lemmaId: string;
  lemma: string;
  upos: string;
  gloss: string;
  pronunciations?: unknown[];
  /** Compact, as in D1: [{ homonym, forms: [["psa", [0, 1]]] }] */
  paradigms?: unknown[];
}

/** Loads a lexicon version with its feature sets, by id, and makes it the one served. */
export async function loadLexicon(lang: Lang, version: string, entries: TestEntry[], featureSets: Record<string, string>[] = []): Promise<void> {
  const db = lexiconsOf(local.env)[lang];
  await db.batch([
    ...entries.map((e) =>
      db
        .prepare("INSERT INTO entry (lemma_id, version, lemma, upos, senses, relations, pronunciations, paradigms) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)")
        .bind(
          e.lemmaId,
          version,
          e.lemma,
          e.upos,
          JSON.stringify([{ gloss: e.gloss, tags: [] }]),
          JSON.stringify(e.pronunciations ?? []),
          JSON.stringify(e.paradigms ?? []),
        ),
    ),
    ...featureSets.flatMap((set, id) =>
      Object.entries(set).map(([feature, value]) =>
        db.prepare("INSERT INTO featureset (version, id, feature, value) VALUES (?, ?, ?, ?)").bind(version, id, feature, value),
      ),
    ),
    db.prepare("INSERT INTO loaded (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version").bind(version),
  ]);
}

export function importText(
  app: App,
  text = TEXT,
  { headers = importer, ...fields }: { headers?: HeadersInit; visibility?: string; licence?: string; author?: string; source?: string } = {},
) {
  const allHeaders = new Headers(headers);
  allHeaders.set("content-type", "application/json");
  return app.request(`${ORIGIN}/api/documents`, {
    method: "POST",
    headers: allHeaders,
    body: JSON.stringify({ title: "", text, lang: "pl", ...fields }),
  });
}

export async function listed(app: App, headers: HeadersInit = {}): Promise<string[]> {
  const response = await app.request(`${ORIGIN}/api/documents`, { headers });
  return ((await response.json()) as DocumentList).documents.map((d) => d.id);
}

/** A ready document whose analysis and bundle were made by version v, as ingest leaves it. */
export async function readyAt(id: DocumentId, v: string, state = "ready"): Promise<void> {
  const blobs = new R2Blobs(local.env.BLOBS);
  for (const [part, name] of [["analysis", `s2-a${v}`], ["bundle", `b1-a${v}-l1`]] as const) {
    await blobs.put(partKey(id, part, name), new Uint8Array(brotliCompressSync(`{"${part}":"${v}"}`)), "application/json");
  }
  await putJson(statusKey(id), {
    state,
    updated: NOW,
    analyzer: `pl/${v}`,
    lexicon: "lex/1",
    analysis: partKey(id, "analysis", `s2-a${v}`),
    bundle: partKey(id, "bundle", `b1-a${v}-l1`),
  });
}

export function publish(v: string): Promise<void> {
  return putJson(versionsKey("pl"), { analyzer: `pl/${v}`, lexicon: "lex/1", analysis: `s2-a${v}`, bundle: `b1-a${v}-l1` });
}

export async function summaryOf(app: App, id: string): Promise<DocumentSummary> {
  return (await (await app.request(`/api/documents/${id}`)).json()) as DocumentSummary;
}
