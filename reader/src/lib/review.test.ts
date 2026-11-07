import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcut, type Key } from "./review.ts";

function press(key: string, fields: Partial<Key> = {}): Key {
  return { key, repeat: false, altKey: false, ctrlKey: false, metaKey: false, target: "page", ...fields };
}

test("Space or Enter shows the answer, and 1 to 4 grade it only once it's shown", () => {
  assert.deepEqual(shortcut(press(" "), false), { kind: "reveal" });
  assert.deepEqual(shortcut(press("Enter"), false), { kind: "reveal" });
  assert.equal(shortcut(press("3"), false), null);
  assert.deepEqual(shortcut(press("1"), true), { kind: "grade", rating: 1 });
  assert.deepEqual(shortcut(press("4"), true), { kind: "grade", rating: 4 });
  assert.equal(shortcut(press("0"), true), null);
  assert.equal(shortcut(press("5"), true), null);
  assert.equal(shortcut(press(" "), true), null);
});

test("keys with a modifier, held keys, and keys in a field aren't shortcuts", () => {
  assert.equal(shortcut(press("1", { ctrlKey: true }), true), null);
  assert.equal(shortcut(press("1", { metaKey: true }), true), null);
  assert.equal(shortcut(press("1", { altKey: true }), true), null);
  assert.equal(shortcut(press("1", { repeat: true }), true), null);
  assert.equal(shortcut(press("1", { target: "field" }), true), null);
  assert.equal(shortcut(press(" ", { target: "field" }), false), null);
});

test("Space and Enter on a link or button are the control's, but digits still grade", () => {
  assert.equal(shortcut(press("Enter", { target: "control" }), false), null);
  assert.equal(shortcut(press(" ", { target: "control" }), false), null);
  assert.deepEqual(shortcut(press("3", { target: "control" }), true), { kind: "grade", rating: 3 });
});
