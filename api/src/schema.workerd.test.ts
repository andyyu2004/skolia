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
    ["account", "apikey", "document", "session", "tag", "user", "user_document", "user_document_tag", "verification"].map((name) => ({ name, strict: 1 })),
  );
  const user = await local.signUp(ALICE);
  const document = env.DB.prepare(`insert into document (id, lang, words) values (?, 'pl', ?)`);
  await document.bind("a", 1).run();
  await assert.rejects(document.bind("b", "many").run(), /cannot store TEXT/);
  const entry = (document: string, visibility: string, licence: string, { source = null, imported = "2026-11-07T00:00:00.000Z", owner = user.id }: { source?: string | null; imported?: string; owner?: string } = {}) =>
    env.DB.prepare(`insert or replace into user_document values (?, ?, 't', ?, ?, ?, null, ?)`).bind(owner, document, imported, visibility, licence, source).run();
  await entry("a", "public", "cc0");
  for (const imported of ["2026-11-07T00:00:00Z", "2026-11-07 00:00:00", "yesterday"]) {
    await assert.rejects(entry("a", "public", "cc0", { imported }), /CHECK constraint failed/);
  }
  await assert.rejects(entry("missing", "public", "cc0"), /FOREIGN KEY constraint failed/);
  await assert.rejects(entry("a", "public", "cc0", { owner: "nobody" }), /FOREIGN KEY constraint failed/);
  await assert.rejects(entry("a", "secret", "cc0"), /CHECK constraint failed/);
  await assert.rejects(entry("a", "private", "mit"), /CHECK constraint failed/);
  await assert.rejects(entry("a", "public", "all-rights-reserved"), /CHECK constraint failed/);
  await assert.rejects(entry("a", "public", "cc-by", { source: "ftp://x" }), /CHECK constraint failed/);
  await entry("a", "private", "all-rights-reserved");
  await entry("a", "public", "cc-by-nc-sa", { source: "https://example.org" });
  await entry("a", "public", "cc-by-nd");
  // Deleting a user takes their entries, and leaves the text
  await env.DB.prepare(`delete from "user" where "id" = ?`).bind(user.id).run();
  assert.equal(await env.DB.prepare("select 1 from user_document where document_id = 'a'").first(), null);
  assert.notEqual(await env.DB.prepare("select 1 from document where id = 'a'").first(), null);
});

// A SCAN that names an index walks it in order, as list does over the public entries' partial index
test("no document query scans a whole table", async () => {
  for (const [name, sql] of Object.entries(DOCUMENT_QUERIES)) {
    const params = parameters(sql);
    const { results } = await local.env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...Array.from({ length: params }, () => "x"))
      .all<{ detail: string }>();
    const scans = results.map((r) => r.detail).filter((d) => /^SCAN \S+$/u.test(d));
    assert.deepEqual(scans, [], `${name}: ${results.map((r) => r.detail).join("; ")}`);
  }
});

test("a tag's kind and value are kind:value's, and each kind's tags have their own order", async () => {
  const add = (kind: string, value: string, position: number) =>
    local.env.DB.prepare("insert into tag (kind, value, description, position) values (?, ?, null, ?)").bind(kind, value, position).run();
  await add("form", "poem", 0);
  await add("form", "story", 1);
  await assert.rejects(add("form", "play", 1), /UNIQUE constraint failed/);
  for (const [kind, value] of [["Form", "x"], ["form", ""], ["form", "a b"], ["form:x", "y"], ["-form", "y"], ["form", "-x"]] as const) {
    await assert.rejects(add(kind, value, 9), /CHECK constraint failed/, `${kind}:${value}`);
  }
  await local.env.DB.prepare("delete from tag where kind = 'form'").run();
});

test("an entry's tags are tags skolia has, one of each kind, and go with the entry", async () => {
  const { env } = local;
  const user = await local.signUp(ALICE);
  await env.DB.prepare("insert into document (id, lang, words) values ('a', 'pl', 1)").run();
  await env.DB.prepare(`insert into user_document values (?, 'a', 't', '2026-11-07T00:00:00.000Z', 'public', 'cc0', null, null)`).bind(user.id).run();
  const tag = (kind: string, value: string, document = "a") =>
    env.DB.prepare("insert into user_document_tag (user_id, document_id, kind, value) values (?, ?, ?, ?)").bind(user.id, document, kind, value).run();
  const { results: known } = await env.DB.prepare("select kind, value from tag").all<{ kind: string; value: string }>();
  for (const { kind, value } of known) {
    await tag(kind, value);
    await env.DB.prepare("delete from user_document_tag").run();
  }
  await assert.rejects(tag("level", "D1"), /FOREIGN KEY constraint failed/);
  await assert.rejects(tag("genre", "poem"), /FOREIGN KEY constraint failed/);
  await assert.rejects(tag("level", "A1", "missing"), /FOREIGN KEY constraint failed/);
  await tag("level", "A1");
  await assert.rejects(tag("level", "B1"), /UNIQUE constraint failed/);
  await env.DB.prepare("delete from user_document where document_id = 'a'").run();
  assert.equal(await env.DB.prepare("select 1 from user_document_tag").first(), null);
});

test("a list narrowed by tags looks them up by value", async () => {
  const sql = DOCUMENT_QUERIES.listTagged;
  const params = parameters(sql);
  const { results } = await local.env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...Array.from({ length: params }, () => "x"))
    .all<{ detail: string }>();
  const plan = results.map((r) => r.detail);
  assert.ok(plan.some((d) => /user_document_tag USING COVERING INDEX user_document_tag_value_idx \(kind=\? AND value=\?\)/u.test(d)), plan.join("; "));
});

/** How many parameters a query takes: its highest ?N, or its count of plain ?s. */
function parameters(sql: string): number {
  const numbered = [...sql.matchAll(/\?(\d+)/gu)].map((m) => Number(m[1]));
  return numbered.length > 0 ? Math.max(...numbered) : (sql.match(/\?/gu)?.length ?? 0);
}
