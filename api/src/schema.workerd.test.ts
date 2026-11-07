import assert from "node:assert/strict";
import { test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "./auth.ts";
import { ALICE, local, useLocal } from "./testing/app.ts";
import { authConfig } from "./testing/harness.ts";

useLocal();

test("the D1 migrations make every table and column Better Auth expects", async () => {
  const { toBeCreated, toBeAdded } = await getMigrations(authOptions(authConfig(local.env.DB)));
  assert.deepEqual(toBeCreated, []);
  assert.deepEqual(toBeAdded, []);
});

test("every D1 table is STRICT, and timestamps must be toISOString()'s", async () => {
  const { env } = local;
  const { results } = await env.DB.prepare(
    "select name, strict from pragma_table_list where schema = 'main' and name not like 'sqlite_%' and name not like '_cf_%' and name != 'd1_migrations' order by name",
  ).all();
  assert.deepEqual(results, ["account", "apikey", "document", "session", "user", "verification"].map((name) => ({ name, strict: 1 })));
  const user = await local.signUp(ALICE);
  const insert = env.DB.prepare(`insert into document (id, title, lang, imported, words, importer, visibility, licence, licensor) values (?, 't', 'pl', ?, 1, '${user.id}', 'public', 'cc0', '${user.id}')`);
  await insert.bind("a", "2026-11-07T00:00:00.000Z").run();
  for (const imported of ["2026-11-07T00:00:00Z", "2026-11-07 00:00:00", "yesterday"]) {
    await assert.rejects(insert.bind("b", imported).run(), /CHECK constraint failed/);
  }
  await assert.rejects(env.DB.prepare(`insert into document values ('c', 't', 'pl', '2026-11-07T00:00:00.000Z', 'many', '${user.id}', 'public', 'cc0', null, null, '${user.id}')`).run(), /cannot store TEXT/);
  await assert.rejects(env.DB.prepare(`insert into document values ('d', 't', 'pl', '2026-11-07T00:00:00.000Z', 1, '${user.id}', 'secret', 'cc0', null, null, '${user.id}')`).run(), /CHECK constraint failed/);
  await assert.rejects(env.DB.prepare("insert into document values ('e', 't', 'pl', '2026-11-07T00:00:00.000Z', 1, 'nobody', 'public', 'cc0', null, null, 'nobody')").run(), /FOREIGN KEY constraint failed/);
  const row = (id: string, visibility: string, licence: string, source = "null") =>
    env.DB.prepare(`insert into document values ('${id}', 't', 'pl', '2026-11-07T00:00:00.000Z', 1, '${user.id}', '${visibility}', '${licence}', null, ${source}, '${user.id}')`).run();
  await assert.rejects(row("f", "private", "mit"), /CHECK constraint failed/);
  await assert.rejects(row("g", "public", "all-rights-reserved"), /CHECK constraint failed/);
  await assert.rejects(row("i", "public", "cc-by", "'ftp://x'"), /CHECK constraint failed/);
  await row("j", "private", "all-rights-reserved");
  await row("k", "public", "cc-by-nc-sa", "'https://example.org'");
  await row("l", "public", "cc-by-nd");
});
