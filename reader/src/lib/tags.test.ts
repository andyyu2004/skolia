import assert from "node:assert/strict";
import { test } from "node:test";
import { byKind, kindLabel, tagLabel } from "./tags.ts";

test("a tag reads kind: value, and a kind as a label", () => {
  assert.equal(tagLabel({ kind: "level", value: "B1" }), "level · B1");
  assert.equal(kindLabel("level"), "Level");
  assert.equal(kindLabel("reading-time"), "Reading time");
});

test("tags group by kind, keeping their order", () => {
  const tag = (kind: string, value: string) => ({ kind, value, description: null });
  assert.deepEqual(byKind([tag("form", "poem"), tag("level", "A1"), tag("form", "story"), tag("level", "B1")]), [
    ["form", [tag("form", "poem"), tag("form", "story")]],
    ["level", [tag("level", "A1"), tag("level", "B1")]],
  ]);
});
