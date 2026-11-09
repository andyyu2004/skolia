import assert from "node:assert/strict";
import { test } from "node:test";
import { readLocal, sentenceStart, snippet, writeLocal } from "./position.ts";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const ID = "d".repeat(64);

test("a position written to the browser is read back, per text", () => {
  const storage = memoryStorage();
  assert.equal(readLocal(storage, ID), null);
  writeLocal(storage, ID, 120);
  assert.equal(readLocal(storage, ID), 120);
  assert.equal(readLocal(storage, "e".repeat(64)), null);
});

test("what isn't an offset reads as none, and storage that throws or is missing is no storage", () => {
  const storage = memoryStorage();
  for (const stored of ["-1", "1.5", '"12"', "{", "null"]) {
    storage.setItem(`skolia:position:${ID}`, stored);
    assert.equal(readLocal(storage, ID), null, stored);
  }
  const throwing = { ...memoryStorage(), getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(readLocal(throwing, ID), null);
  assert.doesNotThrow(() => writeLocal(throwing, ID, 1));
  assert.equal(readLocal(undefined, ID), null);
});

test("an offset goes back to the start of its sentence", () => {
  const sentences = [{ start: 0 }, { start: 20 }, { start: 45 }];
  assert.equal(sentenceStart(sentences, 0), 0);
  assert.equal(sentenceStart(sentences, 19), 0);
  assert.equal(sentenceStart(sentences, 20), 20);
  assert.equal(sentenceStart(sentences, 44), 20);
  assert.equal(sentenceStart(sentences, 300), 45);
  assert.equal(sentenceStart([], 30), 0);
});

test("a snippet is the text from the offset, on one line, cut at a space", () => {
  const text = "Pierwsze zdanie.\n\nW renomowanej jadłodajni, gdzie właściciel, pan Stanisław, podaje";
  assert.equal(snippet(text, 18), "W renomowanej jadłodajni, gdzie właściciel, pan Stanisław…");
  assert.equal(snippet(text, 0, 30), "Pierwsze zdanie. W renomowanej…");
  assert.equal(snippet("Krótko.", 0), "Krótko.");
});
