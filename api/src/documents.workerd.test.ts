import assert from "node:assert/strict";
import { test } from "node:test";
import { hc } from "hono/client";
import { MAX_TEXT_LENGTH, type DocumentId, type DocumentSummary, type DocumentUpdate, type ImportRequest } from "@skolia/shared/api";
import { docId, statusKey, textKey } from "@skolia/shared/keys";
import type { AppType } from "./app.ts";
import type { IngestJobs } from "./ports.ts";
import { ALICE, NOW, TEXT, client, importText, importer, listed, local, putJson, raw, readyAt, setup, summaryOf, useLocal, type App } from "./testing/app.ts";
import { ORIGIN } from "./testing/harness.ts";
import { body, expectStatus } from "./testing/responses.ts";

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
  const listed = await api.documents.$get({ query: {} });
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
  const id = await docId("pl", TEXT);
  await putJson(statusKey(id), { state: "failed", updated: "x", error: "boom" });
  const retry = await importText(app);
  assert.equal(retry.status, 202);
  assert.equal((await local.takeQueued()).length, 1);
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
  const ivy = (await local.auth.user(importer))?.id;
  assert.deepEqual(summary.importer, { id: ivy, name: "Ivy" });
  const row = await local.env.DB.prepare("select user_id, visibility from user_document where document_id = ?").bind(summary.id).first();
  assert.deepEqual(row, { user_id: ivy, visibility: "private" });
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  assert.deepEqual(await listed(app), []);
  assert.deepEqual(await listed(app, alice), []);
  assert.deepEqual(await listed(app, importer), [summary.id]);
  assert.equal((await summaryOf(app, summary.id)).visibility, "private");
});

test("a text is private unless asked otherwise, with no licence", async () => {
  const app = setup();
  const summary = (await (await importText(app)).json()) as DocumentSummary;
  assert.equal(summary.visibility, "private");
  assert.equal(summary.licence, "unknown");
  assert.equal(summary.author, null);
  assert.equal(summary.source, null);
});

test("a public text needs a licence that allows sharing it", async () => {
  const app = setup();
  for (const licence of [undefined, "unknown", "all-rights-reserved"]) {
    const response = await importText(app, TEXT, { visibility: "public", ...(licence ? { licence } : {}) });
    assert.equal(response.status, 400, String(licence));
  }
  assert.equal((await importText(app, TEXT, { visibility: "public", licence: "mit" })).status, 400);
  assert.equal((await importText(app, TEXT, { visibility: "public", licence: "cc-by", source: "ftp://x" })).status, 400);
  assert.deepEqual(await local.takeQueued(), []);
  const response = await importText(app, TEXT, { visibility: "public", licence: "cc-by-nc-nd", author: " Bolesław Prus ", source: "https://example.org/lalka" });
  assert.equal(response.status, 202);
  const summary = (await response.json()) as DocumentSummary;
  assert.deepEqual(
    { visibility: summary.visibility, licence: summary.licence, author: summary.author, source: summary.source },
    { visibility: "public", licence: "cc-by-nc-nd", author: "Bolesław Prus", source: "https://example.org/lalka" },
  );
  assert.equal("licensor" in summary, false);
});

test("a public import of the user's own private text makes it public under the new licence claim", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "private", licence: "all-rights-reserved", author: "someone" });
  const again = await importText(app, TEXT, { visibility: "public", licence: "public-domain" });
  assert.equal(again.status, 200);
  const summary = (await again.json()) as DocumentSummary;
  assert.deepEqual([summary.visibility, summary.licence, summary.author, summary.title], ["public", "public-domain", null, "Idę do starego psa."]);
  assert.deepEqual(await listed(app), [summary.id]);
  // A private import of their public text doesn't hide it or change its licence
  await importText(app, TEXT, { visibility: "private", licence: "cc-by-nd" });
  assert.deepEqual(await listed(app), [summary.id]);
  assert.equal((await summaryOf(app, summary.id)).licence, "public-domain");
});

