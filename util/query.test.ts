import assert from "node:assert/strict";
import { test } from "node:test";
import { and, col, compile, contains, deleteFrom, desc, eq, exists, fn, gt, inList, inQuery, insertInto, is, isNotNull, lit, ne, not, or, row, select, unionAll, update } from "./query.ts";
import { sql } from "./sql.ts";

test("a select's strings are columns where expressions go and parameters where values go", () => {
  const query = select({ kind: "tag.kind", position: "tag.position" })
    .from("tag")
    .where(eq("tag.kind", "level"), gt("tag.position", 2))
    .orderBy("tag.kind", desc("tag.position"))
    .limit(10);
  assert.equal(
    query.sql.text,
    `SELECT "tag"."kind" AS "kind", "tag"."position" AS "position" FROM "tag" WHERE "tag"."kind" = ? AND "tag"."position" > ? ORDER BY "tag"."kind", "tag"."position" DESC LIMIT ?`,
  );
  assert.deepEqual(query.sql.params, ["level", 2, 10]);
  assert.equal(select(["kind", "value"]).from("tag").sql.text, `SELECT "kind", "value" FROM "tag"`);
});

test("a name that isn't plain throws", () => {
  assert.throws(() => select(["kind; DROP TABLE tag"]), /not an SQL name/u);
  assert.throws(() => eq("a b", 1), /not an SQL name/u);
  assert.throws(() => select({}).from("tag", "t t"), /not an SQL name/u);
});

test("where skips conditions that aren't wanted, ANDs the rest, and adds to a shared query", () => {
  const tags = select(["value"]).from("tag");
  const kind = (wanted: boolean) => wanted && eq("kind", "level");
  assert.equal(tags.where(kind(false), null, undefined).sql.text, `SELECT "value" FROM "tag"`);
  assert.equal(tags.where(kind(true)).where(gt("position", 2)).sql.text, `SELECT "value" FROM "tag" WHERE "kind" = ? AND "position" > ?`);
  assert.equal(tags.sql.text, `SELECT "value" FROM "tag"`);
});

test("col makes a column of a value's place, lit writes a constant in, and a Sql goes as it is", () => {
  const query = select({})
    .from("user_document", "entry")
    .join("document", eq("document.id", col("entry.document_id")))
    .where(eq("entry.visibility", lit("public")), sql`entry.title != ''`);
  assert.equal(
    query.sql.text,
    `SELECT 1 FROM "user_document" AS "entry" JOIN "document" ON "document"."id" = "entry"."document_id" WHERE "entry"."visibility" = 'public' AND entry.title != ''`,
  );
  assert.deepEqual(query.sql.params, []);
});

test("subqueries, aliases and functions", () => {
  const query = select({ kind: "tag.kind", more: select({ n: fn.count() }).from("tag", "has").where(eq("has.kind", col("tag.kind"))) })
    .from("tag")
    .leftJoin("tag", "has", and(eq("has.kind", col("tag.kind")), ne("has.value", col("tag.value"))))
    .where(not(exists(select({}).from("tag", "has").where(isNotNull("has.description")))))
    .groupBy("tag.kind")
    .orderBy(fn.min("tag.position"));
  assert.equal(
    query.sql.text,
    `SELECT "tag"."kind" AS "kind", (SELECT count(*) AS "n" FROM "tag" AS "has" WHERE "has"."kind" = "tag"."kind") AS "more" FROM "tag" LEFT JOIN "tag" AS "has" ON "has"."kind" = "tag"."kind" AND "has"."value" != "tag"."value" WHERE NOT EXISTS (SELECT 1 FROM "tag" AS "has" WHERE "has"."description" IS NOT NULL) GROUP BY "tag"."kind" ORDER BY min("tag"."position")`,
  );
});

test("rows compare with rows of values, and IN takes values, rows of them or a query", () => {
  const after = gt(row("tag.kind", "tag.position"), ["level", 3]);
  assert.equal(after.text, `("tag"."kind", "tag"."position") > (?, ?)`);
  assert.deepEqual(after.params, ["level", 3]);
  assert.equal(inList("kind", ["a", "b"]).text, `"kind" IN (?, ?)`);
  const pairs = inList(row("kind", "value"), [["level", "A1"], ["form", "poem"]]);
  assert.equal(pairs.text, `("kind", "value") IN (VALUES (?, ?), (?, ?))`);
  assert.deepEqual(pairs.params, ["level", "A1", "form", "poem"]);
  assert.equal(inQuery("kind", select(["kind"]).from("tag")).text, `"kind" IN (SELECT "kind" FROM "tag")`);
});

test("or is parenthesised and drops what isn't wanted; is compares with null", () => {
  const viewer: string | null = null;
  assert.equal(or(viewer !== null && eq("user_id", viewer), eq("visibility", lit("public"))).text, `("visibility" = 'public')`);
  assert.equal(or().text, "0");
  assert.equal(is("user_id", viewer).text, `"user_id" IS ?`);
});

test("contains escapes LIKE's wildcards", () => {
  const like = contains("title", "50%_off\\");
  assert.equal(like.text, `"title" LIKE ? ESCAPE '\\'`);
  assert.deepEqual(like.params, ["%50\\%\\_off\\\\%"]);
});

test("unionAll orders and limits the queries' rows together, by their columns' names", () => {
  const part = (kind: string) => select({ kind: "kind", value: "value" }).from("tag").where(eq("kind", kind));
  const query = unionAll([part("a"), part("b")]).orderBy("kind", "value").limit(5);
  assert.match(query.sql.text, /^SELECT .* UNION ALL SELECT .* ORDER BY "kind", "value" LIMIT \?$/u);
  assert.deepEqual(query.sql.params, ["a", "b", 5]);
});

test("insert, upsert, update and delete", () => {
  const add = insertInto("tag").values({ kind: "level", value: "A1", description: null, position: undefined }).orIgnore();
  assert.equal(add.sql.text, `INSERT OR IGNORE INTO "tag" ("kind", "value", "description") VALUES (?, ?, ?)`);
  assert.deepEqual(add.sql.params, ["level", "A1", null]);

  const upsert = insertInto("tag")
    .values({ kind: "level", value: "A1", position: 1 })
    .onConflict(["kind", "value"], {
      set: { position: col("excluded.position"), description: fn.iif(eq("excluded.position", col("tag.position")), "tag.description", null) },
      setWhere: ne("excluded.position", col("tag.position")),
    })
    .returning(["kind"]);
  assert.equal(
    upsert.sql.text,
    `INSERT INTO "tag" ("kind", "value", "position") VALUES (?, ?, ?) ON CONFLICT ("kind", "value") DO UPDATE SET "position" = "excluded"."position", "description" = iif("excluded"."position" = "tag"."position", "tag"."description", ?) WHERE "excluded"."position" != "tag"."position" RETURNING "kind"`,
  );
  assert.equal(
    insertInto("card").values({ id: "x" }).onConflict(["lemma_id", "kind"], { where: ne("kind", lit("cloze")) }).sql.text,
    `INSERT INTO "card" ("id") VALUES (?) ON CONFLICT ("lemma_id", "kind") WHERE "kind" != 'cloze' DO NOTHING`,
  );

  assert.equal(update("tag").set({ description: "d" }).where(eq("kind", "level")).sql.text, `UPDATE "tag" SET "description" = ? WHERE "kind" = ?`);
  assert.equal(deleteFrom("tag").where(eq("kind", "level")).sql.text, `DELETE FROM "tag" WHERE "kind" = ?`);
  assert.equal(compile(deleteFrom("tag")).text, `DELETE FROM "tag"`);
});
