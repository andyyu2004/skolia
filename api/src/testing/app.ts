import { after, before, beforeEach } from "node:test";
import { brotliCompressSync } from "node:zlib";
import type { DocumentList, DocumentSummary } from "@skolia/shared/api";
import { partKey, statusKey, versionsKey } from "@skolia/shared/keys";
import { createApp } from "../app.ts";
import type { Auth } from "../ports.ts";
import { CloudflareQueue, D1Documents, DurableObjectUsers, R2Blobs } from "../worker/adapters.ts";
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

export function setup({ maxImportsPerDay = 100, auth = local.auth }: { maxImportsPerDay?: number; auth?: Auth } = {}) {
  const { env } = local;
  return createApp({
    auth,
    users: new DurableObjectUsers(env.USER),
    maxImportsPerDay,
    documents: new D1Documents(env.DB),
    blobs: new R2Blobs(env.BLOBS),
    queue: new CloudflareQueue(env.INGEST),
    version: "v1.2.3",
    now: () => new Date(NOW),
  });
}

export type App = ReturnType<typeof setup>;

export function putJson(key: string, value: unknown): Promise<void> {
  return new R2Blobs(local.env.BLOBS).put(key, JSON.stringify(value), "application/json");
}

export function putLemma(app: App, headers: Headers | undefined, lemmaId: string, body: unknown) {
  const allHeaders = new Headers(headers);
  allHeaders.set("content-type", "application/json");
  return app.request(`${ORIGIN}/api/me/lemmas/${encodeURIComponent(lemmaId)}`, {
    method: "PUT",
    headers: allHeaders,
    body: JSON.stringify(body),
  });
}

export function importText(app: App, text = TEXT, { headers = importer, visibility }: { headers?: HeadersInit; visibility?: string } = {}) {
  const allHeaders = new Headers(headers);
  allHeaders.set("content-type", "application/json");
  return app.request(`${ORIGIN}/api/documents`, {
    method: "POST",
    headers: allHeaders,
    body: JSON.stringify({ title: "", text, lang: "pl", visibility }),
  });
}

export async function listed(app: App, headers: HeadersInit = {}): Promise<string[]> {
  const response = await app.request(`${ORIGIN}/api/documents`, { headers });
  return ((await response.json()) as DocumentList).documents.map((d) => d.id);
}

/** A ready document whose analysis and bundle were made by version v, as ingest leaves it. */
export async function readyAt(id: string, v: string, state = "ready"): Promise<void> {
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
