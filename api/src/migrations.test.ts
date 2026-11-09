import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const DIR = join(import.meta.dirname, "..", "migrations");
const MIGRATIONS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** A database with the migrations before this one applied, as D1 applies them. */
function migratedUpTo(name: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.slice(0, MIGRATIONS.indexOf(name))) db.exec(readFileSync(join(DIR, file), "utf8"));
  return db;
}

test("0007 makes each document its text's content and its importer's entry", () => {
  const db = migratedUpTo("0007_user_document.sql");
  db.exec(`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
           VALUES ('ivy', 'Ivy', 'ivy@example.com', 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO document VALUES
    ('a', 'Lalka', 'pl', '2026-11-02T00:00:00.000Z', 72, 'curated', 'public', 'public-domain', 'Bolesław Prus', 'https://example.org/lalka', 'curated'),
    ('b', 'Notatki', 'pl', '2026-11-03T00:00:00.000Z', 3, 'ivy', 'private', 'unknown', NULL, NULL, 'ivy')`);
  db.exec(readFileSync(join(DIR, "0007_user_document.sql"), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM document_content ORDER BY id").all().map((r) => ({ ...r })), [
    { id: "a", lang: "pl", words: 72, added: "2026-11-02T00:00:00.000Z", added_by: "curated" },
    { id: "b", lang: "pl", words: 3, added: "2026-11-03T00:00:00.000Z", added_by: "ivy" },
  ]);
  assert.deepEqual(db.prepare("SELECT * FROM user_document ORDER BY document_id").all().map((r) => ({ ...r })), [
    { user_id: "curated", document_id: "a", title: "Lalka", imported: "2026-11-02T00:00:00.000Z", visibility: "public", licence: "public-domain", author: "Bolesław Prus", source: "https://example.org/lalka" },
    { user_id: "ivy", document_id: "b", title: "Notatki", imported: "2026-11-03T00:00:00.000Z", visibility: "private", licence: "unknown", author: null, source: null },
  ]);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'document'").get(), undefined);
});
