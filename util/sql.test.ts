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

test("raw is text as it is, with no parameters", () => {
  const table = sql.raw("user_document");
  assert.deepEqual(sql`SELECT * FROM ${table}`.params, []);
  assert.equal(sql`SELECT * FROM ${table}`.text, "SELECT * FROM user_document");
});
