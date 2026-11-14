import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentId } from "@skolia/shared/schemas";
import { readLocal, snippet, writeLocal } from "./position.ts";

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

const ID = DocumentId.parse("d".repeat(64));

test("a position written to the browser is read back, per text, as w= writes it", () => {
  const storage = memoryStorage();
  assert.equal(readLocal(storage, ID), null);
  writeLocal(storage, ID, [12, 0]);
  assert.equal(storage.getItem(`skolia:position:${ID}`), "12.0");
  assert.deepEqual(readLocal(storage, ID), [12, 0]);
  assert.equal(readLocal(storage, DocumentId.parse("e".repeat(64))), null);
});

test("what isn't a word reads as none, and storage that throws or is missing is no storage", () => {
  const storage = memoryStorage();
  for (const stored of ["12", "-1.0", "1.5.2", "a.b", ""]) {
    storage.setItem(`skolia:position:${ID}`, stored);
    assert.equal(readLocal(storage, ID), null, stored);
  }
  const throwing = {
    ...memoryStorage(),
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
  assert.equal(readLocal(throwing, ID), null);
  assert.doesNotThrow(() => writeLocal(throwing, ID, [1, 0]));
  assert.equal(readLocal(undefined, ID), null);
});

test("a snippet is the text from the offset, on one line, cut at a space", () => {
  const text = "Pierwsze zdanie.\n\nW renomowanej jadłodajni, gdzie właściciel, pan Stanisław, podaje";
  assert.equal(snippet(text, 18), "W renomowanej jadłodajni, gdzie właściciel, pan Stanisław…");
  assert.equal(snippet(text, 0, 30), "Pierwsze zdanie. W renomowanej…");
  assert.equal(snippet("Krótko.", 0), "Krótko.");
});