test("another user importing the same text gets their own entry, and the first stays private", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT, { title: "Ivy's", licence: "all-rights-reserved", author: "someone" });
  await local.takeQueued();
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const theirs = await body("import", client(app, alice).documents.$post({ json: { text: TEXT, lang: "pl", title: "Alice's", visibility: "public", licence: "cc0" } }), 200);
  assert.deepEqual([theirs.id, theirs.title, theirs.visibility, theirs.licence, theirs.importer.name, theirs.mine], [id, "Alice's", "public", "cc0", "Alice", true]);
  assert.deepEqual(await local.takeQueued(), []);
  const ivys = await summaryOf(app, id);
  assert.deepEqual([ivys.title, ivys.visibility, ivys.licence, ivys.author, ivys.mine], ["Ivy's", "private", "all-rights-reserved", "someone", true]);
  const signedOut = await summaryOf(app, id, {});
  assert.deepEqual([signedOut.title, signedOut.importer.name, signedOut.mine], ["Alice's", "Alice", false]);
  const { documents } = await body("list", client(app).documents.$get({ query: {} }));
  assert.deepEqual(documents.map((d) => d.title), ["Alice's"]);
  const both = await body("list", client(app, importer).documents.$get({ query: {} }));
  assert.deepEqual(both.documents.map((d) => d.title).sort(), ["Alice's", "Ivy's"]);
});

test("a text only privately imported is unknown to everyone else, its text, analysis, bundle and position too", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT);
  await readyAt(id, "1");
  const { reading } = await summaryOf(app, id);
  if (!reading) throw new Error("not ready");
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  for (const [who, headers] of [["signed out", undefined], ["someone else", alice]] as const) {
    const api = client(app, headers).documents[":id"];
    await expectStatus(`${who}: get`, api.$get({ param: { id } }), 404);
    await expectStatus(`${who}: text`, api.text.$get({ param: { id } }), 404);
    await expectStatus(`${who}: analysis`, api.analysis[":name"].$get({ param: { id, name: reading.analysis } }), 404);
    await expectStatus(`${who}: bundle`, api.bundle[":name"].$get({ param: { id, name: reading.bundle } }), 404);
    await expectStatus(`${who}: patch`, patch(app, headers, id, { title: "Mój" }), headers ? 404 : 401);
  }
  const position = { sentence: 0, token: 0, at: NOW };
  await expectStatus("someone else's position", client(app, alice).me.positions[":id"].$put({ param: { id }, json: position }), 404);
  await expectStatus("the importer's position", client(app, importer).me.positions[":id"].$put({ param: { id }, json: position }), 204);
  await expectStatus("the importer's text", client(app, importer).documents[":id"].text.$get({ param: { id } }), 200);
});

test("deleting entries keeps the text for others, and keeps it stored once nobody has one", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await body("import", client(app, alice).documents.$post({ json: { text: TEXT, lang: "pl" } }), 200);
  await expectStatus("Ivy deletes", remove(app, importer, id), 204);
  await expectStatus("Ivy's is gone", view(app, importer, id), 404);
  assert.equal((await body("Alice's stays", view(app, alice, id))).mine, true);
  await expectStatus("Alice deletes", remove(app, alice, id), 204);
  await expectStatus("nobody sees it", view(app, alice, id), 404);
  assert.notDeepEqual((await local.env.BLOBS.list({ prefix: `doc/${id}/` })).objects, []);
  assert.notEqual(await local.env.DB.prepare("select id from document where id = ?").bind(id).first(), null);
});

/** Imports the text as the signed-in user, with these fields, and returns its id. */
async function imported(app: App, headers: Headers, text: string, fields: Partial<ImportRequest> = {}): Promise<DocumentId> {
  return (await body("import", client(app, headers).documents.$post({ json: { text, lang: "pl", ...fields } }), 202)).id;
}

function patch(app: App, headers: Headers | undefined, id: string, json: DocumentUpdate) {
  return client(app, headers).documents[":id"].$patch({ param: { id }, json });
}

function remove(app: App, headers: Headers | undefined, id: string) {
  return client(app, headers).documents[":id"].$delete({ param: { id } });
}

function view(app: App, headers: Headers | undefined, id: string) {
  return client(app, headers).documents[":id"].$get({ param: { id } });
}

