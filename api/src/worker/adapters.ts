// The ports on Cloudflare: D1 for document metadata, R2 for blobs, Queues for jobs, a
// Durable Object per user for their own data.
import * as z from "zod";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";
import { DocumentRow } from "@skolia/shared/schemas";
import type { BlobStore, DocumentRecord, DocumentStore, JobQueue, StoredBlob, UserData } from "../ports.ts";
import type { User } from "./user.ts";

export class DurableObjectUsers implements UserData {
  private readonly users: DurableObjectNamespace<User>;

  constructor(users: DurableObjectNamespace<User>) {
    this.users = users;
  }

  async lemmas(userId: string): Promise<KnownLemma[]> {
    return this.users.getByName(userId).lemmas();
  }

  async setLemma(userId: string, lemmaId: LemmaId, status: LemmaStatus, updated: string): Promise<void> {
    await this.users.getByName(userId).setLemma(lemmaId, status, updated);
  }
}

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(): Promise<DocumentRecord[]> {
    const { results } = await this.db.prepare("SELECT * FROM document ORDER BY imported DESC").all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const row = await this.db.prepare("SELECT * FROM document WHERE id = ?").bind(id).first();
    return row ? DocumentRow.parse(row) : null;
  }

  async add({ id, title, lang, imported, words }: DocumentRecord): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO document (id, title, lang, imported, words) VALUES (?, ?, ?, ?, ?)")
      .bind(id, title, lang, imported, words)
      .run();
  }

  async countImportedSince(since: string): Promise<number> {
    // ISO 8601 UTC strings sort in time order
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM document WHERE imported >= ?").bind(since).first();
    return z.object({ n: z.number() }).parse(row).n;
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
    };
  }

  async put(key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string): Promise<void> {
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
