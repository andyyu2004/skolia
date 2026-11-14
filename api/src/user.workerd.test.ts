import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Timestamp } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
import { startLocal, type Local } from "./testing/harness.ts";
import { MIGRATIONS } from "./user/migrations/index.ts";
import { checksum } from "./user/migrator.ts";
import { readingListQuery } from "./user/queries.ts";

let local: Local;

before(async () => {
  local = await startLocal();
});
after(() => local?.close());

const LATEST = MIGRATIONS.length;
const FIRST_PAGE = { limit: 100 };

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
  const { items, next } = await alice.words(FIRST_PAGE);
  assert.deepEqual(items, [{ lemmaId: "pl:pies:NOUN", status: "known", updatedAt: "2026-11-06T01:00:00.000Z", mature: false }]);
  assert.equal(next, null);
  assert.deepEqual((await local.env.USER.getByName("bob").words(FIRST_PAGE)).items, []);
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
  await local.env.USER.getByName("erin").words(FIRST_PAGE);
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
  await grace.words(FIRST_PAGE);
  await (await storageOf("grace")).exec(insert, LATEST + 1, "from_the_future", "x");
  assert.deepEqual((await grace.migrationStatus()).problems, [`version ${LATEST + 1} (from_the_future) is applied but isn't in the code`]);
  await assert.rejects(grace.migrate(LATEST));
});

