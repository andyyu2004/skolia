// What the API needs from its surroundings: D1, R2, Cloudflare Queues and a Durable
// Object per user (src/worker/adapters.ts), Better Auth (src/auth.ts), and fakes in the
// tests.
import type {
  CardCounts,
  DocumentId,
  Timestamp,
  UserId,
  Lang,
  LemmaId,
  Lookup,
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
  id: DocumentId;
  title: string;
  lang: Lang;
  imported: Timestamp;
  words: number;
  /** The user who first imported it. */
  importer: UserId;
  visibility: Visibility;
  licence: Licence;
  author: string | null;
  source: string | null;
  /** The user who claimed the licence: the importer, or whoever made it public. */
  licensor: UserId;
}

/** A licence claim, which makes a private document public. */
export type Sharing = Pick<DocumentRecord, "licence" | "author" | "source" | "licensor">;

/** A stored document, with its importer's name. */
export interface StoredDocument extends DocumentRecord {
  importerName: string;
}

export interface DocumentStore {
  /** Public documents, and the viewer's own private ones. */
  list(viewer: UserId | null): Promise<StoredDocument[]>;
  get(id: DocumentId): Promise<StoredDocument | null>;
  /** Insert, or keep the existing record if the id is already there. */
  add(record: DocumentRecord): Promise<void>;
  /** Make it public under this licence claim. */
  share(id: DocumentId, sharing: Sharing): Promise<void>;
  /** The documents this user imported, public or private. */
  importedBy(importer: UserId): Promise<StoredDocument[]>;
  update(id: DocumentId, fields: Pick<DocumentRecord, "title" | "licence" | "author" | "source" | "licensor">): Promise<void>;
  delete(id: DocumentId): Promise<void>;
  /** How many documents were imported at or after this time, by users who aren't system users. */
  countImportedSince(since: Timestamp): Promise<number>;
}

export interface StoredBlob {
  body: Uint8Array<ArrayBuffer>;
  contentType: string | undefined;
}

export interface BlobStore {
  get(key: string): Promise<StoredBlob | null>;
  put(key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string): Promise<void>;
  /** Every blob whose key starts with this. */
  deletePrefix(prefix: string): Promise<void>;
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

/** A user's words, cards and settings, in their own Durable Object. now: the request's
 * time by the API's clock (Deps.now), which the tests set. dayStart: when the user's
 * day started in their time zone; today's new cards count from it. */
export interface UserData {
  words(userId: UserId): Promise<Word[]>;
  setWord(userId: UserId, lemmaId: LemmaId, status: WordStatus, now: Timestamp): Promise<void>;
  due(userId: UserId, lang: Lang, now: Timestamp, dayStart: Timestamp, limit: number): Promise<DueCards>;
  counts(userId: UserId, now: Timestamp, dayStart: Timestamp): Promise<CardCounts[]>;
  review(userId: UserId, request: ReviewRequest, now: Timestamp): Promise<ReviewOutcome>;
  settings(userId: UserId): Promise<Settings>;
  setSettings(userId: UserId, settings: Settings): Promise<void>;
}

/** The lexicon, with the feature sets its entries' paradigms use. Ids it doesn't have are left out. */
export interface Lexicon {
  entries(ids: readonly LemmaId[]): Promise<Lookup>;
}

export interface Auth {
  handle(request: Request): Promise<Response>;
  user(headers: Headers): Promise<User | null>;
}

export interface Deps {
  auth: Auth;
  users: UserData;
  lexicon: Lexicon;
  documents: DocumentStore;
  blobs: BlobStore;
  queue: JobQueue;
  /** New texts accepted per UTC day, across everyone: analysis time is what costs
   * money. Importing a text that's already here doesn't count. */
  maxImportsPerDay: number;
  /** git describe of the build */
  version: string;
  now: () => Date;
}
