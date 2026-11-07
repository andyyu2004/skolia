// The ports on Cloudflare: D1 for document metadata, R2 for blobs, Queues for jobs, a
// Durable Object per user for their own data.
import * as z from "zod";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";
import { DocumentRow } from "@skolia/shared/schemas";
import type { BlobStore, DocumentRecord, DocumentStore, JobQueue, Sharing, StoredBlob, StoredDocument, UserData } from "../ports.ts";
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

const SELECT_DOCUMENT = `SELECT document.*, "user"."name" AS importerName FROM document JOIN "user" ON "user"."id" = document.importer`;

export class D1Documents implements DocumentStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(viewer: string | null): Promise<StoredDocument[]> {
    const { results } = await this.db
      .prepare(`${SELECT_DOCUMENT} WHERE document.visibility = 'public' OR document.importer = ? ORDER BY document.imported DESC`)
      .bind(viewer)
      .all();
    return results.map((row) => DocumentRow.parse(row));
  }

  async get(id: string): Promise<StoredDocument | null> {
    const row = await this.db.prepare(`${SELECT_DOCUMENT} WHERE document.id = ?`).bind(id).first();
    return row ? DocumentRow.parse(row) : null;
  }

  async add(r: DocumentRecord): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO document (id, title, lang, imported, words, importer, visibility, licence, author, source, licensor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(r.id, r.title, r.lang, r.imported, r.words, r.importer, r.visibility, r.licence, r.author, r.source, r.licensor)
      .run();
  }

  async share(id: string, { licence, author, source, licensor }: Sharing): Promise<void> {
    await this.db
      .prepare("UPDATE document SET visibility = 'public', licence = ?, author = ?, source = ?, licensor = ? WHERE id = ?")
      .bind(licence, author, source, licensor, id)
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
