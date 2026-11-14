import assert from "node:assert/strict";
import { test } from "node:test";
import { READING_PAGE, type DocumentId, type Lang, type ReadingKey, type ReadingStatus } from "@skolia/shared/api";
import type { Cursor } from "@skolia/shared/page";
import { ALICE, NOW, client, local, raw, refusesBadPages, setup, useLocal, walk, importer, type App } from "./testing/app.ts";
import { body, expectStatus } from "./testing/responses.ts";

useLocal();

const LATER = "2026-11-04T01:00:00.000Z";
const LATEST = "2026-11-04T02:00:00.000Z";

async function imported(
  app: App,
  text: string,
  { headers = importer, lang = "pl", visibility = "private" }: { headers?: Headers; lang?: Lang; visibility?: "public" | "private" } = {},
): Promise<DocumentId> {
  const json = { text, lang, visibility, licence: visibility === "public" ? ("cc0" as const) : ("unknown" as const) };
  return (await body("import", client(app, headers).documents.$post({ json }), 202)).id;
}

function entry(app: App, headers: Headers | undefined, id: string) {
  return body("entry", client(app, headers).me["reading-list"][":id"].$get({ param: { id } }));
}

function save(app: App, headers: Headers | undefined, id: string, status: ReadingStatus) {
  return client(app, headers).me["reading-list"][":id"].$put({ param: { id }, json: { status } });
}

function remove(app: App, headers: Headers | undefined, id: string) {
  return client(app, headers).me["reading-list"][":id"].$delete({ param: { id } });
}

/** The ids on the list with the status, a page of two at a time. */
async function listOf(app: App, status: ReadingStatus, lang?: Lang): Promise<readonly string[]> {
  const items = await walk(2, (after?: Cursor<ReadingKey>) =>
    body("list", client(app, importer).me["reading-list"].$get({ query: { status, after, limit: "2", ...(lang ? { lang } : {}) } })),
  );
  return items.map((item) => item.document.id);
}

test("a text goes on the list with a status, changes status and comes off it", async () => {
  const app = setup();
  const id = await imported(app, "Idę do starego psa.");
  assert.deepEqual(await entry(app, importer, id), { entry: null });
  const added = { status: "to-read", addedAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z" };
  assert.deepEqual(await body("add", save(app, importer, id, "to-read")), { entry: added });
  const started = { ...added, status: "reading", updatedAt: LATER };
  assert.deepEqual(await body("start", save(setup({ at: LATER }), importer, id, "reading")), { entry: started });
  assert.deepEqual(await body("same status", save(setup({ at: LATEST }), importer, id, "reading")), { entry: started });
  assert.deepEqual(await entry(app, importer, id), { entry: started });
  await expectStatus("remove", remove(app, importer, id), 204);
  assert.deepEqual(await entry(app, importer, id), { entry: null });
  await expectStatus("remove again", remove(app, importer, id), 204);
});

test("each status's list has its texts latest change first, a page at a time, in a language if given", async () => {
  const at = (time: string) => setup({ at: time });
  const app = setup();
  const [first, second, third] = [await imported(app, "Pierwszy."), await imported(app, "Drugi."), await imported(app, "Trzeci.")];
  const english = await imported(app, "The first.", { lang: "en" });
  await expectStatus("first", save(at(NOW), importer, first, "to-read"), 200);
  await expectStatus("second", save(at(NOW), importer, second, "to-read"), 200);
  await expectStatus("third", save(at(LATER), importer, third, "to-read"), 200);
  await expectStatus("english", save(at(LATEST), importer, english, "to-read"), 200);
  const tied = [first, second].sort().reverse();
  assert.deepEqual(await listOf(app, "to-read"), [english, third, ...tied]);
  assert.deepEqual(await listOf(app, "to-read", "pl"), [third, ...tied]);
  assert.deepEqual(await listOf(app, "to-read", "en"), [english]);
  await expectStatus("finish", save(at(LATEST), importer, first, "finished"), 200);
  assert.deepEqual(await listOf(app, "to-read"), [english, third, second]);
  assert.deepEqual(await listOf(app, "finished"), [first]);
  assert.deepEqual(await listOf(app, "reading"), []);
});

test("the list shows each text as the user sees it, and leaves out one they can no longer see", async () => {
  const app = setup();
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const shared = await imported(app, "Wspólny tekst.", { headers: alice, visibility: "public" });
  const own = await imported(app, "Mój tekst.");
  await expectStatus("shared", save(app, importer, shared, "to-read"), 200);
  await expectStatus("own", save(app, importer, own, "to-read"), 200);
  const page = await body("list", client(app, importer).me["reading-list"].$get({ query: { status: "to-read" } }));
  assert.deepEqual(
    page.items.map((item) => [item.document.id, item.document.mine, item.document.importer.name]),
    [own, shared]
      .sort()
      .reverse()
      .map((id) => (id === own ? [own, true, "Ivy"] : [shared, false, "Alice"])),
  );
  await expectStatus("alice deletes hers", client(app, alice).documents[":id"].$delete({ param: { id: shared } }), 204);
  const after = await body("list", client(app, importer).me["reading-list"].$get({ query: { status: "to-read" } }));
  assert.deepEqual(
    after.items.map((item) => item.document.id),
    [own],
  );
  assert.equal((await entry(app, importer, shared)).entry?.status, "to-read");
});

test("only a text the user can see goes on their list, and each user has their own list", async () => {
  const app = setup();
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  const theirs = await imported(app, "Prywatny tekst.", { headers: alice });
  assert.equal((await save(app, importer, theirs, "to-read")).status, 404);
  assert.equal((await save(app, importer, "0".repeat(64), "to-read")).status, 404);
  await expectStatus("alice's own", save(app, alice, theirs, "finished"), 200);
  assert.deepEqual(await entry(app, importer, theirs), { entry: null });
});

test("the list needs a signed-in user, a document id, a status and pages it gave", async () => {
  const app = setup();
  const id = await imported(app, "Idę do starego psa.");
  const list = client(app, importer).me["reading-list"];
  assert.equal((await save(app, undefined, id, "to-read")).status, 401);
  assert.equal((await remove(app, undefined, id)).status, 401);
  assert.equal((await client(app).me["reading-list"][":id"].$get({ param: { id } })).status, 401);
  assert.equal((await client(app).me["reading-list"].$get({ query: { status: "to-read" } })).status, 401);
  assert.equal((await save(app, importer, "not-an-id", "to-read")).status, 400);
  assert.equal((await raw(app, "PUT", `/api/me/reading-list/${id}`, importer, { status: "read" })).status, 400);
  assert.equal((await raw(app, "GET", "/api/me/reading-list", importer, undefined)).status, 400);
  assert.equal((await raw(app, "GET", "/api/me/reading-list?status=to-read&lang=xx", importer, undefined)).status, 400);
  await refusesBadPages(READING_PAGE.max, (query) => list.$get({ query: { ...query, status: "to-read" } }));
  assert.deepEqual(await entry(app, importer, id), { entry: null });
});
