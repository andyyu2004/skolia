import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TEXT_LENGTH, type DocumentList, type DocumentSummary } from "@skolia/shared/api";
import { docId, partKey, statusKey, versionsKey } from "@skolia/shared/keys";
import type { IngestJob } from "@skolia/shared/schema";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { hc } from "hono/client";
import {
  type AppType,
  STUCK_AFTER_MS,
  acceptsEncoding,
  countWords,
  createApp,
  isOutdated,
  isStuck,
  nameOf,
  parseImport,
  parseImportCap,
  parseStatus,
  parseVersions,
} from "./app.ts";
import { NO_AUTH } from "./auth.ts";
import { ORIGIN, testAuth } from "./auth-testing.ts";
import type { Auth, BlobStore, DocumentRecord, DocumentStore, JobQueue, StoredBlob, UserData } from "./ports.ts";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";

class MemoryUsers implements UserData {
  readonly lemmasOf = new Map<string, Map<string, KnownLemma>>();
  async lemmas(userId: string): Promise<KnownLemma[]> {
    return [...(this.lemmasOf.get(userId)?.values() ?? [])];
  }
  async setLemma(userId: string, lemmaId: LemmaId, status: LemmaStatus, updated: string): Promise<void> {
    const lemmas = this.lemmasOf.get(userId) ?? new Map<string, KnownLemma>();
    lemmas.set(lemmaId, { lemmaId, status, updated });
    this.lemmasOf.set(userId, lemmas);
  }
}

class MemoryDocuments implements DocumentStore {
  readonly rows = new Map<string, DocumentRecord>();
  async list(): Promise<DocumentRecord[]> {
    return [...this.rows.values()];
  }
  async get(id: string): Promise<DocumentRecord | null> {
    return this.rows.get(id) ?? null;
  }
  async add(record: DocumentRecord): Promise<void> {
    if (!this.rows.has(record.id)) this.rows.set(record.id, record);
  }
  async countImportedSince(since: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.imported >= since).length;
  }
}

class MemoryBlobs implements BlobStore {
  readonly objects = new Map<string, StoredBlob>();
  async get(key: string): Promise<StoredBlob | null> {
    return this.objects.get(key) ?? null;
  }
  async put(key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string): Promise<void> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.objects.set(key, { body: bytes, contentType });
  }
}

class MemoryQueue implements JobQueue {
  readonly sent: IngestJob[] = [];
  async send(job: IngestJob): Promise<void> {
    this.sent.push(job);
  }
}

const TEXT = "Idę do starego psa.";

function setup(maxImportsPerDay = 100, auth: Auth = NO_AUTH) {
  const documents = new MemoryDocuments();
  const blobs = new MemoryBlobs();
  const queue = new MemoryQueue();
  const users = new MemoryUsers();
  const app = createApp({
    auth,
    users,
    maxImportsPerDay,
    documents,
    blobs,
    queue,
    now: () => new Date("2026-11-04T00:00:00Z"),
  });
  return { app, documents, blobs, queue, users };
}

async function setupWithAuth() {
  const auth = await testAuth();
  return { ...setup(100, auth.auth), ...auth };
}

const ALICE = { name: "Alice", email: "alice@example.com" };

function putLemma(app: ReturnType<typeof setup>["app"], headers: Headers | undefined, lemmaId: string, body: unknown) {
  const init: RequestInit = { method: "PUT", body: JSON.stringify(body) };
  init.headers = new Headers(headers);
  init.headers.set("content-type", "application/json");
  return app.request(`${ORIGIN}/api/me/lemmas/${encodeURIComponent(lemmaId)}`, init);
}

test("a signed-in user's lemma statuses are set and listed under their own id", async () => {
  const { app, users, signUp, signIn } = await setupWithAuth();
  const alice = await signUp(ALICE);
  const headers = await signIn(alice.id);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "learning" })).status, 204);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "known" })).status, 204);
  const listed = await app.request(`${ORIGIN}/api/me/lemmas`, { headers });
  assert.equal(listed.status, 200);
  const known = { lemmaId: "pl:pies:NOUN", status: "known", updated: "2026-11-04T00:00:00.000Z" };
  assert.deepEqual(await listed.json(), [known]);
  assert.deepEqual([...users.lemmasOf.keys()], [alice.id]);
});

