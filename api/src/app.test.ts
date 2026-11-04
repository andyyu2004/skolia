import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TEXT_LENGTH, type DocumentList, type DocumentSummary } from "@skolia/shared/api";
import { docId, statusKey } from "@skolia/shared/keys";
import type { IngestJob } from "@skolia/shared/schema";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { acceptsEncoding, countWords, createApp, parseImport, parseStatus } from "./app.ts";
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

function setup() {
  const documents = new MemoryDocuments();
  const blobs = new MemoryBlobs();
  const queue = new MemoryQueue();
  const app = createApp({
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

test("brotli blobs are sent as stored when accepted, decoded otherwise", async () => {
  const { app, blobs } = setup();
  await importText(app);
  const id = await docId(TEXT);
  const json = '{"lang":"pl"}';
  blobs.objects.set("b.json.br", {
    body: brotliCompressSync(json),
    contentType: "application/json",
    contentEncoding: "br",
  });
  await blobs.put(
    statusKey(id),
    JSON.stringify({ state: "ready", updated: "x", analysis: "a", bundle: "b.json.br" }),
    "application/json",
  );
  const url = `/api/documents/${id}/bundle`;
  const accepted = await app.request(url, { headers: { "accept-encoding": "gzip, br" } });
  assert.equal(accepted.headers.get("content-encoding"), "br");
  assert.equal(brotliDecompressSync(new Uint8Array(await accepted.arrayBuffer())).toString(), json);
  const plain = await app.request(url, { headers: { "accept-encoding": "gzip" } });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(await plain.text(), json);
});

test("texts over the limit are refused, oversized bodies without being parsed", async () => {
  const { app, queue } = setup();
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH + 1))).status, 400);
  assert.equal((await importText(app, "a".repeat(MAX_TEXT_LENGTH * 5))).status, 413);
  assert.equal(queue.sent.length, 0);
});

test("accept-encoding parsing", () => {
  assert.equal(acceptsEncoding("gzip, deflate, br, zstd", "br"), true);
  assert.equal(acceptsEncoding("br;q=0", "br"), false);
  assert.equal(acceptsEncoding("*", "br"), true);
  assert.equal(acceptsEncoding("gzip", "br"), false);
  assert.equal(acceptsEncoding(undefined, "br"), false);
});

test("analysis is 409 until ready, then served as stored", async () => {
  const { app, blobs } = setup();
  await importText(app);
  const id = await docId(TEXT);
  assert.equal((await app.request(`/api/documents/${id}/analysis`)).status, 409);
  await blobs.put("analysis/x.json.gz", "{}", "application/json");
  await blobs.put(
    statusKey(id),
    JSON.stringify({ state: "ready", updated: "x", analysis: "analysis/x.json.gz", bundle: "b" }),
    "application/json",
  );
  const response = await app.request(`/api/documents/${id}/analysis`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{}");
  const list = (await (await app.request("/api/documents")).json()) as DocumentList;
  assert.deepEqual(
    list.documents.map((d) => d.state),
    ["ready"],
  );
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