test("the tables are STRICT, the user's are WITHOUT ROWID, and timestamps must be toISOString()'s", async () => {
  const heidi = local.env.USER.getByName("heidi");
  await heidi.words(FIRST_PAGE);
  const storage = await storageOf("heidi");
  assert.deepEqual(
    await storage.exec(
      "select name, strict, wr from pragma_table_list where name in ('word', 'card', 'cloze', 'review', 'settings', 'migration_log', 'reading_list') order by name",
    ),
    [
      { name: "card", strict: 1, wr: 1 },
      { name: "cloze", strict: 1, wr: 1 },
      { name: "migration_log", strict: 1, wr: 0 },
      { name: "reading_list", strict: 1, wr: 1 },
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
  assert.equal((await heidi.words(FIRST_PAGE)).items.length, 1);
  await assert.rejects(
    storage.exec("insert into reading_list values (?, 'pl', 'to-read', '2026-11-07T00:00:00Z', '2026-11-07T00:00:00.000Z')", "0".repeat(64)),
    /CHECK constraint failed/,
  );
});

test("a page of the reading list seeks to its key in an index, with or without a language, and sorts nothing", async () => {
  await local.env.USER.getByName("ivan").words(FIRST_PAGE);
  const storage = await storageOf("ivan");
  for (const [inLang, after] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const query = readingListQuery(
      { status: "to-read", lang: inLang ? "pl" : undefined },
      { after: after ? schemas.ReadingKey.parse(["2026-11-07T00:00:00.000Z", "0".repeat(64)]) : undefined, limit: 3 },
    );
    const plan = (await storage.exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${query.sql.text}`, ...query.sql.params)).map((row) => row.detail);
    const index = inLang ? "reading_list_lang" : "reading_list_status";
    assert.ok(plan.length === 1 && plan[0]!.startsWith(`SEARCH reading_list USING INDEX ${index} `), `${inLang} ${after}: ${plan.join("; ")}`);
  }
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

test("cloze's migration keeps the word cards and their reviews, and down takes the cloze cards away", async () => {
  const at = schemas.Timestamp.parse("2026-11-07T00:00:00.000Z");
  const judy = local.env.USER.getByName("judy");
  await judy.migrate(3);
  const storage = await storageOf("judy");
  // A version 3 word and cards, with the ts-fsrs state a newer object gives them
  const ken = local.env.USER.getByName("ken");
  await ken.setWord("pl:pies:NOUN", "active", at);
  const fsrs = await (await storageOf("ken")).exec<{ kind: string; fsrs: string }>("select kind, fsrs from card order by kind");
  await storage.exec("insert into word values ('pl:pies:NOUN', 'active', ?)", at);
  for (const [i, { kind, fsrs: state }] of fsrs.entries()) {
    await storage.exec("insert into card (id, lemma_id, kind, created, active, fsrs) values (?, 'pl:pies:NOUN', ?, ?, 1, ?)", `c${i}`, kind, at, state);
  }
  await storage.exec("insert into review values ('r0', 'c0', 3, ?)", at);
  const cards = "select id, lemma_id, kind, active, fsrs from card order by id";
  const before = await storage.exec(cards);

  await judy.migrate(4);
  assert.deepEqual(await storage.exec(cards), before);
  assert.deepEqual(await storage.exec("select id, card_id from review"), [{ id: "r0", card_id: "c0" }]);
  assert.deepEqual(await storage.exec("pragma foreign_key_check"), []);
  await assert.rejects(storage.exec("insert into card (id, lemma_id, kind, created, active, fsrs) values ('c9', 'pl:pies:NOUN', 'production', ?, 1, ?)", at, fsrs[0]!.fsrs));
  // The cards' methods are the latest migration's
  await judy.migrate(LATEST);
  const cloze = {
    lemmaId: "pl:pies:NOUN" as const,
    documentId: schemas.DocumentId.parse("a".repeat(64)),
    sentence: "Widzę psa.",
    sentenceStart: 0,
    blankStart: 6,
    blankEnd: 9,
    feats: { Case: "Acc" },
    why: null,
  };
  const { cardId } = await judy.makeCloze(cloze, at);
  await judy.review({ id: schemas.ReviewId.parse(crypto.randomUUID()), cardId, rating: 3, at }, at);
  const clozeRow = "insert into cloze (card_id, document_id, sentence, sentence_start, blank_start, blank_end, feats) values (?, ?, 'Widzę psa.', 0, 0, 5, '{}')";
  // A cloze row belongs to a cloze card, not a word's card or none
  await assert.rejects(storage.exec(clozeRow, "c0", cloze.documentId));
  await assert.rejects(storage.exec(clozeRow, "nope", cloze.documentId));
  await assert.rejects(storage.exec("insert into cloze (card_id, kind, document_id, sentence, sentence_start, blank_start, blank_end, feats) values (?, 'recognition', ?, 'Widzę psa.', 0, 0, 5, '{}')", "c0", cloze.documentId));

  // Deleting a card deletes its cloze row and reviews
  await storage.exec("insert into review values ('r1', 'c1', 3, ?)", at);
  await storage.exec("delete from card where id = 'c1'");
  assert.deepEqual(await storage.exec("select id from review where card_id = 'c1'"), []);
  const { cardId: other } = await judy.makeCloze({ ...cloze, blankStart: 0, blankEnd: 5 }, at);
  await judy.review({ id: schemas.ReviewId.parse(crypto.randomUUID()), cardId: other, rating: 3, at }, at);
  await storage.exec("delete from card where id = ?", other);
  assert.deepEqual(await storage.exec("select count(*) as n from cloze where card_id = ?", other), [{ n: 0 }]);
  assert.deepEqual(await storage.exec("select count(*) as n from review where card_id = ?", other), [{ n: 0 }]);
  await storage.exec("insert into card (id, lemma_id, kind, created_at, active, fsrs) values ('c1', 'pl:pies:NOUN', ?, ?, 1, ?)", fsrs[1]!.kind, at, fsrs[1]!.fsrs);

  await judy.migrate(3);
  assert.deepEqual(await storage.exec(cards), before);
  assert.deepEqual(await storage.exec("select id from review"), [{ id: "r0" }]);
  assert.ok(!(await tables("judy")).includes("cloze"));
  assert.deepEqual(await storage.exec("pragma foreign_key_check"), []);
});

test("card_groups' migration keeps the user's new cards a day as new words a day, and down restores it", async () => {
  const lia = local.env.USER.getByName("lia");
  await lia.migrate(4);
  const storage = await storageOf("lia");
  await storage.exec("update settings set new_per_day = 7");
  // A plain object, not the RPC result's stub
  const settings = async () => ({ ...(await lia.settings()) });

  await lia.migrate(5);
  assert.deepEqual(await settings(), { newLemmasPerDay: 7, newFormsPerDay: 20, formsWithWords: true });
  await assert.rejects(storage.exec("update settings set new_lemmas_per_day = 1001"));
  await assert.rejects(storage.exec("update settings set new_forms_per_day = 1001"));
  await assert.rejects(storage.exec("update settings set forms_with_words = 2"));
  await lia.setSettings({ newLemmasPerDay: 8, newFormsPerDay: 3, formsWithWords: false });

  await lia.migrate(4);
  assert.deepEqual(await storage.exec("select * from settings"), [{ id: 1, new_per_day: 8 }]);
  await lia.migrate(5);
  assert.deepEqual(await settings(), { newLemmasPerDay: 8, newFormsPerDay: 20, formsWithWords: true });
});