test("lemma statuses need a session, a {lang}:{lemma}:{upos} id and a known status", async () => {
  const { app, signUp, signIn } = await setupWithAuth();
  assert.equal((await app.request(`${ORIGIN}/api/me/lemmas`)).status, 401);
  assert.equal((await putLemma(app, undefined, "pl:pies:NOUN", { status: "known" })).status, 401);
  const headers = await signIn((await signUp(ALICE)).id);
  assert.equal((await putLemma(app, headers, "pies", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "zz:pies:NOUN", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:pies:NOPE", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:i/lub:CCONJ", { status: "known" })).status, 204);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "mastered" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", null)).status, 400);
});

test("Google sign-in answers with Google's authorize URL, back to /api/auth/callback/google", async () => {
  const { app } = await setupWithAuth();
  const response = await app.request(`${ORIGIN}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ provider: "google", callbackURL: "/" }),
  });
  assert.equal(response.status, 200);
  const url = new URL(((await response.json()) as { url: string }).url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/callback/google`);
});

test("/api/me is the session's user, 401 without one", async () => {
  const { app, signUp, signIn } = await setupWithAuth();
  assert.equal((await app.request(`${ORIGIN}/api/me`)).status, 401);
  const alice = await signUp(ALICE);
  const response = await app.request(`${ORIGIN}/api/me`, { headers: await signIn(alice.id) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), alice);
});

test("after signing out the session's cookie signs nobody in", async () => {
  const { app, signUp, signIn } = await setupWithAuth();
  const headers = await signIn((await signUp(ALICE)).id);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 200);
  const out = await app.request(`${ORIGIN}/api/auth/sign-out`, {
    method: "POST",
    headers: { cookie: headers.get("cookie") ?? "", "content-type": "application/json", origin: ORIGIN },
    body: "{}",
  });
  assert.equal(out.status, 200);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 401);
});

test("an expired session signs nobody in", async () => {
  const { app, db, signUp, signIn } = await setupWithAuth();
  const headers = await signIn((await signUp(ALICE)).id);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 200);
  db.prepare(`update session set "expiresAt" = ?`).run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 401);
});

test("without its configuration sign-in answers 503 and nobody is signed in", async () => {
  const { app } = setup();
  assert.equal((await app.request(`${ORIGIN}/api/auth/sign-in/social`, { method: "POST" })).status, 503);
  assert.equal((await app.request(`${ORIGIN}/api/me`)).status, 401);
});

function importText(app: ReturnType<typeof setup>["app"], text = TEXT) {
  return app.request("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "", text, lang: "pl" }),
  });
}

test("the typed client imports, lists and gets a document, and sees a 404 as not ok", async () => {
  const { app } = setup();
  const api = hc<AppType>(ORIGIN, { fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init) }).api;
  const imported = await api.documents.$post({ json: { title: "", text: TEXT, lang: "pl" } });
  assert.equal(imported.status, 202);
  if (!imported.ok) throw new Error("import failed");
  const { id } = await imported.json();
  const listed = await api.documents.$get();
  assert.ok(listed.ok);
  assert.deepEqual((await listed.json()).documents.map((d) => d.id), [id]);
  const got = await api.documents[":id"].$get({ param: { id } });
  assert.ok(got.ok);
  assert.equal((await got.json()).id, id);
  const missing = await api.documents[":id"].$get({ param: { id: "0".repeat(64) } });
  assert.equal(missing.status, 404);
  assert.equal(missing.ok, false);
});

test("import stores the text, queues a job and reports queued", async () => {
  const { app, blobs, queue } = setup();
  const response = await importText(app);
  assert.equal(response.status, 202);
  const summary = (await response.json()) as DocumentSummary;
  const id = await docId(TEXT);
  assert.equal(summary.id, id);
  assert.equal(summary.state, "queued");
  assert.equal(summary.title, "Idę do starego psa.");
  assert.equal(summary.words, 4);
  assert.deepEqual(queue.sent, [{ doc: id, lang: "pl" }]);
  assert.ok(blobs.objects.has(`doc/${id}/text.txt`));
});

test("importing the same text again doesn't queue it twice, unless it failed", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const again = await importText(app);
  assert.equal(again.status, 200);
  assert.equal(queue.sent.length, 1);
  const id = await docId(TEXT);
  await blobs.put(statusKey(id), JSON.stringify({ state: "failed", updated: "x", error: "boom" }), "application/json");
  const retry = await importText(app);
  assert.equal(retry.status, 202);
  assert.equal(queue.sent.length, 2);
});

