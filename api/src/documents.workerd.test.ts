import assert from "node:assert/strict";
import { test } from "node:test";
import { hc } from "hono/client";
import { MAX_TEXT_LENGTH, type DocumentSummary } from "@skolia/shared/api";
import { docId, statusKey, textKey } from "@skolia/shared/keys";
import type { AppType } from "./app.ts";
import { ALICE, TEXT, importText, importer, listed, local, putJson, setup, summaryOf, useLocal } from "./testing/app.ts";
import { ORIGIN } from "./testing/harness.ts";

useLocal();

test("the version is the build's", async () => {
  const res = await setup().request("/api/version");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { version: "v1.2.3" });
});

test("the typed client imports, lists and gets a document, and sees a 404 as not ok", async () => {
  const app = setup();
  const headers = Object.fromEntries(importer);
  const api = hc<AppType>(ORIGIN, { headers, fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init) }).api;
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

test("bad requests and ids are rejected", async () => {
  const app = setup();
  assert.equal((await importText(app, "   ")).status, 400);
  const german = await app.request(`${ORIGIN}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: importer.get("cookie") ?? "" },
    body: JSON.stringify({ text: "Ich gehe.", lang: "de" }),
  });
  assert.equal(german.status, 400);
  const malformed = await app.request(`${ORIGIN}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: importer.get("cookie") ?? "" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await local.takeQueued(), []);
  assert.equal((await app.request("/api/documents/../etc")).status, 404);
  assert.equal((await app.request(`/api/documents/${"0".repeat(64)}`)).status, 404);
});

test("importing needs a session", async () => {
  const app = setup();
  const response = await importText(app, TEXT, { headers: {} });
  assert.equal(response.status, 401);
  assert.deepEqual(await local.takeQueued(), []);
  assert.deepEqual(await listed(app), []);
});

test("the importer is recorded, and a private text is in only its importer's library", async () => {
  const app = setup();
  const response = await importText(app, TEXT, { visibility: "private" });
  assert.equal(response.status, 202);
  const summary = (await response.json()) as DocumentSummary;
  assert.equal(summary.visibility, "private");
  assert.equal(summary.importerName, "Ivy");
  assert.equal("importer" in summary, false);
  const row = await local.env.DB.prepare("select importer, visibility from document where id = ?").bind(summary.id).first();
  assert.deepEqual(row, { importer: (await local.auth.user(importer))?.id, visibility: "private" });
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  assert.deepEqual(await listed(app), []);
  assert.deepEqual(await listed(app, alice), []);
  assert.deepEqual(await listed(app, importer), [summary.id]);
  assert.equal((await summaryOf(app, summary.id)).visibility, "private");
});

test("a public import of a private text makes it public", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "private" });
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const again = await importText(app, TEXT, { headers: alice });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as DocumentSummary).visibility, "public");
  assert.deepEqual(await listed(app), [await docId("pl", TEXT)]);
  // A private import of a public text doesn't hide it
  await importText(app, TEXT, { visibility: "private" });
  assert.deepEqual(await listed(app), [await docId("pl", TEXT)]);
});
