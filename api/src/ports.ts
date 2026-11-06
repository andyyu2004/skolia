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
  /** How many documents were imported at or after this ISO time. */
  countImportedSince(since: string): Promise<number>;
}

export interface StoredBlob {
  body: Uint8Array;
  contentType: string | undefined;
}

/** Undo a Content-Encoding, for clients that don't accept it. Async so a large blob
 * doesn't block other requests (Node: zlib on the thread pool). Null where the runtime
 * can't (Workers has no Brotli): such clients get 406. */
export type Decode = ((body: Uint8Array, encoding: string) => Promise<Uint8Array>) | null;

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}

export interface JobQueue {
  send(job: IngestJob): Promise<void>;
}
