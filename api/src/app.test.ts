import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TEXT_LENGTH, type DocumentList, type DocumentSummary } from "@skolia/shared/api";
import { docId, partKey, statusKey, versionsKey } from "@skolia/shared/keys";
import type { IngestJob } from "@skolia/shared/schema";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import {
  STUCK_AFTER_MS,
  acceptsEncoding,
  countWords,
  createApp,
  isOutdated,
  isStuck,
  nameOf,
  parseImport,
  parseImportCap,
  parseStatus,
  parseVersions,
} from "./app.ts";
import type { BlobStore, DocumentRecord, DocumentStore, JobQueue, StoredBlob } from "./ports.ts";

class MemoryDocuments implements DocumentStore {
  readonly rows = new Map<string, DocumentRecord>();
  async list(): Promise<DocumentRecord[]> {
    return [...this.rows.values()];
  }
  async get(id: string): Promise<DocumentRecord | null> {
    return this.rows.get(id) ?? null;
  }
  async add(record: DocumentRecord): Promise<void> {
    if (!this.rows.has(record.id)) this.rows.set(record.id, record);
  }
  async countImportedSince(since: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.imported >= since).length;
  }
}

class MemoryBlobs implements BlobStore {
  readonly objects = new Map<string, StoredBlob>();
  async get(key: string): Promise<StoredBlob | null> {
    return this.objects.get(key) ?? null;
  }
  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.objects.set(key, { body: bytes, contentType, contentEncoding: undefined });
  }
}

class MemoryQueue implements JobQueue {
  readonly sent: IngestJob[] = [];
  async send(job: IngestJob): Promise<void> {
    this.sent.push(job);
  }
}

const TEXT = "Idę do starego psa.";

function setup(maxImportsPerDay = 100) {
  const documents = new MemoryDocuments();
  const blobs = new MemoryBlobs();
  const queue = new MemoryQueue();
  const app = createApp({
    maxImportsPerDay,
    documents,
    blobs,
    queue,
    decode: async (body) => brotliDecompressSync(body),
    now: () => new Date("2026-11-04T00:00:00Z"),
  });
  return { app, documents, blobs, queue };
}

function importText(app: ReturnType<typeof setup>["app"], text = TEXT) {
  return app.request("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "", text, lang: "pl" }),
  });
}

test("import stores the text, queues a job and reports queued", async () => {
  const { app, blobs, queue } = setup();
  const response = await importText(app);
  assert.equal(response.status, 202);
  const summary = (await response.json()) as DocumentSummary;
  const id = await docId(TEXT);
  assert.equal(summary.id, id);
  assert.equal(summary.state, "queued");
  assert.equal(summary.title, "Idę do starego psa.");
  assert.equal(summary.words, 4);
  assert.deepEqual(queue.sent, [{ doc: id, lang: "pl" }]);
  assert.ok(blobs.objects.has(`doc/${id}/text.txt`));
});

test("importing the same text again doesn't queue it twice, unless it failed", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const again = await importText(app);
  assert.equal(again.status, 200);
  assert.equal(queue.sent.length, 1);
  const id = await docId(TEXT);
  await blobs.put(statusKey(id), JSON.stringify({ state: "failed", updated: "x", error: "boom" }), "application/json");
  const retry = await importText(app);
  assert.equal(retry.status, 202);
  assert.equal(queue.sent.length, 2);
});

const NOW = "2026-11-04T00:00:00Z";

/** A ready document whose analysis and bundle were made by version v, as ingest leaves it. */
async function readyAt(blobs: MemoryBlobs, id: string, v: string, state = "ready"): Promise<void> {
  for (const [part, name] of [["analysis", `s2-a${v}`], ["bundle", `b1-a${v}-l1`]] as const) {
    blobs.objects.set(partKey(id, part, name), {
      body: brotliCompressSync(`{"${part}":"${v}"}`),
      contentType: "application/json",
      contentEncoding: "br",
    });
  }
  const status = {
    state,
    updated: NOW,
    analyzer: `pl/${v}`,
    lexicon: "lex/1",
    analysis: partKey(id, "analysis", `s2-a${v}`),
    bundle: partKey(id, "bundle", `b1-a${v}-l1`),
  };
  await blobs.put(statusKey(id), JSON.stringify(status), "application/json");
}

