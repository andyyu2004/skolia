import assert from "node:assert/strict";
import { test } from "node:test";
import { readLink, writeLink, type WordLink } from "./link.ts";

const ID = "a".repeat(64);

test("a link writes only what differs from the defaults", () => {
  assert.equal(writeLink(null), "");
  assert.equal(writeLink({ word: [3, 12], view: "word", layout: "tree", whole: true }), "?w=3.12");
  assert.equal(
    writeLink({ word: [3, 12], view: "sentence", layout: "tree", whole: true }),
    "?w=3.12&view=sentence&draw=tree&whole=1",
  );
  assert.equal(writeLink({ word: [0, 0], view: "sentence", layout: "arcs", whole: false }), "?w=0.0&view=sentence");
});

test("a link reads back as it was written", () => {
  const links: WordLink[] = [
    { word: [3, 12], view: "sentence", layout: "tree", whole: true },
    { word: [0, 4], view: "sentence", layout: "arcs", whole: false },
    { word: [7, 1], view: "word", layout: "arcs", whole: false },
  ];
  for (const link of links) assert.deepEqual(readLink(`#/doc/${ID}${writeLink(link)}`, ID), link);
});

test("a hash without a word, with a malformed one, or for another text links to nothing", () => {
  assert.equal(readLink(`#/doc/${ID}`, ID), null);
  assert.equal(readLink(`#/doc/${ID}?w=3`, ID), null);
  assert.equal(readLink(`#/doc/${ID}?w=x.1`, ID), null);
  assert.equal(readLink(`#/doc/${"b".repeat(64)}?w=3.12`, ID), null);
});
