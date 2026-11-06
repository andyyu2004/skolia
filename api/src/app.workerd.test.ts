import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { hc } from "hono/client";
import { getMigrations } from "better-auth/db/migration";
import { MAX_TEXT_LENGTH, type DocumentList, type DocumentSummary } from "@skolia/shared/api";
import { docId, partKey, statusKey, textKey, versionsKey } from "@skolia/shared/keys";
import { type AppType, createApp } from "./app.ts";
import { NO_AUTH, authOptions, createAuth } from "./auth.ts";
import type { Auth } from "./ports.ts";
import { ORIGIN, authConfig, startLocal, type Local } from "./testing/harness.ts";
import { CloudflareQueue, D1Documents, DurableObjectUsers, R2Blobs } from "./worker/adapters.ts";

let local: Local;

before(async () => {
  local = await startLocal();
});
beforeEach(() => local.reset());
after(() => local?.close());

const NOW = "2026-11-04T00:00:00Z";
const TEXT = "Idę do starego psa.";
const ALICE = { name: "Alice", email: "alice@example.com" };

function setup({ maxImportsPerDay = 100, auth = local.auth }: { maxImportsPerDay?: number; auth?: Auth } = {}) {
  const { env } = local;
  return createApp({
    auth,
    users: new DurableObjectUsers(env.USER),
    maxImportsPerDay,
    documents: new D1Documents(env.DB),
    blobs: new R2Blobs(env.BLOBS),
    queue: new CloudflareQueue(env.INGEST),
    now: () => new Date(NOW),
  });
}

type App = ReturnType<typeof setup>;

function putJson(key: string, value: unknown): Promise<void> {
  return new R2Blobs(local.env.BLOBS).put(key, JSON.stringify(value), "application/json");
}

function putLemma(app: App, headers: Headers | undefined, lemmaId: string, body: unknown) {
  const allHeaders = new Headers(headers);
  allHeaders.set("content-type", "application/json");
  return app.request(`${ORIGIN}/api/me/lemmas/${encodeURIComponent(lemmaId)}`, {
    method: "PUT",
    headers: allHeaders,
    body: JSON.stringify(body),
  });
}

function importText(app: App, text = TEXT) {
  return app.request("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "", text, lang: "pl" }),
  });
}

/** A ready document whose analysis and bundle were made by version v, as ingest leaves it. */
async function readyAt(id: string, v: string, state = "ready"): Promise<void> {
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

function publish(v: string): Promise<void> {
  return putJson(versionsKey("pl"), { analyzer: `pl/${v}`, lexicon: "lex/1", analysis: `s2-a${v}`, bundle: `b1-a${v}-l1` });
}

async function summaryOf(app: App, id: string): Promise<DocumentSummary> {
  return (await (await app.request(`/api/documents/${id}`)).json()) as DocumentSummary;
}

test("the D1 migrations make every table and column Better Auth expects", async () => {
  const { toBeCreated, toBeAdded } = await getMigrations(authOptions(authConfig(local.env.DB)));
  assert.deepEqual(toBeCreated, []);
  assert.deepEqual(toBeAdded, []);
});

test("every D1 table is STRICT, and timestamps must be toISOString()'s", async () => {
  const { env } = local;
  const { results } = await env.DB.prepare(
    "select name, strict from pragma_table_list where schema = 'main' and name not like 'sqlite_%' and name not like '_cf_%' and name != 'd1_migrations' order by name",
  ).all();
  assert.deepEqual(results, ["account", "document", "session", "user", "verification"].map((name) => ({ name, strict: 1 })));
  const insert = env.DB.prepare("insert into document (id, title, lang, imported, words) values (?, 't', 'pl', ?, 1)");
  await insert.bind("a", "2026-11-07T00:00:00.000Z").run();
  for (const imported of ["2026-11-07T00:00:00Z", "2026-11-07 00:00:00", "yesterday"]) {
    await assert.rejects(insert.bind("b", imported).run(), /CHECK constraint failed/);
  }
  await assert.rejects(env.DB.prepare("insert into document values ('c', 't', 'pl', '2026-11-07T00:00:00.000Z', 'many')").run(), /cannot store TEXT/);
});

test("a forged session cookie signs nobody in", async () => {
  const auth = createAuth(authConfig(local.env.DB));
  assert.equal(await auth.user(new Headers()), null);
  assert.equal(await auth.user(new Headers({ cookie: "better-auth.session_token=forged" })), null);
});

test("a signed-in user's lemma statuses are set and listed, in their own Durable Object", async () => {
  const app = setup();
  const alice = await local.signUp(ALICE);
  const headers = await local.signIn(alice.id);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "learning" })).status, 204);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "known" })).status, 204);
  const listed = await app.request(`${ORIGIN}/api/me/lemmas`, { headers });
  assert.equal(listed.status, 200);
  const known = [{ lemmaId: "pl:pies:NOUN", status: "known", updated: "2026-11-04T00:00:00.000Z" }];
  assert.deepEqual(await listed.json(), known);
  assert.deepEqual(await local.env.USER.getByName(alice.id).lemmas(), known);
});