async function publish(blobs: MemoryBlobs, v: string): Promise<void> {
  const versions = { analyzer: `pl/${v}`, lexicon: "lex/1", analysis: `s2-a${v}`, bundle: `b1-a${v}-l1` };
  await blobs.put(versionsKey("pl"), JSON.stringify(versions), "application/json");
}

async function summaryOf(app: ReturnType<typeof setup>["app"], id: string): Promise<DocumentSummary> {
  return (await (await app.request(`/api/documents/${id}`)).json()) as DocumentSummary;
}

test("brotli blobs are sent as stored when accepted, decoded otherwise, cached forever", async () => {
  const { app, blobs } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "1");
  const json = '{"bundle":"1"}';
  const url = `/api/documents/${id}/bundle/b1-a1-l1`;
  const accepted = await app.request(url, { headers: { "accept-encoding": "gzip, br" } });
  assert.equal(accepted.headers.get("content-encoding"), "br");
  assert.equal(accepted.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(brotliDecompressSync(new Uint8Array(await accepted.arrayBuffer())).toString(), json);
  const plain = await app.request(url, { headers: { "accept-encoding": "gzip" } });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(await plain.text(), json);
});

test("new texts past the daily cap are refused; texts already here still open", async () => {
  const { app, queue } = setup(2);
  assert.equal((await importText(app, "Pierwszy tekst.")).status, 202);
  assert.equal((await importText(app, "Drugi tekst.")).status, 202);
  const refused = await importText(app, "Trzeci tekst.");
  assert.equal(refused.status, 429);
  assert.match(((await refused.json()) as { error: string }).error, /tomorrow/);
  assert.equal((await importText(app, "Pierwszy tekst.")).status, 200);
  assert.equal(queue.sent.length, 2);
});

test("the import cap must be a whole number", () => {
  assert.equal(parseImportCap("50"), 50);
  assert.equal(parseImportCap(" 0 "), 0);
  assert.equal(parseImportCap(undefined), null);
  assert.equal(parseImportCap("-1"), null);
  assert.equal(parseImportCap("lots"), null);
});

test("texts over the limit are refused, oversized bodies without being parsed", async () => {
  const { app, queue } = setup();
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH + 1))).status, 400);
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH * 10))).status, 413);
  assert.equal(queue.sent.length, 0);
});

test("accept-encoding parsing", () => {
  assert.equal(acceptsEncoding("gzip, deflate, br, zstd", "br"), true);
  assert.equal(acceptsEncoding("br;q=0", "br"), false);
  assert.equal(acceptsEncoding("*", "br"), true);
  assert.equal(acceptsEncoding("gzip", "br"), false);
  assert.equal(acceptsEncoding(undefined, "br"), false);
});

test("the summary names the reading once there is one, and it's served by name", async () => {
  const { app, blobs } = setup();
  await importText(app);
  const id = await docId(TEXT);
  assert.equal((await summaryOf(app, id)).reading, undefined);
  await readyAt(blobs, id, "1");
  const summary = await summaryOf(app, id);
  assert.deepEqual(summary.reading, { analysis: "s2-a1", bundle: "b1-a1-l1" });
  const analysis = await app.request(`/api/documents/${id}/analysis/s2-a1`);
  assert.equal(analysis.status, 200);
  assert.equal(await analysis.text(), '{"analysis":"1"}');
  assert.equal((await app.request(`/api/documents/${id}/analysis/s2-a9`)).status, 404);
  assert.equal((await app.request(`/api/documents/${id}/analysis/..%2Fstatus`)).status, 404);
  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(
    list.documents.map((d) => d.state),
    ["ready"],
  );
});

