import assert from "node:assert/strict";
import { test } from "node:test";
import { docId } from "@skolia/shared/keys";
import { parseCurated, readCurated, sync, type Change } from "./seed.ts";
import { CURATED_USER } from "./seed-key.ts";
import { client, listed, local, setup, useLocal } from "./testing/app.ts";

useLocal();

const FILE = "title: Inwokacja\nauthor: Adam Mickiewicz\nlicence: public-domain\nsource: https://wolnelektury.pl/katalog/lektura/pan-tadeusz/\n---\nLitwo! Ojczyzno moja!\n";

test("a text file is its header, a --- line and the text", async () => {
  const text = await parseCurated("pl/a.txt", "pl", FILE);
  assert.equal(text.id, await docId("pl", "Litwo! Ojczyzno moja!"));
  assert.deepEqual(text.request, {
    title: "Inwokacja",
    text: "Litwo! Ojczyzno moja!",
    lang: "pl",
    visibility: "public",
    licence: "public-domain",
    author: "Adam Mickiewicz",
    source: "https://wolnelektury.pl/katalog/lektura/pan-tadeusz/",
  });
  await assert.rejects(parseCurated("pl/a.txt", "pl", "title: A\nlicence: cc0\nText."), /pl\/a.txt: no "---"/);
  await assert.rejects(parseCurated("pl/a.txt", "pl", "title: A\nlicence: all-rights-reserved\n---\nText."), /pl\/a.txt: a public text needs/);
  await assert.rejects(parseCurated("pl/a.txt", "pl", "title: A\nlicence: cc0\nyear: 1834\n---\nText."), /pl\/a.txt/);
});

test("the seed imports, updates and deletes until the curated user's documents match the texts", async () => {
  const app = setup();
  const api = client(app, await local.signIn(CURATED_USER));
  const log = () => {};
  const kinds = (changes: Change[]) => changes.map((c) => c.kind).sort();
  const first = await parseCurated("pl/a.txt", "pl", FILE);
  const second = await parseCurated("pl/b.txt", "pl", "title: B\nlicence: cc0\n---\nDrugi tekst.");
  assert.deepEqual(kinds(await sync(api, [first, second], { log })), ["import", "import"]);
  assert.deepEqual(await sync(api, [first, second], { check: true, log }), []);

  const retitled = await parseCurated("pl/a.txt", "pl", FILE.replace("Inwokacja", "Pan Tadeusz, Inwokacja"));
  const edited = await parseCurated("pl/b.txt", "pl", "title: B\nlicence: cc0\n---\nDrugi tekst, poprawiony.");
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { check: true, log })), ["delete", "import", "update"]);
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { log })), ["delete", "import", "update"]);
  assert.deepEqual(await sync(api, [retitled, edited], { check: true, log }), []);
  assert.deepEqual((await listed(app)).sort(), [first.id, edited.id].sort());
  assert.equal((await app.request(`/api/documents/${second.id}`)).status, 404);
});

test("every curated text in texts/ parses", async () => {
  const texts = await readCurated(new URL("../../texts", import.meta.url).pathname);
  assert.ok(texts.length > 0);
});