test("lemma statuses need a session, a {lang}:{lemma}:{upos} id and a known status", async () => {
  const app = setup();
  assert.equal((await app.request(`${ORIGIN}/api/me/lemmas`)).status, 401);
  assert.equal((await putLemma(app, undefined, "pl:pies:NOUN", { status: "known" })).status, 401);
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await putLemma(app, headers, "pies", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "zz:pies:NOUN", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:pies:NOPE", { status: "known" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:i/lub:CCONJ", { status: "known" })).status, 204);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", { status: "mastered" })).status, 400);
  assert.equal((await putLemma(app, headers, "pl:pies:NOUN", null)).status, 400);
});

test("Google sign-in answers with Google's authorize URL, back to /api/auth/callback/google", async () => {
  const response = await setup().request(`${ORIGIN}/api/auth/sign-in/social`, {
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
  const app = setup();
  assert.equal((await app.request(`${ORIGIN}/api/me`)).status, 401);
  const alice = await local.signUp(ALICE);
  const response = await app.request(`${ORIGIN}/api/me`, { headers: await local.signIn(alice.id) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), alice);
});

test("after signing out the session's cookie signs nobody in", async () => {
  const app = setup();
  const headers = await local.signIn((await local.signUp(ALICE)).id);
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
  const app = setup();
  const headers = await local.signIn((await local.signUp(ALICE)).id);
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 200);
  const expired = new Date(Date.now() - 1000).toISOString();
  await local.env.DB.prepare(`update session set "expiresAt" = ?`).bind(expired).run();
  assert.equal((await app.request(`${ORIGIN}/api/me`, { headers })).status, 401);
});

test("without its configuration sign-in answers 503 and nobody is signed in", async () => {
  const app = setup({ auth: NO_AUTH });
  assert.equal((await app.request(`${ORIGIN}/api/auth/sign-in/social`, { method: "POST" })).status, 503);
  assert.equal((await app.request(`${ORIGIN}/api/me`)).status, 401);
});

test("the typed client imports, lists and gets a document, and sees a 404 as not ok", async () => {
  const app = setup();
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
  const app = setup();
  const response = await importText(app);
  assert.equal(response.status, 202);
  const summary = (await response.json()) as DocumentSummary;
  const id = await docId("pl", TEXT);
  assert.equal(summary.id, id);
  assert.equal(summary.state, "queued");
  assert.equal(summary.title, "Idę do starego psa.");
  assert.equal(summary.words, 4);
  assert.deepEqual(await local.takeQueued(), [{ doc: id, lang: "pl" }]);
  assert.equal(await (await local.env.BLOBS.get(textKey(id)))?.text(), TEXT);
});

test("importing the same text again doesn't queue it twice, unless it failed", async () => {
  const app = setup();
  await importText(app);
  const again = await importText(app);
  assert.equal(again.status, 200);
  assert.equal((await local.takeQueued()).length, 1);
  await putJson(statusKey(await docId("pl", TEXT)), { state: "failed", updated: "x", error: "boom" });
  const retry = await importText(app);
  assert.equal(retry.status, 202);
  assert.equal((await local.takeQueued()).length, 1);
});

test("brotli blobs are sent as stored when accepted, refused otherwise, cached forever", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  const url = `/api/documents/${id}/bundle/b1-a1-l1`;
  const accepted = await app.request(url, { headers: { "accept-encoding": "gzip, br" } });
  assert.equal(accepted.headers.get("content-encoding"), "br");
  assert.equal(accepted.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(brotliDecompressSync(new Uint8Array(await accepted.arrayBuffer())).toString(), '{"bundle":"1"}');
  const plain = await app.request(url, { headers: { "accept-encoding": "gzip" } });
  assert.equal(plain.status, 406);
});

test("new texts past the daily cap are refused; texts already here still open", async () => {
  const app = setup({ maxImportsPerDay: 2 });
  assert.equal((await importText(app, "Pierwszy tekst.")).status, 202);
  assert.equal((await importText(app, "Drugi tekst.")).status, 202);
  const refused = await importText(app, "Trzeci tekst.");
  assert.equal(refused.status, 429);
  assert.match(((await refused.json()) as { error: string }).error, /tomorrow/);
  assert.equal((await importText(app, "Pierwszy tekst.")).status, 200);
  assert.equal((await local.takeQueued()).length, 2);
});

test("texts over the limit are refused, oversized bodies without being parsed", async () => {
  const app = setup();
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH + 1))).status, 400);
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH * 10))).status, 413);
  assert.deepEqual(await local.takeQueued(), []);
});

