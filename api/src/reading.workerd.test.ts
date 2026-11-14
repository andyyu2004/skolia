import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { docId, statusKey, versionsKey } from "@skolia/shared/keys";
import { TEXT, client, importText, importer, local, publish, putJson, readyAt, setup, summaryOf, useLocal } from "./testing/app.ts";
import { body } from "./testing/responses.ts";

useLocal();

test("brotli blobs are sent as stored when accepted, refused otherwise", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "public", licence: "cc0" });
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  const bundle = (encodings: string) =>
    client(app).documents[":id"].bundle[":name"].$get({ param: { id, name: "b1-a1-l1" } }, { headers: { "accept-encoding": encodings } });
  const accepted = await bundle("gzip, br");
  assert.equal(accepted.headers.get("content-encoding"), "br");
  assert.equal(brotliDecompressSync(new Uint8Array(await accepted.arrayBuffer())).toString(), '{"bundle":"1"}');
  const plain = await bundle("gzip");
  assert.equal(plain.status, 406);
});

test("a blob is cached, and asked for again each time: 304 while the viewer may still see it, 404 once not", async () => {
  const app = setup();
  await importText(app, TEXT);
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  const get = (part: "text" | "bundle", headers: Headers, etag?: string) => {
    const document = client(app, headers).documents[":id"];
    const options = { headers: { "accept-encoding": "br", ...(etag === undefined ? {} : { "if-none-match": etag }) } };
    return part === "text"
      ? document.text.$get({ param: { id } }, options)
      : document.bundle[":name"].$get({ param: { id, name: "b1-a1-l1" } }, options);
  };
  for (const part of ["text", "bundle"] as const) {
    const first = await get(part, importer);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-cache");
    const etag = first.headers.get("etag") ?? "";
    assert.match(etag, /^"doc\//u);
    const again = await get(part, importer, `W/"other", ${etag}`);
    assert.equal(again.status, 304);
    assert.equal(again.headers.get("etag"), etag);
    assert.equal(again.headers.get("cache-control"), "private, no-cache");
    assert.equal(await again.text(), "");
    assert.equal((await get(part, importer, '"other"')).status, 200);
    // Private to Ivy: signed out, the cached copy isn't confirmed
    assert.equal((await get(part, new Headers(), etag)).status, 404);
  }
});

test("the summary names the reading once there is one, and it's served by name", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "public", licence: "cc0" });
  const id = await docId("pl", TEXT);
  assert.equal((await summaryOf(app, id)).reading, undefined);
  await readyAt(id, "1");
  assert.deepEqual((await summaryOf(app, id)).reading, { analysis: "s2-a1", bundle: "b1-a1-l1" });
  const analysis = client(app).documents[":id"].analysis[":name"];
  const served = await analysis.$get({ param: { id, name: "s2-a1" } }, { headers: { "accept-encoding": "br" } });
  assert.equal(served.status, 200);
  assert.equal(brotliDecompressSync(Buffer.from(await served.arrayBuffer())).toString(), '{"analysis":"1"}');
  assert.equal((await analysis.$get({ param: { id, name: "s2-a9" } })).status, 404);
  assert.equal((await analysis.$get({ param: { id, name: "..%2Fstatus" } })).status, 404);
  const list = await body("documents", client(app).documents.$get({ query: {} }));
  assert.deepEqual(
    list.items.map((d) => d.state),
    ["ready"],
  );
});

test("an outdated document is queued once when it's opened, not listed, and its old reading is kept meanwhile", async () => {
  const app = setup();
  await importText(app, TEXT, { visibility: "public", licence: "cc0" });
  const id = await docId("pl", TEXT);
  await readyAt(id, "1");
  await publish("2");
  await local.takeQueued();

  const list = await body("documents", client(app).documents.$get({ query: {} }));
  assert.deepEqual(
    list.items.map((d) => [d.state, d.reading?.analysis]),
    [["ready", "s2-a1"]],
  );
  assert.deepEqual(await local.takeQueued(), []);
  const opened = await summaryOf(app, id);
  assert.deepEqual([opened.state, opened.reading?.analysis], ["queued", "s2-a1"]);
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
  await client(app).documents.$get({ query: {} });
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

test("listing a stuck document doesn't queue it again; opening it does", async () => {
  const app = setup();
  await importText(app);
  const id = await docId("pl", TEXT);
  await putJson(statusKey(id), { state: "analysing", updated: "2026-11-03T23:00:00Z" });
  await local.takeQueued();
  const list = await body("documents", client(app, importer).documents.$get({ query: {} }));
  assert.deepEqual(
    list.items.map((d) => [d.id, d.state]),
    [[id, "analysing"]],
  );
  assert.deepEqual(await local.takeQueued(), []);
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.deepEqual(await local.takeQueued(), [{ doc: id, lang: "pl" }]);
});
