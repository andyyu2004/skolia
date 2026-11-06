// What the API needs from its surroundings: D1, R2 and Cloudflare Queues
// (src/worker/adapters.ts), and fakes in the tests.
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

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}

export interface JobQueue {
  send(job: IngestJob): Promise<void>;
}