test("the summary names the reading once there is one, and it's served by name", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  assert.equal((await summaryOf(app, id)).reading, undefined);
  await readyAt(id, "1");
  assert.deepEqual((await summaryOf(app, id)).reading, { analysis: "s2-a1", bundle: "b1-a1-l1" });
  const analysis = await app.request(`/api/documents/${id}/analysis/s2-a1`, { headers: { "accept-encoding": "br" } });
  assert.equal(analysis.status, 200);
  assert.equal(brotliDecompressSync(Buffer.from(await analysis.arrayBuffer())).toString(), '{"analysis":"1"}');
  assert.equal((await app.request(`/api/documents/${id}/analysis/s2-a9`)).status, 404);
  assert.equal((await app.request(`/api/documents/${id}/analysis/..%2Fstatus`)).status, 404);
  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(list.documents.map((d) => d.state), ["ready"]);
});

test("an outdated document is queued once, and its old reading is kept meanwhile", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  await publish("2");
  await local.takeQueued();

  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(list.documents.map((d) => [d.state, d.reading?.analysis]), [["queued", "s2-a1"]]);
  assert.deepEqual(await local.takeQueued(), [{ doc: id, lang: "pl" }]);
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.deepEqual(await local.takeQueued(), []);
});

test("a bundle of another shape is out of date even if the analyser is the same", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  await putJson(versionsKey("pl"), { analyzer: "pl/1", lexicon: "lex/1", analysis: "s2-a1", bundle: "b2-a1-l1" });
  await local.takeQueued();
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal((await local.takeQueued()).length, 1);
});

test("a current document isn't queued, nor any before ingest publishes its versions", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await readyAt(id, "2");
  await local.takeQueued();
  await app.request("/api/documents");
  assert.deepEqual(await local.takeQueued(), []);
  await publish("2");
  assert.equal((await summaryOf(app, id)).state, "ready");
  assert.deepEqual(await local.takeQueued(), []);
});

test("a document queued or analysing for too long is queued again", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await local.takeQueued();
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.deepEqual(await local.takeQueued(), []);
  await putJson(statusKey(id), { state: "analysing", updated: "2026-11-03T23:00:00Z" });
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal((await local.takeQueued()).length, 1);
});

test("bad requests and ids are rejected", async () => {
  const app = setup();
  assert.equal((await importText(app, "   ")).status, 400);
  const german = await app.request("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Ich gehe.", lang: "de" }),
  });
  assert.equal(german.status, 400);
  const malformed = await app.request("/api/documents", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await local.takeQueued(), []);
  assert.equal((await app.request("/api/documents/../etc")).status, 404);
  assert.equal((await app.request(`/api/documents/${"0".repeat(64)}`)).status, 404);
});