const NOW = "2026-11-04T00:00:00Z";

/** A ready document whose analysis and bundle were made by version v, as ingest leaves it. */
async function readyAt(blobs: MemoryBlobs, id: string, v: string, state = "ready"): Promise<void> {
  for (const [part, name] of [["analysis", `s2-a${v}`], ["bundle", `b1-a${v}-l1`]] as const) {
    blobs.objects.set(partKey(id, part, name), {
      body: brotliCompressSync(`{"${part}":"${v}"}`),
      contentType: "application/json",
    });
  }
  const status = {
    state,
    updated: NOW,
    analyzer: `pl/${v}`,
    lexicon: "lex/1",
    analysis: partKey(id, "analysis", `s2-a${v}`),
    bundle: partKey(id, "bundle", `b1-a${v}-l1`),
  };
  await blobs.put(statusKey(id), JSON.stringify(status), "application/json");
}

async function publish(blobs: MemoryBlobs, v: string): Promise<void> {
  const versions = { analyzer: `pl/${v}`, lexicon: "lex/1", analysis: `s2-a${v}`, bundle: `b1-a${v}-l1` };
  await blobs.put(versionsKey("pl"), JSON.stringify(versions), "application/json");
}

async function summaryOf(app: ReturnType<typeof setup>["app"], id: string): Promise<DocumentSummary> {
  return (await (await app.request(`/api/documents/${id}`)).json()) as DocumentSummary;
}

test("brotli blobs are sent as stored when accepted, refused otherwise, cached forever", async () => {
  const { app, blobs } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "1");
  const json = '{"bundle":"1"}';
  const url = `/api/documents/${id}/bundle/b1-a1-l1`;
  const accepted = await app.request(url, { headers: { "accept-encoding": "gzip, br" } });
  assert.equal(accepted.headers.get("content-encoding"), "br");
  assert.equal(accepted.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(brotliDecompressSync(new Uint8Array(await accepted.arrayBuffer())).toString(), json);
  const plain = await app.request(url, { headers: { "accept-encoding": "gzip" } });
  assert.equal(plain.status, 406);
});

test("new texts past the daily cap are refused; texts already here still open", async () => {
  const { app, queue } = setup(2);
  assert.equal((await importText(app, "Pierwszy tekst.")).status, 202);
  assert.equal((await importText(app, "Drugi tekst.")).status, 202);
  const refused = await importText(app, "Trzeci tekst.");
  assert.equal(refused.status, 429);
  assert.match(((await refused.json()) as { error: string }).error, /tomorrow/);
  assert.equal((await importText(app, "Pierwszy tekst.")).status, 200);
  assert.equal(queue.sent.length, 2);
});

test("the import cap must be a whole number", () => {
  assert.equal(parseImportCap("50"), 50);
  assert.equal(parseImportCap(" 0 "), 0);
  assert.equal(parseImportCap(undefined), null);
  assert.equal(parseImportCap("-1"), null);
  assert.equal(parseImportCap("lots"), null);
});

test("texts over the limit are refused, oversized bodies without being parsed", async () => {
  const { app, queue } = setup();
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH + 1))).status, 400);
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH * 10))).status, 413);
  assert.equal(queue.sent.length, 0);
});

test("accept-encoding parsing", () => {
  assert.equal(acceptsEncoding("gzip, deflate, br, zstd", "br"), true);
  assert.equal(acceptsEncoding("br;q=0", "br"), false);
  assert.equal(acceptsEncoding("*", "br"), true);
  assert.equal(acceptsEncoding("gzip", "br"), false);
  assert.equal(acceptsEncoding(undefined, "br"), false);
});

test("the summary names the reading once there is one, and it's served by name", async () => {
  const { app, blobs } = setup();
  await importText(app);
  const id = await docId(TEXT);
  assert.equal((await summaryOf(app, id)).reading, undefined);
  await readyAt(blobs, id, "1");
  const summary = await summaryOf(app, id);
  assert.deepEqual(summary.reading, { analysis: "s2-a1", bundle: "b1-a1-l1" });
  const analysis = await app.request(`/api/documents/${id}/analysis/s2-a1`, {
    headers: { "accept-encoding": "br" },
  });
  assert.equal(analysis.status, 200);
  assert.equal(
    brotliDecompressSync(Buffer.from(await analysis.arrayBuffer())).toString(),
    '{"analysis":"1"}',
  );
  assert.equal((await app.request(`/api/documents/${id}/analysis/s2-a9`)).status, 404);
  assert.equal((await app.request(`/api/documents/${id}/analysis/..%2Fstatus`)).status, 404);
  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(
    list.documents.map((d) => d.state),
    ["ready"],
  );
});

