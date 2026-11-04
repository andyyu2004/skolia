// What the API needs from its surroundings. Locally: SQLite, S3 (RustFS) and Redis
// (src/node/). In production: D1, R2 and Cloudflare Queues.
import type { Lang } from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";

/** A document's metadata, owned by the API. Its state lives in the status blob. */
export interface DocumentRecord {
  id: string;
  title: string;
  lang: Lang;
  imported: string;
  words: number;
}

export interface DocumentStore {
  list(): Promise<DocumentRecord[]>;
  get(id: string): Promise<DocumentRecord | null>;
  /** Insert, or keep the existing record if the id is already there. */
  add(record: DocumentRecord): Promise<void>;
}

export interface StoredBlob {
  body: Uint8Array;
  contentType: string | undefined;
  /** "gzip" for the analysis and bundle: sent to the client as stored. */
  contentEncoding: string | undefined;
}

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}

export interface JobQueue {
  send(job: IngestJob): Promise<void>;
}
