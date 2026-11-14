import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "./sql.ts";

test("a value is a parameter, never SQL", () => {
  const name = "x'); DROP TABLE user; --";
  const query = sql`SELECT * FROM user WHERE name = ${name} AND age > ${3} AND gone IS ${null}`;
  assert.equal(query.text, "SELECT * FROM user WHERE name = ? AND age > ? AND gone IS ?");
  assert.deepEqual(query.params, [name, 3, null]);
});

test("a fragment brings its SQL and parameters, in order, as often as it's used", () => {
  const narrowed = sql`AND kind = ${"level"}`;
  const query = sql`SELECT ${1} ${narrowed} UNION ALL SELECT ${2} ${narrowed}`;
  assert.equal(query.text, "SELECT ? AND kind = ? UNION ALL SELECT ? AND kind = ?");
  assert.deepEqual(query.params, [1, "level", 2, "level"]);
});

test("join puts separators between items, and makes nothing of none", () => {
  const query = sql`value IN (${sql.join(["A1", "B1", "C1"], ", ")})`;
  assert.equal(query.text, "value IN (?, ?, ?)");
  assert.deepEqual(query.params, ["A1", "B1", "C1"]);
  const clauses = sql.join([sql`a = ${1}`, sql`b = ${2}`], " AND ");
  assert.equal(clauses.text, "a = ? AND b = ?");
  assert.deepEqual(clauses.params, [1, 2]);
  assert.equal(sql.join([sql`a = ${1}`], " AND ").text, "a = ?");
  assert.deepEqual(sql.join([], ", "), sql.empty);
  assert.equal(sql`x${sql.empty}y`.text, "xy");
});

test("and joins the wanted conditions, and where puts WHERE before them", () => {
  const lang = (wanted: boolean) => wanted && sql`lang = ${"pl"}`;
  const parts = [sql`a = ${1}`, lang(false), null, undefined, sql`b = ${2}`];
  assert.equal(sql.and(parts).text, "a = ? AND b = ?");
  assert.deepEqual(sql.and(parts).params, [1, 2]);
  assert.equal(sql.where(parts).text, "WHERE a = ? AND b = ?");
  assert.deepEqual(sql.where(parts).params, [1, 2]);
  assert.deepEqual(sql.and([false, undefined]), sql.empty);
  assert.deepEqual(sql.where([]), sql.empty);
  assert.equal(sql`SELECT 1 FROM t ${sql.where([null])}`.text, "SELECT 1 FROM t ");
});

test("tuple is its values in parentheses, as parameters or fragments", () => {
  const query = sql`(kind, value) > ${sql.tuple(["level", sql`lower(${"B1"})`])}`;
  assert.equal(query.text, "(kind, value) > (?, lower(?))");
  assert.deepEqual(query.params, ["level", "B1"]);
  assert.equal(sql.tuple([]).text, "()");
});

test("unionAll joins queries", () => {
  const query = sql.unionAll([sql`SELECT ${1}`, sql`SELECT ${2}`]);
  assert.equal(query.text, "SELECT ? UNION ALL SELECT ?");
  assert.deepEqual(query.params, [1, 2]);
});

test("id quotes plain names, and throws on anything else", () => {
  assert.equal(sql`SELECT ${sql.id("tagged", "user_id")} FROM ${sql.id("user")}`.text, `SELECT "tagged"."user_id" FROM "user"`);
  assert.deepEqual(sql.id("entry").params, []);
  for (const name of ["", "1a", "a b", `a"`, "a.b", "a;--", "é"]) assert.throws(() => sql.id(name), /not an SQL name/u, name);
  assert.throws(() => sql.id("entry", "x y"), /not an SQL name/u);
  assert.throws(() => sql.id(), /not an SQL name/u);
});

test("inline writes the parameters in as literals", () => {
  const name = "x'); DROP TABLE user; --";
  assert.equal(
    sql.inline(sql`INSERT INTO t VALUES (${name}, ${3}, ${-1.5}, ${null});`),
    `INSERT INTO t VALUES ('x''); DROP TABLE user; --', 3, -1.5, NULL);`,
  );
  assert.equal(sql.inline(sql`DELETE FROM t;`), "DELETE FROM t;");
  assert.throws(() => sql.inline(sql`SELECT ${Number.NaN}`), /no SQL literal/u);
  assert.throws(() => sql.inline(sql`SELECT '?', ${1}`), /1 parameters for 2 placeholders/u);
});

test("raw is text as it is, with no parameters", () => {
  const table = sql.raw("user_document");
  assert.deepEqual(sql`SELECT * FROM ${table}`.params, []);
  assert.equal(sql`SELECT * FROM ${table}`.text, "SELECT * FROM user_document");
});