test("an outdated document is queued once, and its old reading is kept meanwhile", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "1");
  await publish(blobs, "2");
  queue.sent.length = 0;

  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(
    list.documents.map((d) => [d.state, d.reading?.analysis]),
    [["queued", "s2-a1"]],
  );
  assert.deepEqual(queue.sent, [{ doc: id, lang: "pl" }]);
  // Already queued: opening it again doesn't queue it twice
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 1);
});

test("a bundle of another shape is out of date even if the analyser is the same", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "1");
  const versions = { analyzer: "pl/1", lexicon: "lex/1", analysis: "s2-a1", bundle: "b2-a1-l1" };
  await blobs.put(versionsKey("pl"), JSON.stringify(versions), "application/json");
  queue.sent.length = 0;
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 1);
});

test("a current document isn't queued, nor any before ingest publishes its versions", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "2");
  queue.sent.length = 0;
  await app.request("/api/documents");
  assert.equal(queue.sent.length, 0);
  await publish(blobs, "2");
  assert.equal((await summaryOf(app, id)).state, "ready");
  assert.equal(queue.sent.length, 0);
});

test("a document queued or analysing for too long is queued again", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  queue.sent.length = 0;
  // Just queued (by the import, at NOW): left alone
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 0);
  const lost = { state: "analysing", updated: "2026-11-03T23:00:00Z" };
  await blobs.put(statusKey(id), JSON.stringify(lost), "application/json");
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 1);
});

test("stuck and outdated rules", () => {
  const at = new Date(NOW);
  const old = new Date(at.getTime() - STUCK_AFTER_MS - 1).toISOString();
  assert.equal(isStuck({ state: "queued", updated: NOW }, at), false);
  assert.equal(isStuck({ state: "queued", updated: old }, at), true);
  assert.equal(isStuck({ state: "ready", updated: old }, at), false);
  assert.equal(isStuck({ state: "analysing", updated: "garbage" }, at), true);
  assert.equal(nameOf("doc/x/analysis/s2-a1.json.br"), "s2-a1");
  assert.equal(nameOf(undefined), undefined);
  const latest = { analyzer: "a", lexicon: "l", analysis: "s2-a1", bundle: "b1-a1-l1" };
  const ready = { state: "ready", updated: NOW, analysis: "d/analysis/s2-a1.json.br", bundle: "d/bundle/b1-a1-l1.json.br" } as const;
  assert.equal(isOutdated(ready, latest), false);
  assert.equal(isOutdated(ready, { ...latest, analysis: "s3-a1" }), true);
  assert.equal(isOutdated(ready, null), false);
  assert.equal(isOutdated({ ...ready, state: "failed" }, { ...latest, analysis: "s3-a1" }), false);
});

test("versions parsing ignores malformed blobs", () => {
  const versions = { analyzer: "a", lexicon: "l", analysis: "s2-a1", bundle: "b1-a1-l1" };
  assert.deepEqual(parseVersions(JSON.stringify(versions)), versions);
  assert.equal(parseVersions('{"analyzer":"a","lexicon":"l"}'), null);
  assert.equal(parseVersions("nope"), null);
});

test("bad requests and ids are rejected", async () => {
  const { app } = setup();
  assert.equal((await importText(app, "   ")).status, 400);
  assert.equal((await app.request("/api/documents/../etc")).status, 404);
  assert.equal((await app.request(`/api/documents/${"0".repeat(64)}`)).status, 404);
  assert.equal(typeof parseImport({ text: "x", lang: "de" }), "string");
});

test("status parsing ignores malformed blobs", () => {
  assert.equal(parseStatus("not json"), null);
  assert.equal(parseStatus(JSON.stringify({ state: "done", updated: "x" })), null);
  assert.deepEqual(parseStatus(JSON.stringify({ state: "ready", updated: "x", bundle: 3 })), {
    state: "ready",
    updated: "x",
  });
});

test("words are counted as runs containing letters", () => {
  assert.equal(countWords("Idę do psa — 12 razy."), 4);
});
