import assert from "node:assert/strict";
import { test } from "node:test";
import * as z from "zod";
import { allPages, encodeCursor, pageQuery, paginate, type Paginated } from "./page.ts";

const Key = z.tuple([z.string(), z.number().int()]);
const query = pageQuery(Key, { fallback: 2, max: 3 });

test("a cursor gives back the key it was made from, any text in it", () => {
  for (const key of [["pl:żółw:NOUN", 0], ["a/b+c=", 12], ["", -1]] as const) {
    const cursor = encodeCursor(key);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/u);
    assert.deepEqual(query.parse({ after: cursor }).after, key);
  }
});

test("a page's query has a default limit and a most, and takes only cursors of its key", () => {
  assert.deepEqual(query.parse({}), { limit: 2 });
  assert.equal(query.parse({ limit: "3" }).limit, 3);
  for (const limit of ["0", "4", "1.5", "x"]) assert.ok(!query.safeParse({ limit }).success, limit);
  for (const after of ["", "not a cursor!", encodeCursor(["a"]), encodeCursor([1, "a"]), btoa("{")]) {
    assert.ok(!query.safeParse({ after }).success, after);
  }
});

test("a page drops the row past its limit, and has a next only when there was one", () => {
  const rows = ["a", "b", "c"].map((item, i) => ({ item, key: [item, i] as const }));
  assert.deepEqual(paginate(rows, 2), { items: ["a", "b"], next: encodeCursor(["b", 1]) });
  assert.deepEqual(paginate(rows, 3), { items: ["a", "b", "c"], next: null });
  assert.deepEqual(paginate([], 3), { items: [], next: null });
});

test("every page of a list, in order", async () => {
  const pages: Readonly<Record<string, Paginated<number>>> = {
    start: { items: [1, 2], next: "p2" },
    p2: { items: [3], next: "p3" },
    p3: { items: [], next: null },
  };
  const asked: (string | undefined)[] = [];
  const items = await allPages(async (after) => {
    asked.push(after);
    const page = pages[after ?? "start"];
    if (page === undefined) throw new Error(`no page ${after}`);
    return page;
  });
  assert.deepEqual(items, [1, 2, 3]);
  assert.deepEqual(asked, [undefined, "p2", "p3"]);
});
