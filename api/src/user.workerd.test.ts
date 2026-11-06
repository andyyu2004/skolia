import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startLocal, type Local } from "./testing/harness.ts";
import { MIGRATIONS } from "./user/migrations/index.ts";

let local: Local;

before(async () => {
  local = await startLocal();
});
after(() => local?.close());

function storageOf(name: string) {
  return local.server.getWorker().getDurableObjectStorage("User", { name });
}

test("each user's Durable Object keeps its own lemmas", async () => {
  const alice = local.env.USER.getByName("alice");
  await alice.setLemma("pl:pies:NOUN", "learning", "2026-11-06T00:00:00.000Z");
  await alice.setLemma("pl:pies:NOUN", "known", "2026-11-06T01:00:00.000Z");
  assert.deepEqual(await alice.lemmas(), [
    { lemmaId: "pl:pies:NOUN", status: "known", updated: "2026-11-06T01:00:00.000Z" },
  ]);
  assert.deepEqual(await local.env.USER.getByName("bob").lemmas(), []);
});

test("a new object is migrated to the latest version, and migrates down to empty and back up", async () => {
  const carol = local.env.USER.getByName("carol");
  await carol.lemmas();
  const storage = await storageOf("carol");
  const tables = async () => (await storage.exec<{ name: string }>("select name from sqlite_master where type = 'table'")).map((t) => t.name);
  const versions = async () => (await storage.exec<{ version: number }>("select version from migration order by version")).map((r) => r.version);
  const all = MIGRATIONS.map((_, i) => i + 1);

  assert.ok((await tables()).includes("known_lemma"));
  assert.deepEqual(await versions(), all);
  await carol.migrate(0);
  assert.ok(!(await tables()).includes("known_lemma"));
  assert.deepEqual(await versions(), []);
  await carol.migrate(MIGRATIONS.length);
  assert.ok((await tables()).includes("known_lemma"));
  assert.deepEqual(await versions(), all);
  await assert.rejects(carol.migrate(MIGRATIONS.length + 1));
});

test("known_lemma is WITHOUT ROWID", async () => {
  await local.env.USER.getByName("dave").lemmas();
  const [table] = await (await storageOf("dave")).exec<{ sql: string }>("select sql from sqlite_master where name = 'known_lemma'");
  assert.match(table?.sql ?? "", /WITHOUT ROWID\s*$/);
});
