import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Timestamp } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
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

test("each user's Durable Object keeps its own words", async () => {
  const alice = local.env.USER.getByName("alice");
  await alice.setWord("pl:pies:NOUN", "active", schemas.Timestamp.parse("2026-11-06T00:00:00.000Z"));
  await alice.setWord("pl:pies:NOUN", "known", schemas.Timestamp.parse("2026-11-06T01:00:00.000Z"));
  assert.deepEqual(await alice.words(), [
    { lemmaId: "pl:pies:NOUN", status: "known", updated: "2026-11-06T01:00:00.000Z", mature: false },
  ]);
  assert.deepEqual(await local.env.USER.getByName("bob").words(), []);
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
  assert.ok(!(await tables("dave")).includes("word"));
  await dave.migrate(LATEST);
  assert.ok((await tables("dave")).includes("word"));
  const { version, log } = await dave.migrationStatus();
  assert.equal(version, LATEST);
  const ups = MIGRATIONS.map((m) => [m.version, "up"]);
  const downs = MIGRATIONS.map((m) => [m.version, "down"]).reverse();
  assert.deepEqual(
    log.map((e) => [e.version, e.direction]),
    [...ups, ...downs, ...ups],
  );
  assert.deepEqual(log.map((e) => e.seq), [...log.map((e) => e.seq)].sort((a, b) => a - b));
  assert.equal(log[LATEST]?.checksum, await checksum(MIGRATIONS[LATEST - 1]!.down));
  await assert.rejects(dave.migrate(LATEST + 1));
});

test("the log can't be updated or deleted from", async () => {
  await local.env.USER.getByName("erin").words();
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
  const insert = "insert into migration_log (version, name, direction, checksum, applied_at) values (?, ?, 'up', ?, '2026-11-07T00:00:00.000Z')";
  await storage.exec(insert, 1, MIGRATIONS[0]!.name, "edited");
  assert.deepEqual((await frank.migrationStatus()).problems, [`version 1 (${MIGRATIONS[0]!.name}) was edited after it was applied`]);
  await assert.rejects(frank.migrate(0));

  const grace = local.env.USER.getByName("grace");
  await grace.words();
  await (await storageOf("grace")).exec(insert, LATEST + 1, "from_the_future", "x");
  assert.deepEqual((await grace.migrationStatus()).problems, [`version ${LATEST + 1} (from_the_future) is applied but isn't in the code`]);
  await assert.rejects(grace.migrate(LATEST));
});

test("the tables are STRICT, the user's are WITHOUT ROWID, and timestamps must be toISOString()'s", async () => {
  const heidi = local.env.USER.getByName("heidi");
  await heidi.words();
  const storage = await storageOf("heidi");
  assert.deepEqual(
    await storage.exec(
      "select name, strict, wr from pragma_table_list where name in ('word', 'card', 'review', 'settings', 'migration_log') order by name",
    ),
    [
      { name: "card", strict: 1, wr: 1 },
      { name: "migration_log", strict: 1, wr: 0 },
      { name: "review", strict: 1, wr: 1 },
      { name: "settings", strict: 1, wr: 0 },
      { name: "word", strict: 1, wr: 1 },
    ],
  );
  await heidi.setWord("pl:pies:NOUN", "known", schemas.Timestamp.parse("2026-11-07T00:00:00.000Z"));
  for (const updated of ["2026-11-07T00:00:00Z", "2026-11-07 00:00:00", "yesterday"]) {
    // Past the types, to check the table refuses them
    await assert.rejects(heidi.setWord("pl:kot:NOUN", "known", updated as Timestamp));
  }
  await assert.rejects(storage.exec("insert into word values ('pl:kot:NOUN', x'00', '2026-11-07T00:00:00.000Z')"), /cannot store BLOB/);
  assert.equal((await heidi.words()).length, 1);
});

test("an active word's cards are stored with their ts-fsrs state, which gives their due time", async () => {
  const ivan = local.env.USER.getByName("ivan");
  await ivan.setWord("pl:pies:NOUN", "active", schemas.Timestamp.parse("2026-11-07T00:00:00.000Z"));
  const storage = await storageOf("ivan");
  const rows = await storage.exec<{ kind: string; due_at: string; schedule_status: string; fsrs: string }>(
    "select kind, due_at, schedule_status, fsrs from card order by kind",
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.due_at, r.schedule_status]),
    [
      ["production", "2026-11-07T00:00:00.000Z", "new"],
      ["recognition", "2026-11-07T00:00:00.000Z", "new"],
    ],
  );
  await assert.rejects(storage.exec("update card set fsrs = json_set(fsrs, '$.scheduleStatus', 'lost')"));
});
