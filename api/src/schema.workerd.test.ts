import assert from "node:assert/strict";
import { test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "./auth.ts";
import { ALICE, local, useLocal } from "./testing/app.ts";
import { authConfig } from "./testing/harness.ts";
import { DOCUMENT_QUERIES } from "./worker/adapters.ts";

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
  assert.deepEqual(
    results,
    ["account", "apikey", "document_content", "session", "user", "user_document", "verification"].map((name) => ({ name, strict: 1 })),
  );
  const user = await local.signUp(ALICE);
  const content = env.DB.prepare(`insert into document_content (id, lang, words, added, added_by) values (?, 'pl', ?, ?, ?)`);
  await content.bind("a", 1, "2026-11-07T00:00:00.000Z", user.id).run();
  for (const added of ["2026-11-07T00:00:00Z", "2026-11-07 00:00:00", "yesterday"]) {
    await assert.rejects(content.bind("b", 1, added, user.id).run(), /CHECK constraint failed/);
  }
  await assert.rejects(content.bind("c", "many", "2026-11-07T00:00:00.000Z", user.id).run(), /cannot store TEXT/);
  await assert.rejects(content.bind("d", 1, "2026-11-07T00:00:00.000Z", "nobody").run(), /FOREIGN KEY constraint failed/);
  const entry = (document: string, visibility: string, licence: string, { source = null, imported = "2026-11-07T00:00:00.000Z", owner = user.id }: { source?: string | null; imported?: string; owner?: string } = {}) =>
    env.DB.prepare(`insert or replace into user_document values (?, ?, 't', ?, ?, ?, null, ?)`).bind(owner, document, imported, visibility, licence, source).run();
  await entry("a", "public", "cc0");
  await assert.rejects(entry("a", "public", "cc0", { imported: "yesterday" }), /CHECK constraint failed/);
  await assert.rejects(entry("missing", "public", "cc0"), /FOREIGN KEY constraint failed/);
  await assert.rejects(entry("a", "public", "cc0", { owner: "nobody" }), /FOREIGN KEY constraint failed/);
  await assert.rejects(entry("a", "secret", "cc0"), /CHECK constraint failed/);
  await assert.rejects(entry("a", "private", "mit"), /CHECK constraint failed/);
  await assert.rejects(entry("a", "public", "all-rights-reserved"), /CHECK constraint failed/);
  await assert.rejects(entry("a", "public", "cc-by", { source: "ftp://x" }), /CHECK constraint failed/);
  await entry("a", "private", "all-rights-reserved");
  await entry("a", "public", "cc-by-nc-sa", { source: "https://example.org" });
  await entry("a", "public", "cc-by-nd");
});

// A SCAN that names an index walks it in order, as list does over the public entries' partial index
test("no document query scans a whole table", async () => {
  for (const [name, sql] of Object.entries(DOCUMENT_QUERIES)) {
    const params = Math.max(...[...sql.matchAll(/\?(\d+)/gu)].map((m) => Number(m[1])));
    const { results } = await local.env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...Array.from({ length: params }, () => "x"))
      .all<{ detail: string }>();
    const scans = results.map((r) => r.detail).filter((d) => /^SCAN \S+$/u.test(d));
    assert.deepEqual(scans, [], `${name}: ${results.map((r) => r.detail).join("; ")}`);
  }
});
