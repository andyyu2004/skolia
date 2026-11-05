// The ports on Cloudflare: D1 for document metadata, R2 for blobs, Queues for jobs.
import type { IngestJob } from "@skolia/shared/schema";
import { ADD, COUNT_SINCE, GET, LIST, addParams, toCount, toRecord } from "../documents.ts";
import type { BlobStore, DocumentRecord, DocumentStore, JobQueue, StoredBlob } from "../ports.ts";

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(): Promise<DocumentRecord[]> {
    const { results } = await this.db.prepare(LIST).all<Record<string, unknown>>();
    return results.map(toRecord);
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const row = await this.db.prepare(GET).bind(id).first<Record<string, unknown>>();
    return row ? toRecord(row) : null;
  }

  async add(record: DocumentRecord): Promise<void> {
    await this.db.prepare(ADD).bind(...addParams(record)).run();
  }

  async countImportedSince(since: string): Promise<number> {
    return toCount(await this.db.prepare(COUNT_SINCE).bind(since).first<Record<string, unknown>>());
  }
}

export class R2Blobs implements BlobStore {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async get(key: string): Promise<StoredBlob | null> {
    const object = await this.bucket.get(key);
    if (object === null) return null;
    return {
      body: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType,
      contentEncoding: object.httpMetadata?.contentEncoding,
    };
  }

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }
}

export class CloudflareQueue implements JobQueue {
  private readonly queue: Queue<IngestJob>;

  constructor(queue: Queue<IngestJob>) {
    this.queue = queue;
  }

  async send(job: IngestJob): Promise<void> {
    // Ingest reads the queue over the HTTP pull API, which can't decode the default
    // Workers-only "v8" format
    await this.queue.send(job, { contentType: "json" });
  }
}
