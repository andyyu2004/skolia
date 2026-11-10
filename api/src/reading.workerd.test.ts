import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import type { DocumentList } from "@skolia/shared/api";
import { docId, statusKey, versionsKey } from "@skolia/shared/keys";
import { TEXT, importText, importer, local, publish, putJson, readyAt, setup, summaryOf, useLocal } from "./testing/app.ts";

useLocal();

test("brotli blobs are sent as stored when accepted, refused otherwise", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "public", licence: "cc0" });
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  const url = `/api/documents/${id}/bundle/b1-a1-l1`;
  const accepted = await app.request(url, { headers: { "accept-encoding": "gzip, br" } });
  assert.equal(accepted.headers.get("content-encoding"), "br");
  assert.equal(brotliDecompressSync(new Uint8Array(await accepted.arrayBuffer())).toString(), '{"bundle":"1"}');
  const plain = await app.request(url, { headers: { "accept-encoding": "gzip" } });
  assert.equal(plain.status, 406);
});

test("a blob is cached, and asked for again each time: 304 while the viewer may still see it, 404 once not", async () => {
  const app = setup();
  await importText(app, TEXT);
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  const get = (url: string, headers: Headers, etag?: string) =>
    app.request(url, { headers: { ...Object.fromEntries(headers), "accept-encoding": "br", ...(etag === undefined ? {} : { "if-none-match": etag }) } });
  for (const url of [`/api/documents/${id}/text`, `/api/documents/${id}/bundle/b1-a1-l1`]) {
    const first = await get(url, importer);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-cache");
    const etag = first.headers.get("etag") ?? "";
    assert.match(etag, /^"doc\//u);
    const again = await get(url, importer, `W/"other", ${etag}`);
    assert.equal(again.status, 304);
    assert.equal(again.headers.get("etag"), etag);
    assert.equal(again.headers.get("cache-control"), "private, no-cache");
    assert.equal(await again.text(), "");
    assert.equal((await get(url, importer, '"other"')).status, 200);
    // Private to Ivy: signed out, the cached copy isn't confirmed
    assert.equal((await get(url, new Headers(), etag)).status, 404);
  }
});

test("the summary names the reading once there is one, and it's served by name", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "public", licence: "cc0" });
  const id = await docId("pl", TEXT);
  assert.equal((await summaryOf(app, id)).reading, undefined);
  await readyAt(id, "1");
  assert.deepEqual((await summaryOf(app, id)).reading, { analysis: "s2-a1", bundle: "b1-a1-l1" });
  const analysis = await app.request(`/api/documents/${id}/analysis/s2-a1`, { headers: { "accept-encoding": "br" } });
  assert.equal(analysis.status, 200);
  assert.equal(brotliDecompressSync(Buffer.from(await analysis.arrayBuffer())).toString(), '{"analysis":"1"}');
  assert.equal((await app.request(`/api/documents/${id}/analysis/s2-a9`)).status, 404);
  assert.equal((await app.request(`/api/documents/${id}/analysis/..%2Fstatus`)).status, 404);
  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(list.documents.map((d) => d.state), ["ready"]);
});

test("an outdated document is queued once, and its old reading is kept meanwhile", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "public", licence: "cc0" });
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  await publish("2");
  await local.takeQueued();

  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(list.documents.map((d) => [d.state, d.reading?.analysis]), [["queued", "s2-a1"]]);
  assert.deepEqual(await local.takeQueued(), [{ doc: id, lang: "pl" }]);
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.deepEqual(await local.takeQueued(), []);
});

test("a bundle of another shape is out of date even if the analyser is the same", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  await putJson(versionsKey("pl"), { analyzer: "pl/1", lexicon: "lex/1", analysis: "s2-a1", bundle: "b2-a1-l1" });
  await local.takeQueued();
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal((await local.takeQueued()).length, 1);
});

test("a current document isn't queued, nor any before ingest publishes its versions", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await readyAt(id, "2");
  await local.takeQueued();
  await app.request("/api/documents");
  assert.deepEqual(await local.takeQueued(), []);
  await publish("2");
  assert.equal((await summaryOf(app, id)).state, "ready");
  assert.deepEqual(await local.takeQueued(), []);
});

test("a document queued or analysing for too long is queued again", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await local.takeQueued();
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.deepEqual(await local.takeQueued(), []);
  await putJson(statusKey(id), { state: "analysing", updated: "2026-11-03T23:00:00Z" });
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal((await local.takeQueued()).length, 1);
});