test("the importer changes a document's title, licence, author and source; nobody else can", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT, { visibility: "public", licence: "cc0", author: "A", source: "https://example.org/a" });
  const { title, licence, author, source } = await body("patch", patch(app, importer, id, { title: " Nowy tytuł ", licence: "cc-by", author: null }));
  assert.deepEqual({ title, licence, author, source }, { title: "Nowy tytuł", licence: "cc-by", author: null, source: "https://example.org/a" });
  await expectStatus("unshareable licence", patch(app, importer, id, { licence: "all-rights-reserved" }), 400);
  await expectStatus("blank title", patch(app, importer, id, { title: "  " }), 400);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await expectStatus("someone else", patch(app, alice, id, { title: "Mój" }), 403);
  await expectStatus("signed out", patch(app, undefined, id, { title: "Mój" }), 401);
  await expectStatus("unknown id", patch(app, importer, "0".repeat(64), { title: "Mój" }), 404);
  assert.equal((await body("get", view(app, undefined, id))).title, "Nowy tytuł");
});

test("an entry has the tags it was imported with, which its user replaces", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT, { tags: { level: "A2" } });
  const tags = async () => (await body("get", view(app, importer, id))).tags;
  assert.deepEqual(await tags(), { level: "A2" });
  assert.deepEqual((await body("list", client(app, importer).documents.$get({ query: {} }))).documents.map((d) => d.tags), [{ level: "A2" }]);
  assert.deepEqual((await body("patch", patch(app, importer, id, { tags: { level: "C2" } }))).tags, { level: "C2" });
  await expectStatus("title only", patch(app, importer, id, { title: "Pies" }), 200);
  assert.deepEqual(await tags(), { level: "C2" });
  await expectStatus("no tags", patch(app, importer, id, { tags: {} }), 200);
  assert.deepEqual(await tags(), {});
  await expectStatus("a tag skolia hasn't", patch(app, importer, id, { tags: { level: "D1" } }), 400);
  await expectStatus("a kind skolia hasn't", patch(app, importer, id, { tags: { genre: "poem" } }), 400);
  await expectStatus("not a tag", patch(app, importer, id, { tags: { level: "B 1" } }), 400);
  await expectStatus("import, a tag skolia hasn't", client(app, importer).documents.$post({ json: { text: "Inny tekst.", lang: "pl", tags: { level: "D1" } } }), 400);
  assert.deepEqual(await tags(), {});
  assert.deepEqual((await body("get", view(app, importer, await imported(app, importer, "Bez tagów.")))).tags, {});
});

test("each user's entry for a text has its own tags, which go with the entry", async () => {
  const app = setup();
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const shared = { visibility: "public", licence: "cc0" } as const;
  const id = await imported(app, importer, TEXT, { ...shared, tags: { level: "B1" } });
  await body("alice imports", client(app, alice).documents.$post({ json: { text: TEXT, lang: "pl", ...shared, tags: { level: "B2" } } }));
  assert.deepEqual((await body("get", view(app, alice, id))).tags, { level: "B2" });
  assert.deepEqual((await body("get", view(app, importer, id))).tags, { level: "B1" });
  await expectStatus("alice deletes hers", remove(app, alice, id), 204);
  await body("alice imports again", client(app, alice).documents.$post({ json: { text: TEXT, lang: "pl", ...shared } }));
  assert.deepEqual((await body("get", view(app, alice, id))).tags, {});
});

test("a list narrows to entries with any of the values asked for each kind of tag", async () => {
  const app = setup();
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const shared = { visibility: "public", licence: "cc0" } as const;
  const a1 = await imported(app, importer, "Pierwszy tekst.", { ...shared, tags: { level: "A1" } });
  const b1 = await imported(app, importer, "Drugi tekst.", { ...shared, tags: { level: "B1" } });
  await imported(app, importer, "Trzeci tekst.", shared);
  const own = await imported(app, alice, "Czwarty tekst.", { tags: { level: "B1" } });
  const narrowed = async (headers: Headers | undefined, tag: string | string[]) =>
    (await body("list", client(app, headers).documents.$get({ query: { tag } }))).documents.map((d) => d.id).sort();
  assert.deepEqual(await narrowed(undefined, "level:B1"), [b1]);
  assert.deepEqual(await narrowed(alice, "level:B1"), [b1, own].sort());
  assert.deepEqual(await narrowed(undefined, ["level:A1", "level:B1"]), [a1, b1].sort());
  assert.deepEqual(await narrowed(undefined, "level:C3"), []);
  assert.deepEqual(await narrowed(undefined, ["level:B1", "form:poem"]), []);
  assert.equal((await listed(app)).length, 3);
  for (const tag of ["level", "level:", ":B1", "level:B 1"]) {
    await expectStatus(tag, client(app).documents.$get({ query: { tag } }), 400);
  }
});

