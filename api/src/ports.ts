// What the API needs from its surroundings: D1, R2, Cloudflare Queues and a Durable
// Object per user (src/worker/adapters.ts), Better Auth (src/auth.ts), and fakes in the
// tests.
import type {
  Lang,
  LemmaId,
  LexiconEntry,
  Licence,
  Reviewed,
  ReviewRequest,
  ScheduledCard,
  Settings,
  User,
  Visibility,
  Word,
  WordStatus,
} from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";

/** A document's metadata, owned by the API. Its state lives in the status blob. */
export interface DocumentRecord {
  id: string;
  title: string;
  lang: Lang;
  imported: string;
  words: number;
  /** The user who first imported it. */
  importer: string;
  visibility: Visibility;
  licence: Licence;
  author: string | null;
  source: string | null;
  /** The user who claimed the licence: the importer, or whoever made it public. */
  licensor: string;
}

/** A licence claim, which makes a private document public. */
export type Sharing = Pick<DocumentRecord, "licence" | "author" | "source" | "licensor">;

/** A stored document, with its importer's name. */
export interface StoredDocument extends DocumentRecord {
  importerName: string;
}

export interface DocumentStore {
  /** Public documents, and the viewer's own private ones. */
  list(viewer: string | null): Promise<StoredDocument[]>;
  get(id: string): Promise<StoredDocument | null>;
  /** Insert, or keep the existing record if the id is already there. */
  add(record: DocumentRecord): Promise<void>;
  /** Make it public under this licence claim. */
  share(id: string, sharing: Sharing): Promise<void>;
  /** How many documents were imported at or after this ISO time. */
  countImportedSince(since: string): Promise<number>;
}

export interface StoredBlob {
  body: Uint8Array<ArrayBuffer>;
  contentType: string | undefined;
}

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string): Promise<void>;
}

export interface JobQueue {
  send(job: IngestJob): Promise<void>;
}

export interface DueCards {
  cards: ScheduledCard[];
  newLeft: number;
}

/** out-of-order: answered before the card was made or before its last review.
 * id-reused: the review id is another card's. */
export type ReviewOutcome = ({ kind: "reviewed" } & Reviewed) | { kind: "no-card" } | { kind: "out-of-order" } | { kind: "id-reused" };

/** A user's words, cards and settings, in their own Durable Object. */
export interface UserData {
  words(userId: string): Promise<Word[]>;
  setWord(userId: string, lemmaId: LemmaId, status: WordStatus, now: string): Promise<void>;
  due(userId: string, now: string, dayStart: string, limit: number): Promise<DueCards>;
  review(userId: string, request: ReviewRequest, now: string): Promise<ReviewOutcome>;
  settings(userId: string): Promise<Settings>;
  setSettings(userId: string, settings: Settings): Promise<void>;
}

/** The lexicon, without paradigms. Ids it doesn't have are left out. */
export interface Lexicon {
  entries(ids: readonly LemmaId[]): Promise<LexiconEntry[]>;
}

export interface Auth {
  handle(request: Request): Promise<Response>;
  user(headers: Headers): Promise<User | null>;
}
