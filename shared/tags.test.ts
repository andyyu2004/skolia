import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTag, matchesTags, parseTag, tagFilter } from "./api.ts";

test("a tag is kind:value, and only that", () => {
  assert.deepEqual(parseTag("level:B1"), { kind: "level", value: "B1" });
  assert.equal(formatTag({ kind: "level", value: "B1" }), "level:B1");
  for (const text of ["level", ":B1", "level:", "Level:B1", "level:B 1", "level:B1:x"]) assert.equal(parseTag(text), null, text);
});

test("a filter keeps entries with any of its values of a kind, for every kind", () => {
  const filter = tagFilter([
    { kind: "level", value: "A1" },
    { kind: "level", value: "B1" },
    { kind: "level", value: "B1" },
    { kind: "form", value: "poem" },
  ]);
  assert.deepEqual(filter, { level: ["A1", "B1"], form: ["poem"] });
  assert.ok(matchesTags({ level: "B1", form: "poem" }, filter));
  assert.ok(!matchesTags({ level: "B1" }, filter));
  assert.ok(!matchesTags({ level: "C1", form: "poem" }, filter));
  assert.ok(matchesTags({}, {}));
});
