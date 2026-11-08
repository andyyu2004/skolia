import assert from "node:assert/strict";
import { test } from "node:test";
import { timestamp, type DocumentSummary } from "@skolia/shared/api";
import { DocumentId } from "@skolia/shared/schemas";
import { filterDocuments, otherImporters, type Filters } from "./explore.ts";

function doc(n: number, over: Partial<DocumentSummary>): DocumentSummary {
  return {
    id: DocumentId.parse(String(n).repeat(64)),
    title: "t",
    lang: "pl",
    imported: timestamp(new Date(0)),
    words: 1,
    visibility: "public",
    licence: "cc-by",
    author: null,
    source: null,
    importerName: "Ivy",
    mine: false,
    state: "ready",
    ...over,
  };
}

const ALL: Filters = { lang: "all", importer: "all", query: "" };

function titles(docs: DocumentSummary[], filters: Partial<Filters>): string[] {
  return filterDocuments(docs, { ...ALL, ...filters }).map((d) => d.title);
}

test("yours are the viewer's texts, not texts by someone with the viewer's name", () => {
  const docs = [doc(1, { title: "mine", importerName: "Ana", mine: true }), doc(2, { title: "other Ana's", importerName: "Ana" })];
  assert.deepEqual(titles(docs, { importer: "mine" }), ["mine"]);
  assert.deepEqual(titles(docs, { importer: "by:Ana" }), ["other Ana's"]);
  assert.deepEqual(otherImporters(docs), ["Ana"]);
});

test("an importer named all or mine is just an importer", () => {
  const docs = [doc(1, { title: "a", importerName: "all" }), doc(2, { title: "m", importerName: "mine" }), doc(3, { title: "i" })];
  assert.deepEqual(titles(docs, { importer: "by:all" }), ["a"]);
  assert.deepEqual(titles(docs, { importer: "by:mine" }), ["m"]);
  assert.deepEqual(titles(docs, { importer: "mine" }), []);
});

test("other importers are listed once each, sorted, without the viewer", () => {
  const docs = [doc(1, { importerName: "Zoe" }), doc(2, { importerName: "Curated" }), doc(3, { importerName: "Zoe" }), doc(4, { importerName: "Me", mine: true })];
  assert.deepEqual(otherImporters(docs), ["Curated", "Zoe"]);
});

test("language, importer and search all apply; search ignores case and surrounding space", () => {
  const docs = [
    doc(1, { title: "Lalka", lang: "pl", mine: true }),
    doc(2, { title: "Lalka", lang: "en", mine: true }),
    doc(3, { title: "Pan Tadeusz", lang: "pl", mine: true }),
    doc(4, { title: "Lalka (fragment)", lang: "pl" }),
  ];
  assert.deepEqual(
    filterDocuments(docs, { lang: "pl", importer: "mine", query: "  lALKA " }).map((d) => d.id),
    [docs[0]?.id],
  );
});