test("the tags skolia has are listed, each kind's in its order", async () => {
  const { tags } = await body("tags", client(setup()).tags.$get());
  assert.deepEqual(
    tags.filter((t) => t.kind === "level").map((t) => t.value),
    ["A0", "A1", "A2", "B1", "B2", "C1", "C2", "C3"],
  );
  assert.equal(tags.find((t) => t.value === "B1")?.description, "Intermediate");
});

test("the importer makes a document public under a shareable licence, and private again", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await expectStatus("public without a licence", patch(app, importer, id, { visibility: "public" }), 400);
  await expectStatus("public", patch(app, importer, id, { visibility: "public", licence: "cc-by-sa" }), 200);
  assert.deepEqual(await listed(app, alice), [id]);
  await expectStatus("private", patch(app, importer, id, { visibility: "private" }), 200);
  assert.deepEqual(await listed(app, alice), []);
  assert.equal((await body("get", view(app, importer, id))).licence, "cc-by-sa");
});

test("a summary says whether the viewer imported it", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT, { visibility: "public", licence: "cc0" });
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const mine = async (headers?: Headers) => (await body("get", view(app, headers, id))).mine;
  assert.deepEqual([await mine(importer), await mine(alice), await mine()], [true, false, false]);
  const { documents } = await body("list", client(app, importer).documents.$get({ query: {} }));
  assert.deepEqual(documents.map((d) => d.mine), [true]);
});

test("the importer deletes their entry; nobody else can", async () => {
  const app = setup();
  const id = await imported(app, importer, TEXT);
  await local.takeQueued();
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await expectStatus("someone else, private", remove(app, alice, id), 404);
  await expectStatus("public", patch(app, importer, id, { visibility: "public", licence: "cc0" }), 200);
  await expectStatus("someone else, public", remove(app, alice, id), 403);
  await expectStatus("signed out", remove(app, undefined, id), 401);
  await expectStatus("delete", remove(app, importer, id), 204);
  await expectStatus("get after delete", view(app, importer, id), 404);
  await expectStatus("delete again", remove(app, importer, id), 404);
  assert.deepEqual(await listed(app, importer), []);
  // Importing it again finds it already analysed
  await body("import again", client(app, importer).documents.$post({ json: { text: TEXT, lang: "pl" } }), 200);
  assert.deepEqual(await local.takeQueued(), []);
});

test("a user's own documents are listed for them, private ones too, and nobody else's", async () => {
  const app = setup();
  const mine = await imported(app, importer, "Mój tekst.");
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await imported(app, alice, "Tekst Alicji.", { visibility: "public", licence: "cc0" });
  const { documents } = await body("mine", client(app, importer).me.documents.$get({ query: {} }));
  assert.deepEqual(documents.map((d) => d.id), [mine]);
  await expectStatus("signed out", client(app).me.documents.$get({ query: {} }), 401);
});

test("the importer sees where their document is in the queue; others don't", async () => {
  const id = await imported(setup(), importer, TEXT, { visibility: "public", licence: "cc0" });
  const other = "e".repeat(64);
  const place = async (jobs: IngestJobs | null, headers?: Headers) =>
    (await body("get", view(setup({ jobsOf: async () => jobs }), headers, id))).queue;
  assert.deepEqual(await place(null, importer), { starting: true, ahead: null });
  assert.deepEqual(await place({ loading: true, running: [], waiting: [id] }, importer), { starting: true, ahead: 0 });
  assert.deepEqual(await place({ loading: false, running: [other], waiting: [other, id] }, importer), { starting: false, ahead: 2 });
  assert.deepEqual(await place({ loading: false, running: [other], waiting: [] }, importer), { starting: false, ahead: null });
  assert.equal(await place(null), undefined);
  await readyAt(id, "1");
  assert.equal(await place(null, importer), undefined);
});
