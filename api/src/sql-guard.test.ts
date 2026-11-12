import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..", "..");
const DIRS = ["api/src", "util"];

/** A query run other than from a Sql: D1's prepare of anything but a Sql's text (prepare in
 * worker/adapters.ts), or SqlStorage's or D1's exec of anything but a Sql's text and
 * parameters (User's #exec) or a migration step's checksummed text. */
const RUN = /\.prepare\((?!text\))|\b(?:sql|db|DB)\.exec\((?!text, |step\.sql\))/gu;
/** sql.raw of anything but one string literal. */
const RAW = /sql\.raw\((?!\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.|\$(?!\{))*`)\s*\))/gsu;

function offences(source: string): string[] {
  return [...source.matchAll(RUN), ...source.matchAll(RAW)].map((m) => {
    const line = source.slice(0, m.index).split("\n").length;
    return `${line}: ${m[0].split("\n")[0]}`;
  });
}

test("the guard finds SQL run other than from a Sql", () => {
  assert.equal(offences("db.prepare(`SELECT * FROM t WHERE id = ${id}`)").length, 1);
  assert.equal(offences("db.prepare(`SELECT 1`)").length, 1);
  assert.equal(offences("db.prepare(QUERIES.visible).bind(id)").length, 1);
  assert.equal(offences("this.sql.exec(\n  `SELECT ${columns} FROM t`, 1)").length, 1);
  assert.equal(offences("this.sql.exec(readingListQuery(true, false), ...params)").length, 1);
  assert.equal(offences("env.DB.exec(\"DELETE FROM t\")").length, 1);
  assert.equal(offences("sql.raw(name)").length, 1);
  assert.equal(offences("sql.raw(`t_${n}`)").length, 1);
  assert.equal(offences(`sql.raw("a" + b)`).length, 1);
  assert.deepEqual(
    offences("db.prepare(text).bind(...params); storage.sql.exec(text, ...params); storage.sql.exec(step.sql); /x/u.exec(s); sql.raw(\"t\"); sql.raw('t'); sql.raw(`t`)"),
    [],
  );
});

test("no source outside the tests runs SQL other than from a Sql", () => {
  const files = DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.split("/").includes("node_modules"))
      .map((file) => join(ROOT, dir, file)),
  );
  assert.ok(files.length > 10, `only ${files.length} files`);
  const found = files.flatMap((file) => offences(readFileSync(file, "utf8")).map((offence) => `${relative(ROOT, file)}:${offence}`));
  assert.deepEqual(found, []);
});
