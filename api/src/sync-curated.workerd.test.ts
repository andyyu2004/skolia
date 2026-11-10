import assert from "node:assert/strict";
import { test } from "node:test";
import { sync, toCurated, type Change } from "./sync-curated.ts";
import { CURATED_USER } from "./sync-curated-key.ts";
import { client, listed, local, setup, useLocal } from "./testing/app.ts";

useLocal();

const INWOKACJA = { title: "Inwokacja", author: "Adam Mickiewicz", licence: "public-domain", source: "https://wolnelektury.pl/katalog/lektura/pan-tadeusz/", text: "Litwo! Ojczyzno moja!" } as const;

test("the sync imports, updates and deletes until the curated user's documents match the texts", async () => {
  const app = setup();
  const api = client(app, await local.signIn(CURATED_USER));
  const log = () => {};
  const kinds = (changes: Change[]) => changes.map((c) => c.kind).sort();
  const first = await toCurated("pl/a.yaml", "pl", INWOKACJA);
  const second = await toCurated("pl/b.yaml", "pl", { title: "B", licence: "cc0", text: "Drugi tekst." });
  assert.deepEqual(kinds(await sync(api, [first, second], { log })), ["import", "import"]);
  assert.deepEqual(await sync(api, [first, second], { check: true, log }), []);

  const retitled = await toCurated("pl/a.yaml", "pl", { ...INWOKACJA, title: "Pan Tadeusz, Inwokacja" });
  const edited = await toCurated("pl/b.yaml", "pl", { title: "B", licence: "cc0", text: "Drugi tekst, poprawiony." });
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { check: true, log })), ["delete", "import", "update"]);
  assert.deepEqual(kinds(await sync(api, [retitled, edited], { log })), ["delete", "import", "update"]);
  assert.deepEqual(await sync(api, [retitled, edited], { check: true, log }), []);
  assert.deepEqual((await listed(app)).sort(), [first.id, edited.id].sort());
  assert.equal((await app.request(`/api/documents/${second.id}`)).status, 404);
});