test("an outdated document is queued once, and its old reading is kept meanwhile", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "1");
  await publish(blobs, "2");
  queue.sent.length = 0;

  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(
    list.documents.map((d) => [d.state, d.reading?.analysis]),
    [["queued", "s2-a1"]],
  );
  assert.deepEqual(queue.sent, [{ doc: id, lang: "pl" }]);
  // Already queued: opening it again doesn't queue it twice
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 1);
});

test("a bundle of another shape is out of date even if the analyser is the same", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "1");
  const versions = { analyzer: "pl/1", lexicon: "lex/1", analysis: "s2-a1", bundle: "b2-a1-l1" };
  await blobs.put(versionsKey("pl"), JSON.stringify(versions), "application/json");
  queue.sent.length = 0;
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 1);
});

test("a current document isn't queued, nor any before ingest publishes its versions", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  await readyAt(blobs, id, "2");
  queue.sent.length = 0;
  await app.request("/api/documents");
  assert.equal(queue.sent.length, 0);
  await publish(blobs, "2");
  assert.equal((await summaryOf(app, id)).state, "ready");
  assert.equal(queue.sent.length, 0);
});

test("a document queued or analysing for too long is queued again", async () => {
  const { app, blobs, queue } = setup();
  await importText(app);
  const id = await docId(TEXT);
  queue.sent.length = 0;
  // Just queued (by the import, at NOW): left alone
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 0);
  const lost = { state: "analysing", updated: "2026-11-03T23:00:00Z" };
  await blobs.put(statusKey(id), JSON.stringify(lost), "application/json");
  assert.equal((await summaryOf(app, id)).state, "queued");
  assert.equal(queue.sent.length, 1);
});

test("stuck and outdated rules", () => {
  const at = new Date(NOW);
  const old = new Date(at.getTime() - STUCK_AFTER_MS - 1).toISOString();
  assert.equal(isStuck({ state: "queued", updated: NOW }, at), false);
  assert.equal(isStuck({ state: "queued", updated: old }, at), true);
  assert.equal(isStuck({ state: "ready", updated: old }, at), false);
  assert.equal(isStuck({ state: "analysing", updated: "garbage" }, at), true);
  assert.equal(nameOf("doc/x/analysis/s2-a1.json.br"), "s2-a1");
  assert.equal(nameOf(undefined), undefined);
  const latest = { analyzer: "a", lexicon: "l", analysis: "s2-a1", bundle: "b1-a1-l1" };
  const ready = { state: "ready", updated: NOW, analysis: "d/analysis/s2-a1.json.br", bundle: "d/bundle/b1-a1-l1.json.br" } as const;
  assert.equal(isOutdated(ready, latest), false);
  assert.equal(isOutdated(ready, { ...latest, analysis: "s3-a1" }), true);
  assert.equal(isOutdated(ready, null), false);
  assert.equal(isOutdated({ ...ready, state: "failed" }, { ...latest, analysis: "s3-a1" }), false);
});

test("versions parsing ignores malformed blobs", () => {
  const versions = { analyzer: "a", lexicon: "l", analysis: "s2-a1", bundle: "b1-a1-l1" };
  assert.deepEqual(parseVersions(JSON.stringify(versions)), versions);
  assert.equal(parseVersions('{"analyzer":"a","lexicon":"l"}'), null);
  assert.equal(parseVersions("nope"), null);
});

test("bad requests and ids are rejected", async () => {
  const { app } = setup();
  assert.equal((await importText(app, "   ")).status, 400);
  assert.equal((await app.request("/api/documents/../etc")).status, 404);
  assert.equal((await app.request(`/api/documents/${"0".repeat(64)}`)).status, 404);
  assert.equal(typeof parseImport({ text: "x", lang: "de" }), "string");
});

test("status parsing ignores malformed blobs", () => {
  assert.equal(parseStatus("not json"), null);
  assert.equal(parseStatus(JSON.stringify({ state: "done", updated: "x" })), null);
  assert.deepEqual(parseStatus(JSON.stringify({ state: "ready", updated: "x", bundle: 3 })), {
    state: "ready",
    updated: "x",
  });
});

test("words are counted as runs containing letters", () => {
  assert.equal(countWords("Idę do psa — 12 razy."), 4);
});
