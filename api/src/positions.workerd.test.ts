import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReadingPosition } from "@skolia/shared/api";
import { ALICE, NOW, client, importText, importer, local, raw, setup, useLocal, type App } from "./testing/app.ts";
import { body, expectStatus } from "./testing/responses.ts";

useLocal();

async function imported(app: App): Promise<string> {
  return ((await (await importText(app)).json()) as { id: string }).id;
}

function position(app: App, headers: Headers | undefined, id: string) {
  return body("position", client(app, headers).me.positions[":id"].$get({ param: { id } }));
}

function save(app: App, headers: Headers | undefined, id: string, json: ReadingPosition) {
  return client(app, headers).me.positions[":id"].$put({ param: { id }, json });
}

test("a text has no position until one is saved, then has the last one saved", async () => {
  const app = setup();
  const id = await imported(app);
  assert.deepEqual(await position(app, importer, id), { position: null });
  await expectStatus("save", save(app, importer, id, { sentence: 12, token: 0, at: "2026-11-03T10:00:00Z" }), 204);
  await expectStatus("save", save(app, importer, id, { sentence: 4, token: 3, at: "2026-11-03T10:00:05Z" }), 204);
  assert.deepEqual(await position(app, importer, id), { position: { sentence: 4, token: 3, at: "2026-11-03T10:00:05.000Z" } });
});

test("a position older than the saved one is ignored", async () => {
  const app = setup();
  const id = await imported(app);
  await expectStatus("save", save(app, importer, id, { sentence: 12, token: 0, at: "2026-11-03T10:00:05Z" }), 204);
  await expectStatus("late save", save(app, importer, id, { sentence: 4, token: 0, at: "2026-11-03T10:00:00Z" }), 204);
  await expectStatus("same time", save(app, importer, id, { sentence: 8, token: 0, at: "2026-11-03T10:00:05Z" }), 204);
  assert.deepEqual(await position(app, importer, id), { position: { sentence: 12, token: 0, at: "2026-11-03T10:00:05.000Z" } });
});

test("each user has their own position in a text", async () => {
  const app = setup();
  const id = await imported(app);
  const alice = await local.signIn((await local.signUp(ALICE)).id);
  await expectStatus("save", save(app, importer, id, { sentence: 12, token: 0, at: NOW }), 204);
  assert.deepEqual(await position(app, alice, id), { position: null });
});

test("saving a position needs a signed-in user, a document, a time not in the future and indexes in range", async () => {
  const app = setup();
  const id = await imported(app);
  assert.equal((await save(app, undefined, id, { sentence: 0, token: 0, at: NOW })).status, 401);
  assert.equal((await client(app).me.positions[":id"].$get({ param: { id } })).status, 401);
  assert.equal((await save(app, importer, "0".repeat(64), { sentence: 0, token: 0, at: NOW })).status, 404);
  assert.equal((await save(app, importer, "not-an-id", { sentence: 0, token: 0, at: NOW })).status, 400);
  assert.equal((await save(app, importer, id, { sentence: 0, token: 0, at: "2026-11-04T00:06:00Z" })).status, 400);
  for (const bad of [{ sentence: -1 }, { sentence: 1.5 }, { token: 20_001 }, { sentence: undefined }]) {
    const json = { sentence: 0, token: 0, at: NOW, ...bad };
    assert.equal((await raw(app, "PUT", `/api/me/positions/${id}`, importer, json)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(await position(app, importer, id), { position: null });
});
