import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startLocal, type Local } from "./testing/harness.ts";
import { MIGRATIONS } from "./user/migrations/index.ts";
import { checksum } from "./user/migrator.ts";

let local: Local;

before(async () => {
  local = await startLocal();
});
after(() => local?.close());

const LATEST = MIGRATIONS.length;

function storageOf(name: string) {
  return local.server.getWorker().getDurableObjectStorage("User", { name });
}

async function tables(name: string): Promise<string[]> {
  const rows = await (await storageOf(name)).exec<{ name: string }>("select name from sqlite_master where type = 'table'");
  return rows.map((t) => t.name);
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

test("a new object migrates to the latest version and logs each migration with its checksum", async () => {
  const status = await local.env.USER.getByName("carol").migrationStatus();
  assert.equal(status.version, LATEST);
  assert.deepEqual(status.problems, []);
  assert.deepEqual(
    status.log.map((e) => [e.version, e.name, e.direction, e.checksum]),
    await Promise.all(MIGRATIONS.map(async (m) => [m.version, m.name, "up", await checksum(m.up)])),
  );
});

test("migrating down and back up appends to the log instead of rewriting it", async () => {
  const dave = local.env.USER.getByName("dave");
  await dave.migrate(0);
  assert.ok(!(await tables("dave")).includes("known_lemma"));
  await dave.migrate(LATEST);
  assert.ok((await tables("dave")).includes("known_lemma"));
  const { version, log } = await dave.migrationStatus();
  assert.equal(version, LATEST);
  assert.deepEqual(
    log.map((e) => [e.version, e.direction]),
    [
      [1, "up"],
      [1, "down"],
      [1, "up"],
    ],
  );
  assert.deepEqual(log.map((e) => e.seq), [...log.map((e) => e.seq)].sort((a, b) => a - b));
  assert.equal(log[1]?.checksum, await checksum(MIGRATIONS[0]!.down));
  await assert.rejects(dave.migrate(LATEST + 1));
});

test("the log can't be updated or deleted from", async () => {
  await local.env.USER.getByName("erin").lemmas();
  const storage = await storageOf("erin");
  await assert.rejects(storage.exec("update migration_log set name = 'other'"), /append-only/);
  await assert.rejects(storage.exec("delete from migration_log"), /append-only/);
  const { log } = await local.env.USER.getByName("erin").migrationStatus();
  assert.deepEqual(log.map((e) => e.name), MIGRATIONS.map((m) => m.name));
});

test("an applied migration that was edited, or that the code doesn't have, stops migrating", async () => {
  const frank = local.env.USER.getByName("frank");
  await frank.migrate(0);
  const storage = await storageOf("frank");
  const insert = "insert into migration_log (version, name, direction, checksum, applied_at) values (?, ?, 'up', ?, '2026-11-07T00:00:00Z')";
  await storage.exec(insert, 1, MIGRATIONS[0]!.name, "edited");
  assert.deepEqual((await frank.migrationStatus()).problems, [`version 1 (${MIGRATIONS[0]!.name}) was edited after it was applied`]);
  await assert.rejects(frank.migrate(0));

  const grace = local.env.USER.getByName("grace");
  await grace.lemmas();
  await (await storageOf("grace")).exec(insert, LATEST + 1, "from_the_future", "x");
  assert.deepEqual((await grace.migrationStatus()).problems, [`version ${LATEST + 1} (from_the_future) is applied but isn't in the code`]);
  await assert.rejects(grace.migrate(LATEST));
});

test("known_lemma is WITHOUT ROWID", async () => {
  await local.env.USER.getByName("heidi").lemmas();
  const [table] = await (await storageOf("heidi")).exec<{ sql: string }>("select sql from sqlite_master where name = 'known_lemma'");
  assert.match(table?.sql ?? "", /WITHOUT ROWID\s*$/);
});
